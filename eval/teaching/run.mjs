#!/usr/bin/env node
/**
 * Teaching-mode eval runner (docs/design/gitnexus-teaching.md §7).
 *
 *   node eval/teaching/run.mjs --conditions off,gates --tasks all --trials 3 --model sonnet
 *
 * Conditions:
 *   off    — the fixture with no kit at all
 *   gates  — the fixture with bearing installed from `--gates-ref` (default v1.3.0: today's gates)
 *   teach  — the fixture with bearing from the working tree in `mode: "teach"` (step 4; not yet built)
 *
 * Everything the report says is measured from Claude Code's own event stream (stream-json), the
 * same way in every condition — tool calls, hook denials, tokens, cost. The kit's telemetry is
 * deliberately NOT the source: the thing under test does not grade itself (NS-27).
 *
 * Isolation: user settings, plugins and claude.ai connectors are excluded (`--setting-sources
 * project,local`, `--strict-mcp-config`), so a condition gets exactly what its fixture repo carries.
 * Every CLAUDE* variable is stripped first — run from inside a Claude Code session, the child would
 * otherwise inherit that session's messaging socket and id.
 *
 * Slots: one fixed checkout per condition, indexed once and restored from a pristine copy before
 * every trial. Fixed paths keep the global GitNexus registry to one entry per condition.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildFixture } from "./fixture.mjs";
import { TASKS, scoreList } from "./tasks.mjs";
import { agent, measure } from "../lib/claude-run.mjs";

// Re-exported: the harness tests import it from here.
export { measure };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

function args(argv) {
  const a = {
    conditions: ["off", "gates"],
    tasks: TASKS.map((t) => t.id),
    trials: 1,
    model: "sonnet",
    slots: path.join(os.homedir(), ".cache", "bearing-eval", "teaching"),
    gatesRef: "v1.3.0",
    out: null,
    timeoutMin: 15,
    maxBudgetUsd: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === "--conditions") a.conditions = v().split(",");
    else if (argv[i] === "--tasks") { const t = v(); a.tasks = t === "all" ? a.tasks : t.split(","); }
    else if (argv[i] === "--trials") a.trials = Math.max(1, Number(v()) || 1);
    else if (argv[i] === "--model") a.model = v();
    else if (argv[i] === "--slots") a.slots = path.resolve(v());
    else if (argv[i] === "--gates-ref") a.gatesRef = v();
    else if (argv[i] === "--out") a.out = path.resolve(v());
    else if (argv[i] === "--timeout-min") a.timeoutMin = Number(v());
    else if (argv[i] === "--max-budget-usd") a.maxBudgetUsd = Number(v());
  }
  a.out ??= path.join(a.slots, `results-${a.model}.jsonl`);
  return a;
}

const run = (cmd, argv, cwd, extra = {}) =>
  execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...extra });
const git = (cwd, ...a) => run("git", a, cwd).trim();

/** HEAD + every uncommitted byte under bundle/ and lib/ — what a teach install actually ships. */
function workingTreeKey() {
  const h = createHash("sha256");
  h.update(git(REPO, "rev-parse", "HEAD"));
  h.update(run("git", ["diff", "HEAD", "--", "bundle", "lib"], REPO));
  for (const f of git(REPO, "ls-files", "--others", "--exclude-standard", "--", "bundle", "lib").split("\n").filter(Boolean)) {
    h.update(f);
    h.update(fs.readFileSync(path.join(REPO, f)));
  }
  return h.digest("hex").slice(0, 16);
}

