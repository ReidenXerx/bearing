#!/usr/bin/env node
/**
 * Judgment-layer eval runner.
 *
 *   node eval/intel/run.mjs --conditions off,on --tasks all --trials 3 --model sonnet
 *   node eval/intel/run.mjs --conditions off,on --tasks hard --trials 3   # the hard round (tasks-hard.mjs)
 *
 * Conditions:
 *   off — the fixture with no kit at all
 *   on  — the fixture with bearing installed from the WORKING TREE: Claude Code runtime, the default
 *         modules (north-stars, gold practices, task-core, microscope, consult, minions), no GitNexus
 *
 * Both conditions carry the same repo — including its own .bearing/northstars.md. What `on` adds is
 * what bearing adds: the contract that makes those north-stars authoritative, the skills, and the
 * hooks that raise them at the moment they apply. That difference is the thing measured.
 *
 * Everything the report says comes from Claude Code's event stream and from checks the harness owns
 * (tasks.mjs) — never from bearing's own telemetry (NS-27).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildFixture, fixtureFiles } from "./fixture.mjs";
import { HARD_TASKS } from "./tasks-hard.mjs";
import { TASKS } from "./tasks.mjs";
import { agent, measure } from "../lib/claude-run.mjs";

const ALL_TASKS = [...TASKS, ...HARD_TASKS];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

function args(argv) {
  const a = {
    conditions: ["off", "on"],
    tasks: TASKS.map((t) => t.id),
    trials: 1,
    model: "sonnet",
    slots: path.join(os.homedir(), ".cache", "bearing-eval", "intel"),
    out: null,
    timeoutMin: 15,
    maxBudgetUsd: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === "--conditions") a.conditions = v().split(",");
    else if (argv[i] === "--tasks") {
      const t = v();
      a.tasks = t === "all" ? a.tasks : t === "hard" ? HARD_TASKS.map((x) => x.id) : t.split(",");
    }
    else if (argv[i] === "--trials") a.trials = Math.max(1, Number(v()) || 1);
    else if (argv[i] === "--model") a.model = v();
    else if (argv[i] === "--slots") a.slots = path.resolve(v());
    else if (argv[i] === "--out") a.out = path.resolve(v());
    else if (argv[i] === "--timeout-min") a.timeoutMin = Number(v());
    else if (argv[i] === "--max-budget-usd") a.maxBudgetUsd = Number(v());
    else if (argv[i] === "--prepare-only") a.prepareOnly = true;
  }
  a.out ??= path.join(a.slots, `results-${a.model}.jsonl`);
  return a;
}

const run = (cmd, argv, cwd) =>
  execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const git = (cwd, ...a) => run("git", a, cwd).trim();

/** HEAD plus every uncommitted byte under bundle/ and lib/ — what an `on` install actually ships. */
function kitKey() {
  const h = createHash("sha256");
  h.update(git(REPO, "rev-parse", "HEAD"));
  h.update(run("git", ["diff", "HEAD", "--", "bundle", "lib"], REPO));
  for (const f of git(REPO, "ls-files", "--others", "--exclude-standard", "--", "bundle", "lib").split("\n").filter(Boolean)) {
    h.update(f);
    h.update(fs.readFileSync(path.join(REPO, f)));
  }
  return h.digest("hex").slice(0, 16);
}

/**
 * Build (once) the pristine slot for a condition and fixture variant; rebuilt when the fixture or the
 * kit changes. The base variant keeps its old slot name, so the first round's cache stays valid.
 */
function prepareSlot(a, condition, variant = "base") {
  const slot = path.join(a.slots, variant === "base" ? condition : `${condition}-${variant}`);
  const pristine = `${slot}.pristine`;
  const stamp = JSON.stringify({
    fixture: createHash("sha256").update(JSON.stringify(fixtureFiles(variant))).digest("hex"),
    condition,
    kit: condition === "on" ? kitKey() : null,
  });
  const stampFile = path.join(pristine, ".eval-stamp");
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) return { slot, pristine };

  console.error(`[prepare] ${condition}: building slot`);
  for (const d of [slot, pristine]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(slot, { recursive: true });
  buildFixture(slot, variant);
  git(slot, "init", "-q", "-b", "main");
  git(slot, "config", "user.email", "eval@example.invalid");
  git(slot, "config", "user.name", "eval");
  git(slot, "config", "commit.gpgsign", "false");
  git(slot, "add", "-A");
  git(slot, "commit", "-qm", "fixture");
  if (condition === "on") {
    run(process.execPath, [path.join(REPO, "lib/kit.mjs"), "install", slot, "--runtime", "claude",
      "--no-setup", "--skip-verify", "--quick"], slot);
    // The condition is only meaningful if the fixture's OWN north-stars survived the install —
    // north-stars are seed-once, and a seeded starter here would test bearing against an empty anchor.
    const ns = fs.readFileSync(path.join(slot, ".bearing/northstars.md"), "utf8");
    if (!/ledger-svc/.test(ns) || !/NS-3/.test(ns)) throw new Error("install replaced the fixture's north-stars — the `on` slot is invalid");
    const claudeMd = fs.readFileSync(path.join(slot, "CLAUDE.md"), "utf8");
    if (/gitnexus_|graph-first/i.test(claudeMd)) throw new Error("the `on` contract carries GitNexus text — the slot is not the default install");
    // Commit the install, so an agent's `git diff` shows its own work rather than bearing's 80 files.
    git(slot, "add", "-A");
    git(slot, "commit", "-qm", "bearing");
  }
  fs.cpSync(slot, pristine, { recursive: true });
  fs.writeFileSync(stampFile, stamp);
  return { slot, pristine };
}

