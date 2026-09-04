#!/usr/bin/env node
// Claude Code SessionStart → reset per-session gate flags and inject the GitNexus brief.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * How cold this save-state is, when that is worth saying.
 *
 * The brief tells the agent to READ THE CORE FIRST and reconstruct from it, so an old core is not
 * merely unhelpful — it is read and TRUSTED. One user's agent worked the age out by hand and
 * reported "the artifact is 9 days stale"; bearing had the mtime on disk and never mentioned it.
 * Silent below two days, where the answer is "it is current" and a number would be noise.
 */
function coreAge(p) {
  try {
    const days = Math.floor((Date.now() - fs.statSync(p).mtimeMs) / 86400000);
    return days >= 2 ? ` (last written ${days} days ago — VERIFY its anchors before acting)` : "";
  } catch {
    return "";
  }
}

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
// FAIL OPEN when our own libs are gone. A missing `.bearing/lib` — partial uninstall, a failed
// update mid-copy, `git clean -xdf` in a stealth repo — threw ERR_MODULE_NOT_FOUND and exited 1
// here. A non-zero PreToolUse exit DENIES the call, so all five guards failing at once blocked Grep,
// Read, Edit, Bash and MCP simultaneously, explained by a raw Node stack trace. A false deny is
// worse than a missed gate (NS-5); with no libs there is no verdict to give, so give none.
let gnContext, emitContext, howToRun, clearSessionState, shouldClearOnSource, isImpactUsed, isDetectUsed, memoryPath, fallbackGrant, taskCorePath, taskCoreReadPath, taskCoreExists, pruneTaskCores, ensureTaskCoreDir, sessionKey, northStarsPath, northStarsExists, graphFeatureEnabled, readTelemetry, summarizeTelemetry, readScorecard, diagnoseEnforcement;
try {
  ({ gnContext, emitContext } = await lib("claude-emit.mjs"));
  ({ howToRun } = await lib("how-to-run.mjs"));
  ({ clearSessionState, shouldClearOnSource, isImpactUsed, isDetectUsed, memoryPath, fallbackGrant, taskCorePath, taskCoreReadPath, taskCoreExists, pruneTaskCores, ensureTaskCoreDir, sessionKey, northStarsPath, northStarsExists, graphFeatureEnabled, readTelemetry, summarizeTelemetry, readScorecard, diagnoseEnforcement } = await lib("session-primer.mjs"));
} catch {
  process.exit(0);
}

// The brief names a path the agent is expected to write; make sure it can.
ensureTaskCoreDir(root);

const source = input.source || "startup";
// compact | resume = the SAME task continuing → preserve gates + memory; don't re-arm.
const recovering = !shouldClearOnSource(source);
if (!recovering) {
  clearSessionState(root);
  // Only on a real start: cores accumulate one per chat, so old ones are swept while never
  // touching this chat's own.
  pruneTaskCores(root, sessionKey(input.transcript_path));
}

// FEATURE PROBE: read the install MANIFEST — the only authoritative record of what the user chose.
// (The previous probe tested for check-staleness.mjs on the theory that a feature-owned file's
// presence IS the flag. It isn't: session-primer imports that module, so the core closure absorbs
// it into every install and the probe was always true — an intel-only repo got the full graph-first
// briefing, including `npm run bearing:agent-refresh`, a script it does not have.)
// With the module absent every graph-first instruction below is advice the agent cannot follow.
const graphEnabled = graphFeatureEnabled(root);

