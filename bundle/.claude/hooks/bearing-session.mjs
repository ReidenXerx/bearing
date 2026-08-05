#!/usr/bin/env node
// Claude Code SessionStart → reset per-session gate flags and inject the GitNexus brief.
import path from "node:path";
import { pathToFileURL } from "node:url";

let raw = "";
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  /* empty */
}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) =>
  import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

const { existsSync } = await import("node:fs");
const { gnContext, emitContext } = await lib("claude-emit.mjs");
const {
  clearSessionState,
  shouldClearOnSource,
  isImpactUsed,
  isDetectUsed,
  memoryPath,
  fallbackGrant,
  taskCorePath,
  taskCoreExists,
  northStarsPath,
  northStarsExists,
} = await lib("session-primer.mjs");

const source = input.source || "startup";
// compact | resume = the SAME task continuing → preserve gates + memory; don't re-arm.
const recovering = !shouldClearOnSource(source);
if (!recovering) clearSessionState(root);

// FEATURE PROBE: the GitNexus enforcement module owns check-staleness.mjs, so the file's presence
// IS the feature flag — config can never drift from what is actually installed. With the module
// absent this repo has no graph, and every graph-first instruction below would be advice the agent
// cannot follow (worse: the guards would point at npm scripts that do not exist here).
const graphEnabled = existsSync(path.join(root, ".bearing/lib/check-staleness.mjs"));

const ctx = graphEnabled ? gnContext(root) : { phase: "fresh" };
const mp = memoryPath(root); // Claude Code's native project memory
const grant = fallbackGrant(root);
const staleLine = !graphEnabled
  ? ""
  : grant
  ? `⚠ CLASSICAL FALLBACK active (${grant.reason || "GitNexus distrusted"}) — classical Grep/Read/shell allowed for ~${Math.max(1, Math.round(grant.remainingMs / 60000))} min. RE-CONFIRM findings with the graph once GitNexus is reliable; end early with \`npm run bearing:fallback:off\`.`
  : ctx.phase !== "fresh"
    ? "Index is STALE — run `npm run bearing:agent-refresh` before graph calls (hooks block until refreshed)."
    : "Index is fresh — hooks redirect symbol Grep / large Read / blind edits to the graph.";

// NORTH-STARS come FIRST on every session type (fresh, compact, resume). They're the project's
// fixed points — the semantic anchor that outranks every other doc — so they must be in the window
// BEFORE the agent forms any premise. The PostToolUse anchor hook keeps them there mid-session.
const nsLine = northStarsExists(root)
  ? `⚑ READ THE NORTH-STARS FIRST — \`${northStarsPath(root)}\`: the project's numbered, authoritative fixed points (invariants, exact term meanings, settled decisions, rejected ideas). They OUTRANK every other doc and your own inference — a conclusion that conflicts with one is wrong. Cite the relevant NS-# when you make a consequential claim, propose a direction, or reject an idea; never silently edit or work around one — propose the change to the user instead.`
  : "";

let lines;
if (recovering) {
  const hasMem = existsSync(memoryPath(root));
  const hasCore = taskCoreExists(root);
  const tcp = taskCorePath(root);
  lines = [
    `Context was ${source === "compact" ? "COMPACTED" : "resumed"} — the task CONTINUES${graphEnabled ? "; enforcement and this session's satisfied gates are PRESERVED" : ""}.`,
    hasCore
      ? `READ your TASK-CORE FIRST — \`${tcp}\`: a dense save-state of THIS task (goal/constraints/decisions/state/anchors/gotchas/next). Reconstruct from it, verify against reality, then continue — do not re-derive what it already settles.`
      : `No TASK-CORE saved — reconstruct THIS task (goal/decisions/state/next) from your memory + the code before acting, and write \`.bearing/.task-core.md\` next time so compaction can't drift you.`,
    // Graph-first discipline MUST be re-stated here, not only on fresh start: post-compaction is
    // exactly where agents drift back to grep/blind-read. "Gates preserved" ≠ "stop using the graph".
    // Graph-first discipline MUST be re-stated here, not only on fresh start: post-compaction is
    // exactly where agents drift back to grep/blind-read. Omitted entirely when the graph module
    // isn't installed — telling an agent to "orient with gitnexus_query" in a repo with no GitNexus
    // is an instruction it cannot follow.
    graphEnabled
      ? "Graph-first STILL applies — do NOT fall back to grep or blind Read: orient with gitnexus_query, drill with gitnexus_context, cypher for structure, impact before edits, detect_changes before commit."
      : "",
    graphEnabled
      ? `Gates already satisfied: impact ${isImpactUsed(root) ? "✓ done" : "pending"}, detect_changes ${isDetectUsed(root) ? "✓ done" : "pending"} — don't redo those for work you ALREADY analyzed, but DO run impact before any NEW edit and detect_changes before every commit.`
      : "",
    hasMem
      ? `RECOVER from your project memory (${mp}): reconcile it with reality NOW and fill gaps — decisions, requirements, open bugs, user intent, key file:line.`
      : `Record the task state you still hold in your project memory (${mp}) — decisions, requirements, open items, key file:line — before continuing.`,
    "NOTHING important from before the compaction may be lost — if the summary dropped a requirement/decision/finding, reconstruct it from your memory or the code before acting.",
    staleLine,
  ];
} else {
  lines = [
    graphEnabled
      ? "GitNexus enforcement active (Claude Code). Graph-first on EVERY task — see CLAUDE.md."
      : "",
    graphEnabled
      ? "Orient with gitnexus_query; drill with gitnexus_context; cypher for structure; impact before edits; detect_changes before commit."
      : "",
    `Keep your project memory current as you work (${mp}) — it survives compaction + sessions; the transcript does not.`,
    staleLine,
  ];
}
if (nsLine) lines.unshift(nsLine);
emitContext(lines.filter(Boolean).join(" "), "SessionStart");