/** A checkout of bearing at `ref`, for installing that version of the kit. */
function kitAt(slots, ref) {
  const dir = path.join(slots, `kit-${ref}`);
  if (!fs.existsSync(path.join(dir, "lib/kit.mjs"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    git(REPO, "worktree", "add", "-q", "--detach", dir, ref);
  }
  return dir;
}

/**
 * Build (once) the pristine slot for a condition: fixture + git + optional kit + index.
 * Rebuilt when the fixture or the kit ref changes (stamp file).
 */
function prepareSlot(a, condition) {
  const slot = path.join(a.slots, condition);
  const pristine = `${slot}.pristine`;
  const stamp = JSON.stringify({
    fixture: fs.readFileSync(path.join(HERE, "fixture.mjs"), "utf8").length,
    tasks: fs.readFileSync(path.join(HERE, "tasks.mjs"), "utf8").length,
    condition,
    // teach installs from the WORKING TREE, so HEAD alone would let uncommitted changes reuse a stale
    // slot and the eval would measure code that no longer exists. Key it on the actual diff.
    ref: condition === "gates" ? a.gatesRef : condition === "teach" ? workingTreeKey() : null,
  });
  const stampFile = path.join(pristine, ".eval-stamp");
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) return { slot, pristine };

  console.error(`[prepare] ${condition}: building slot`);
  for (const d of [slot, pristine]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(slot, { recursive: true });
  buildFixture(slot);
  git(slot, "init", "-q", "-b", "main");
  git(slot, "config", "user.email", "eval@example.invalid");
  git(slot, "config", "user.name", "eval");
  git(slot, "config", "commit.gpgsign", "false");
  git(slot, "add", "-A");
  git(slot, "commit", "-qm", "fixture");

  if (condition !== "off") {
    const kit = condition === "gates" ? kitAt(a.slots, a.gatesRef) : REPO;
    run(process.execPath, [path.join(kit, "lib/kit.mjs"), "install", slot, "--runtime", "claude", "--features", "all",
      "--mcp", "stdio", "--no-setup", "--skip-verify", "--quick"], slot);
    if (condition === "teach") {
      const hj = path.join(slot, ".bearing/hooks.json");
      const cfg = JSON.parse(fs.readFileSync(hj, "utf8"));
      fs.writeFileSync(hj, JSON.stringify({ ...cfg, mode: "teach" }, null, 2) + "\n");
      // Re-render: the contract is chosen by mode at write time, and install wrote the enforce one.
      // hooks.json is seed-once, so the update keeps `teach`.
      run(process.execPath, [path.join(kit, "lib/kit.mjs"), "update", slot, "--no-setup", "--skip-verify"], slot);
      if (!/when the graph wins/.test(fs.readFileSync(path.join(slot, "CLAUDE.md"), "utf8"))) {
        throw new Error("teach slot: CLAUDE.md does not carry the teaching contract — the condition would measure the wrong thing");
      }
    }
    // Commit what a team would commit, so a linked worktree (T5) carries the kit like a real one.
    git(slot, "add", "-A");
    git(slot, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "install bearing");
    // Index the committed tree; the index must be AT HEAD, or the gates read as stale.
    run("gitnexus", ["analyze", "--embeddings", "--skip-agents-md", "--skip-skills", "."], slot, { timeout: 15 * 60_000 });
    const dirty = git(slot, "status", "--porcelain");
    if (dirty) console.error(`[prepare] ${condition}: note — tree after analyze:\n${dirty}`);
  }
  fs.cpSync(slot, pristine, { recursive: true });
  fs.writeFileSync(stampFile, stamp);
  return { slot, pristine };
}

/** Restore the slot to pristine — exact bytes, ignored state files and index included. */
function restore(slot, pristine) {
  try {
    git(slot, "worktree", "prune");
  } catch {
    /* fresh slot */
  }
  run("rsync", ["-a", "--delete", "--exclude", ".eval-stamp", `${pristine}/`, `${slot}/`], path.dirname(slot));
}

async function main() {
  const a = args(process.argv.slice(2));
  fs.mkdirSync(a.slots, { recursive: true });
  const tasks = TASKS.filter((t) => a.tasks.includes(t.id));
  const slots = Object.fromEntries(a.conditions.map((c) => [c, prepareSlot(a, c)]));
  console.error(`[run] ${tasks.length} task(s) × ${a.conditions.length} condition(s) × ${a.trials} trial(s), model ${a.model} → ${a.out}`);

  for (let trial = 1; trial <= a.trials; trial++) {
    for (const task of tasks) {
      // Alternate condition order per trial so neither always runs on a warmer cache.
      const order = trial % 2 ? a.conditions : [...a.conditions].reverse();
      for (const condition of order) {
        const { slot, pristine } = slots[condition];
        restore(slot, pristine);
        const wt = `${slot}-wt`;
        fs.rmSync(wt, { recursive: true, force: true });
        let cwd = slot;
        let row = { at: new Date().toISOString(), model: a.model, condition, task: task.id, trial };
        try {
          if (task.cwd === "worktree") {
            task.setup(slot, wt);
            cwd = wt;
          } else if (task.setup) {
            task.setup(slot);
          }
          const mcpConfig = fs.existsSync(path.join(cwd, ".mcp.json")) ? path.join(cwd, ".mcp.json") : null;
          const res = await agent({ cwd, prompt: task.prompt, model: a.model, mcpConfig, timeoutMs: a.timeoutMin * 60_000, maxBudgetUsd: a.maxBudgetUsd });
          const m = measure(res.events);
          const score = task.kind === "list" ? scoreList(m.resultText, task.key, cwd) : task.verify(cwd);
          row = { ...row, ...m, exitCode: res.code, signal: res.signal, pass: score.pass, f1: score.f1 ?? null,
            precision: score.precision ?? null, recall: score.recall ?? null, answer: score.answer ?? null, detail: score.detail,
            stderr: res.code ? res.stderr : undefined, resultText: m.resultText.slice(-1500) };
        } catch (e) {
          row = { ...row, pass: false, error: String(e?.message ?? e).slice(0, 800) };
        }
        fs.appendFileSync(a.out, JSON.stringify(row) + "\n");
        console.error(`[${task.id} ${condition} #${trial}] pass=${row.pass} f1=${row.f1 ?? "-"} graph=${row.graphCalls ?? "-"} denials=${row.hookDenials ?? "-"} cost=$${row.costUsd?.toFixed?.(3) ?? "?"} ${row.error ? "ERROR " + row.error.slice(0, 120) : ""}`);
        if (task.cwd === "worktree") {
          try {
            git(slot, "worktree", "remove", "--force", wt);
          } catch {
            fs.rmSync(wt, { recursive: true, force: true });
          }
        }
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