const ctx = graphEnabled ? gnContext(root) : { phase: "fresh" };
const mp = memoryPath(root); // Claude Code's native project memory
const grant = fallbackGrant(root);
const staleLine = !graphEnabled
  ? ""
  : grant
  ? `⚠ CLASSICAL FALLBACK active (${grant.reason || "GitNexus distrusted"}) — classical Grep/Read/shell allowed for ~${Math.max(1, Math.round(grant.remainingMs / 60000))} min. RE-CONFIRM findings with the graph once GitNexus is reliable; end early with \`${howToRun('bearing:fallback:off')}\`.`
  : // Read the STALENESS, not the PHASE. With `stalenessGate: "off"` — the shipped default —
    // stale-policy returns phase:"fresh" for a stale index on purpose: it stops staleness DENYING
    // anything. It sets `staleNote`/`gateOff` so the truth can still be told, and nothing read
    // them, so this line announced "Index is fresh" over an index 50 commits behind. That is the
    // one message loaded before the agent forms any premise, and it cannot be checked by its
    // reader — the exact inversion NS-8 forbids ("a stale index must never be reported as fresh").
    ctx.stale && ctx.stale.fresh === false
    ? `Index is STALE — ${ctx.staleDetail || ctx.stale.reason || "behind HEAD"}`
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
  // Per CHAT, not per repo: several sessions run in one repository and a single file meant they
  // overwrote each other, so a recovery could reconstruct from a DIFFERENT chat's task.
  const key = sessionKey(input.transcript_path);
  const hasCore = taskCoreExists(root, key);
  const tcp = hasCore ? taskCoreReadPath(root, key) : taskCorePath(root, key);
  lines = [
    `Context was ${source === "compact" ? "COMPACTED" : "resumed"} — the task CONTINUES${graphEnabled ? "; enforcement and this session's satisfied gates are PRESERVED" : ""}.`,
    hasCore
      ? `READ your TASK-CORE FIRST — \`${tcp}\`${coreAge(tcp)}: a dense save-state of THIS task (goal/constraints/decisions/state/anchors/gotchas/next). **Read it WHOLE — no offset, no limit, no skim.** It is one screen, it is the only thing that survived the summary, and a partial read cannot tell you which part it missed. Reconstruct from it, verify against reality, then continue — do not re-derive what it already settles.`
      : `No TASK-CORE saved — reconstruct THIS task (goal/decisions/state/next) from your memory + the code before acting, and write \`${tcp}\` next time so compaction can't drift you. That path is THIS chat's own; other sessions in this repo have their own.`,
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
    // The path is per CHAT and therefore NOT guessable — before this it was one documented file the
    // agent could name from memory. Say it on a fresh start too, or the agent cannot write a
    // task-core proactively at a milestone and only learns where it lives once compaction hits,
    // which is exactly too late.
    `Your TASK-CORE for this chat is \`${taskCorePath(root, sessionKey(input.transcript_path))}\` — one file per chat, so parallel sessions here cannot overwrite each other. Write it at a milestone, or when the nudge says edits have piled up since it was last written.`,
    staleLine,
  ];
}
// Is enforcement earning its keep? Every number needed has always been collected and nothing ever
// asked the question. Read the ARCHIVE, not the live scorecard: clearSessionState() above flushes
// the finishing session's tally to telemetry and wipes it, so on a fresh start the scorecard is
// empty by definition and a diagnosis from it could never fire. The cross-session totals are also
// the honest basis — one short session's ratio is noise.
if (graphEnabled) {
  let totals = {};
  try {
    totals = summarizeTelemetry(readTelemetry(root)).totals ?? {};
  } catch {
    totals = readScorecard(root).counts ?? {};
  }
  for (const f of diagnoseEnforcement(totals)) {
    lines.push(`${f.level === "warn" ? "⚠" : "·"} ${f.headline} ${f.advice}`);
  }
}

if (nsLine) lines.unshift(nsLine);

// STEALTH INSTALL: `gitnexus analyze` writes its own stats block into CLAUDE.md and AGENTS.md,
// which in a stealth repo means a MODIFIED tracked file and a stray untracked one — the exact leak
// the mode promises not to create. Normally the pre-commit hook or a refresh script strips it, but
// stealth installs neither (package.json and .githooks are off-limits), so nothing was cleaning up
// and a real install went dirty the moment its index was built. SessionStart is the one thing that
// always runs, so it does the tidying here.
try {
  const contractFile = path.join(root, ".bearing", "contract.md");
  if (existsSync(contractFile)) {
    const { stabilizeAgentDocs } = await lib("stabilize-agent-docs.mjs");
    stabilizeAgentDocs(root);
  }
} catch {
  // Never let tidying cost the session its brief.
}

// STEALTH INSTALL: the always-on contract cannot live in CLAUDE.md, because CLAUDE.md is tracked
// and editing it is the leak the mode exists to avoid. It sits in .bearing/contract.md (excluded
// via .git/info/exclude) and is injected here instead — same text, delivered per session rather
// than committed. Prepended, because it is the frame everything after it is read through.
let contractPrefix = "";
try {
  const p = path.join(root, ".bearing", "contract.md");
  if (existsSync(p)) {
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(p, "utf8").trim();
    if (body) contractPrefix = `${body}\n\n---\n\n`;
  }
} catch {
  // A missing or unreadable contract must not cost the session its brief.
}

emitContext(contractPrefix + lines.filter(Boolean).join(" "), "SessionStart");
