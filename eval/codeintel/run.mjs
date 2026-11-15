#!/usr/bin/env node
/**
 * The code-intelligence round: the same four questions about a real repository, answered by an agent
 * with no code-intel tool, or with exactly one of GitNexus, Serena, Claude Code's typescript-lsp plugin
 * or codebase-memory-mcp.
 *
 *   node eval/codeintel/run.mjs --repo ~/Projects/some-repo --tools none,gitnexus,serena,lsp,cbm --trials 3
 *   node eval/codeintel/run.mjs --repo … --prepare-only     # build the slots and indexes, run nothing
 *
 * FAIRNESS, decided up front:
 * - Every condition gets the same slot — `git archive HEAD` of the repo, its own committed files and
 *   nothing else — and the same prompt. The only addition is one neutral line naming the connected
 *   tool, so "was the tool used" is not confounded with "did the agent know it was there".
 * - Every graph is built BEFORE the runs (GitNexus `analyze`, codebase-memory `index_repository`):
 *   indexing time is setup, not the agent's work. Serena and the language server start per session,
 *   as they do for a user.
 * - `--strict-mcp-config`: a condition sees only its own server. Results hold another person's code
 *   paths, so they go to ~/.cache, never into this repository.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { agent, measure } from "../lib/claude-run.mjs";
import { buildRealFixture, realFixtureStamp } from "../intel/fixture-real.mjs";
import { CODEINTEL_TASKS, codeintelKey, answerArray } from "./tasks.mjs";

const CACHE = path.join(os.homedir(), ".cache", "bearing-eval", "codeintel");
const VERSIONS = { serena: "2.1.0", cbm: "0.12.1", tsls: "5.1.3", typescript: "5.9.3" };

/** The one line each condition adds to the prompt. Descriptive, never a recommendation. */
const ANNOUNCE = {
  none: "",
  gitnexus: "A code-intelligence MCP server, GitNexus, is connected and has indexed this repository.",
  serena: "A code-intelligence MCP server, Serena (backed by the TypeScript language server), is connected for this repository.",
  lsp: "A TypeScript language server is available through the LSP tool.",
  cbm: "A code-intelligence MCP server, codebase-memory-mcp, is connected and has indexed this repository.",
};

/** Which tool calls belong to the condition's tool — counted, never stored. */
const TOOL_CALL = {
  gitnexus: (n) => n.startsWith("mcp__gitnexus__"),
  serena: (n) => n.startsWith("mcp__serena__"),
  lsp: (n) => n === "LSP",
  cbm: (n) => n.startsWith("mcp__cbm__"),
  none: () => false,
};

function args(argv) {
  const a = { tools: ["none", "gitnexus", "serena", "lsp", "cbm"], tasks: CODEINTEL_TASKS.map((t) => t.id), trials: 1, model: "sonnet", timeoutMin: 15, maxBudgetUsd: 2, out: null };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === "--repo") process.env.BEARING_EVAL_REPO = path.resolve(v().replace(/^~(?=\/)/, os.homedir()));
    else if (argv[i] === "--tools") a.tools = v().split(",");
    else if (argv[i] === "--tasks") a.tasks = v().split(",");
    else if (argv[i] === "--trials") a.trials = Math.max(1, Number(v()) || 1);
    else if (argv[i] === "--model") a.model = v();
    else if (argv[i] === "--out") a.out = path.resolve(v());
    else if (argv[i] === "--timeout-min") a.timeoutMin = Number(v());
    else if (argv[i] === "--max-budget-usd") a.maxBudgetUsd = Number(v());
    else if (argv[i] === "--prepare-only") a.prepareOnly = true;
    // The ADOPTION round asks and lets the agent choose; this one measures what the tool itself
    // answers. Round one found the tools barely used, so it could not say which one is right.
    else if (argv[i] === "--force-tool") a.forceTool = true;
  }
  for (const t of a.tools) if (!(t in ANNOUNCE)) throw new Error(`unknown tool ${t}`);
  a.out ??= path.join(CACHE, `results-${a.model}.jsonl`);
  return a;
}

const run = (cmd, argv, cwd, env = {}) =>
  execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });

/** The plugin is one manifest naming a binary; the binary comes from a pinned install in the cache. */
function prepareLsp() {
  const prefix = path.join(CACHE, "tsls");
  if (!fs.existsSync(path.join(prefix, "node_modules/.bin/typescript-language-server"))) {
    fs.mkdirSync(prefix, { recursive: true });
    run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", `typescript-language-server@${VERSIONS.tsls}`, `typescript@${VERSIONS.typescript}`], prefix);
  }
  const plugin = path.join(CACHE, "plugins/typescript-lsp");
  fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
  // Verbatim from anthropics/claude-plugins-official plugins/typescript-lsp/.claude-plugin/plugin.json.
  fs.writeFileSync(path.join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({
    name: "typescript-lsp", description: "TypeScript/JavaScript language server for enhanced code intelligence", version: "1.0.0",
    author: { name: "Anthropic", email: "support@anthropic.com" },
    lspServers: { typescript: { command: "typescript-language-server", args: ["--stdio"], extensionToLanguage: {
      ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact",
      ".mts": "typescript", ".cts": "typescript", ".mjs": "javascript", ".cjs": "javascript" } } },
  }, null, 2));
  return { pluginDirs: [plugin], env: { PATH: `${path.join(prefix, "node_modules/.bin")}:${process.env.PATH}` } };
}