function restore(slot, pristine) {
  try {
    git(slot, "worktree", "prune");
  } catch {
    /* fresh slot */
  }
  run("rsync", ["-a", "--delete", "--exclude", ".eval-stamp", `${pristine}/`, `${slot}/`], path.dirname(slot));
}

/**
 * Clear what Claude Code keeps per project for OUR slots: the transcripts a multi-step task
 * persisted, and the project's auto-memory directory. Run before every task, not only after the
 * multi-step ones — bearing's contract tells the agent to keep memory there, and Claude Code loads it
 * into the next session, so a note written in one trial would reach the next, in the `on` condition
 * only. Only directories named after our slots are touched; nothing else under ~/.claude/projects.
 */
function clearSlotSessions(slots) {
  const dir = path.join(os.homedir(), ".claude", "projects");
  const ours = path.resolve(slots).replace(/[^A-Za-z0-9]/g, "-");
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (name.startsWith(ours)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

/** Sum the per-step measures of a multi-step task into one row; the answer is the last real step. */
function combine(steps) {
  const last = [...steps].reverse().find((s) => !s.compactStep) ?? steps[steps.length - 1];
  const sum = (f) => steps.reduce((acc, s) => acc + (f(s) ?? 0), 0);
  const tools = {};
  for (const s of steps) for (const [k, v] of Object.entries(s.tools ?? {})) tools[k] = (tools[k] ?? 0) + v;
  return {
    ...last,
    tools,
    toolCalls: sum((s) => s.toolCalls),
    subagents: sum((s) => s.subagents),
    compactions: sum((s) => s.compactions),
    hookDenials: sum((s) => s.hookDenials),
    toolErrors: sum((s) => s.toolErrors),
    costUsd: sum((s) => s.costUsd),
    durationMs: sum((s) => s.durationMs),
    turns: sum((s) => s.turns),
    tokens: {
      input: sum((s) => s.tokens?.input),
      output: sum((s) => s.tokens?.output),
      cacheRead: sum((s) => s.tokens?.cacheRead),
      cacheCreate: sum((s) => s.tokens?.cacheCreate),
    },
    steps: steps.length,
  };
}

async function main() {
  const a = args(process.argv.slice(2));
  fs.mkdirSync(a.slots, { recursive: true });
  const tasks = ALL_TASKS.filter((t) => a.tasks.includes(t.id));
  const unknown = a.tasks.filter((id) => !ALL_TASKS.some((t) => t.id === id));
  if (unknown.length) throw new Error(`unknown task(s): ${unknown.join(", ")}`);
  const variants = [...new Set(tasks.map((t) => t.fixture ?? "base"))];
  const slots = {};
  for (const c of a.conditions) for (const v of variants) slots[`${c}/${v}`] = prepareSlot(a, c, v);
  if (a.prepareOnly) {
    for (const [c, s] of Object.entries(slots)) console.error(`[prepare] ${c}: ${s.pristine}`);
    return;
  }
  console.error(`[run] ${tasks.length} task(s) × ${a.conditions.length} condition(s) × ${a.trials} trial(s), model ${a.model} → ${a.out}`);

  for (let trial = 1; trial <= a.trials; trial++) {
    for (const task of tasks) {
      // Alternate the condition order per trial, so neither always runs on a warmer cache.
      const order = trial % 2 ? a.conditions : [...a.conditions].reverse();
      for (const condition of order) {
        const { slot, pristine } = slots[`${condition}/${task.fixture ?? "base"}`];
        restore(slot, pristine);
        clearSlotSessions(a.slots);
        let row = { at: new Date().toISOString(), model: a.model, condition, task: task.id, module: task.module, trial };
        try {
          const multi = task.steps.length > 1;
          const measured = [];
          let session = null;
          let failed = null;
          for (const prompt of task.steps) {
            const res = await agent({
              cwd: slot, prompt, model: a.model, timeoutMs: a.timeoutMin * 60_000, maxBudgetUsd: a.maxBudgetUsd,
              resume: session, persist: multi,
            });
            session ??= res.sessionId;
            measured.push({ ...measure(res.events), compactStep: prompt === "/compact" });
            if (res.code !== 0) {
              failed = `step ${measured.length} exited ${res.code}${res.signal ? ` (${res.signal})` : ""}: ${res.stderr.slice(-300)}`;
              break;
            }
            if (multi && !session) {
              failed = "no session id to resume";
              break;
            }
          }
          const m = combine(measured);
          const score = failed ? { pass: false, detail: failed } : task.verify(slot, m);
          row = { ...row, ...m, ...score, resultText: (m.resultText ?? "").slice(-1500) };
          delete row.sequence;
        } catch (e) {
          row = { ...row, pass: false, error: String(e?.message ?? e).slice(0, 800) };
        }
        clearSlotSessions(a.slots);
        fs.appendFileSync(a.out, JSON.stringify(row) + "\n");
        console.error(`[${task.id} ${condition} #${trial}] pass=${row.pass} subagents=${row.subagents ?? "-"} cost=$${row.costUsd?.toFixed?.(3) ?? "?"} ${row.detail ?? ""} ${row.error ? "ERROR " + row.error.slice(0, 120) : ""}`);
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