function prepare(tool) {
  const slot = path.join(CACHE, tool);
  const pristine = `${slot}.pristine`;
  const stamp = JSON.stringify({ repo: process.env.BEARING_EVAL_REPO, head: realFixtureStamp(), tool, versions: VERSIONS });
  const stampFile = path.join(CACHE, `${tool}.stamp`);
  const cfgFile = path.join(CACHE, `${tool}.mcp.json`);
  const cbmCache = path.join(CACHE, "cbm-cache");
  let extra = { pluginDirs: [], env: {} };
  if (tool === "lsp") extra = prepareLsp();
  if (tool === "serena") extra.env = { MCP_TIMEOUT: "120000" };
  if (!(fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp && fs.existsSync(pristine))) {
    console.error(`[prepare] ${tool}: building slot`);
    for (const d of [slot, pristine]) fs.rmSync(d, { recursive: true, force: true });
    buildRealFixture(slot);
    run("git", ["init", "-q", "-b", "main"], slot);
    run("git", ["-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "-c", "commit.gpgsign=false", "add", "-A"], slot);
    run("git", ["-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], slot);
    // A committed .mcp.json would be ignored under --strict-mcp-config anyway; remove it so no
    // condition reads a server name it cannot reach.
    fs.rmSync(path.join(slot, ".mcp.json"), { force: true });
    if (tool === "gitnexus") {
      console.error("[prepare] gitnexus: analyze");
      run("gitnexus", ["analyze", slot], slot);
    }
    if (tool === "cbm") {
      console.error("[prepare] cbm: index_repository");
      run("npx", ["-y", `codebase-memory-mcp@${VERSIONS.cbm}`, "cli", "--quiet", "index_repository", "--repo-path", slot], slot, { CBM_CACHE_DIR: cbmCache });
    }
    fs.cpSync(slot, pristine, { recursive: true });
    fs.writeFileSync(stampFile, stamp);
  }
  const servers = {
    gitnexus: { gitnexus: { command: "gitnexus", args: ["mcp"] } },
    serena: { serena: { command: "uvx", args: ["--from", `serena-agent==${VERSIONS.serena}`, "serena", "start-mcp-server", "--context", "claude-code", "--project", slot] } },
    cbm: { cbm: { command: "npx", args: ["-y", `codebase-memory-mcp@${VERSIONS.cbm}`], env: { CBM_CACHE_DIR: cbmCache } } },
  }[tool];
  if (servers) fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: servers }, null, 2));
  return { slot, pristine, mcpConfig: servers ? cfgFile : null, ...extra };
}

function restore(slot, pristine) {
  run("rsync", ["-a", "--delete", `${pristine}/`, `${slot}/`], path.dirname(slot));
}

/** Claude Code's per-project memory for OUR slots only — a note from one trial must not reach the next. */
function clearSlotMemory() {
  const dir = path.join(os.homedir(), ".claude", "projects");
  const ours = path.resolve(CACHE).replace(/[^A-Za-z0-9]/g, "-");
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (name.startsWith(ours)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  const key = codeintelKey();
  fs.mkdirSync(CACHE, { recursive: true });
  const tasks = CODEINTEL_TASKS.filter((t) => a.tasks.includes(t.id));
  const slots = Object.fromEntries(a.tools.map((t) => [t, prepare(t)]));
  if (a.prepareOnly) {
    for (const [t, s] of Object.entries(slots)) console.error(`[prepare] ${t}: ${s.pristine}${s.mcpConfig ? ` mcp=${s.mcpConfig}` : ""}`);
    return;
  }
  console.error(`[run] ${tasks.length} task(s) × ${a.tools.length} tool(s) × ${a.trials} trial(s), ${a.model} → ${a.out}`);
  for (let trial = 1; trial <= a.trials; trial++) {
    for (const task of tasks) {
      const order = trial % 2 ? a.tools : [...a.tools].reverse();
      for (const tool of order) {
        const s = slots[tool];
        restore(s.slot, s.pristine);
        clearSlotMemory();
        let row = { at: new Date().toISOString(), model: a.model, tool, task: task.id, trial, forced: Boolean(a.forceTool) };
        try {
          const suffix = !ANNOUNCE[tool] ? "" : a.forceTool
            ? `\n\n${ANNOUNCE[tool]} Answer with it: find the answer through that tool, not with grep, rg, find or reading files in bulk. You may open a file to confirm a single site.`
            : `\n\n${ANNOUNCE[tool]} Use it where it helps.`;
          const prompt = task.prompt(key) + suffix;
          const res = await agent({ cwd: s.slot, prompt, model: a.model, mcpConfig: s.mcpConfig, pluginDirs: s.pluginDirs, env: s.env, timeoutMs: a.timeoutMin * 60_000, maxBudgetUsd: a.maxBudgetUsd });
          const m = measure(res.events);
          const toolCalls = Object.entries(m.tools ?? {}).filter(([n]) => TOOL_CALL[tool](n)).reduce((n, [, c]) => n + c, 0);
          const score = res.code !== 0 ? { pass: false, detail: `exited ${res.code}: ${res.stderr.slice(-200)}` } : task.verify(key, m.resultText);
          const offered = m.initTools.filter((n) => TOOL_CALL[tool](n));
          row = { ...row, ...score, answer: answerArray(m.resultText), toolCalls, offered: offered.length, mcpServers: m.mcpServers, totalToolCalls: m.toolCalls, tools: m.tools, costUsd: m.costUsd, durationMs: m.durationMs, turns: m.turns, tokens: m.tokens };
        } catch (e) {
          row = { ...row, pass: false, error: String(e?.message ?? e).slice(0, 600) };
        }
        clearSlotMemory();
        fs.appendFileSync(a.out, JSON.stringify(row) + "\n");
        console.error(`[${task.id} ${tool} #${trial}] pass=${row.pass} toolCalls=${row.toolCalls ?? "-"} cost=$${row.costUsd?.toFixed?.(3) ?? "?"} ${row.detail ?? ""}${row.error ? ` ERROR ${row.error.slice(0, 120)}` : ""}`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
