#!/usr/bin/env node
// Claude Code PostToolUse (mcp__gitnexus__impact) → audit the verdict before the agent acts on it.
//
// `impact` is the PRE-EDIT SAFETY GATE, and its known failure mode is the most dangerous one in the
// stack: calls through factory-returned objects and destructured DI bindings
// (`const { a } = createX()`, `deps.a()`) do not resolve, so the tool reports zero callers — or one
// caller that is the test file — and grades the change `risk: LOW`. Field-reported examples:
// `modifyOppositeSignalPosition` (wired to a live PATCH route) → 0 incoming; `buildSymbolPool` →
// LOW / impactedCount 1 / caller = the test, while two production call sites existed.
//
// A LOW verdict derived from a caller set the tool could not resolve is worse than no verdict: it is
// confidently wrong exactly where the agent is deciding whether a change is safe. This hook does NOT
// block — a new deny here would be unescapable, because re-running impact returns the same empty
// answer (NS-5/NS-6). It warns at the only moment that matters: with the result on screen, before
// the edit.
import path from "node:path";
import { pathToFileURL } from "node:url";

let raw = "";
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  /* malformed stdin must never break the tool call (NS-8) */
}

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) =>
  import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

const tool = input.tool_name ?? "";
if (!/impact/i.test(tool)) process.exit(0);

/** Claude passes the result as an object or a JSON string depending on the server. */
function responseText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  try {
    return JSON.stringify(res);
  } catch {
    return "";
  }
}

const text = responseText(input.tool_response);
if (!text) process.exit(0);

// Parse defensively: the payload shape is the MCP server's, not ours, and a shape change must
// degrade to silence rather than a wrong warning.
const countMatch = text.match(/"impacted(?:Count|_count)"\s*:\s*(\d+)/i);
const impactedCount = countMatch ? Number(countMatch[1]) : null;
const riskMatch = text.match(/"risk"\s*:\s*"(\w+)"/i);
const risk = riskMatch ? riskMatch[1].toUpperCase() : null;

// Every file path the result mentions, so we can ask whether the caller set is only tests.
const paths = [...text.matchAll(/"(?:filePath|file|path)"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]);
const isTestPath = (p) =>
  /(?:^|\/)(?:tests?|__tests__|spec|specs)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(p);
const nonTestPaths = paths.filter((p) => !isTestPath(p));

const emptyCallers = impactedCount === 0 || /"incoming"\s*:\s*\{\s*\}/.test(text);
const testOnly = paths.length > 0 && nonTestPaths.length === 0;

if (!emptyCallers && !testOnly) process.exit(0);
// A genuinely isolated new symbol is a legitimate zero; only a LOW/absent risk grade combined with
// no resolvable production caller is the dangerous pattern.
if (risk && !["LOW", "NONE", "MINIMAL"].includes(risk)) process.exit(0);

// FAIL OPEN when our own libs are gone. A missing `.bearing/lib` — partial uninstall, a failed
// update mid-copy, `git clean -xdf` in a stealth repo — threw ERR_MODULE_NOT_FOUND and exited 1
// here. A non-zero PreToolUse exit DENIES the call, so all five guards failing at once blocked Grep,
// Read, Edit, Bash and MCP simultaneously, explained by a raw Node stack trace. A false deny is
// worse than a missed gate (NS-5); with no libs there is no verdict to give, so give none.
let emitContext, bumpScore, howToRun;
try {
  ({ emitContext } = await lib("claude-emit.mjs"));
  ({ bumpScore } = await lib("session-primer.mjs"));
  ({ howToRun } = await lib("how-to-run.mjs"));
} catch {
  process.exit(0);
}

const symptom = emptyCallers
  ? "resolved NO callers"
  : "resolved callers only in test files";

emitContext(
  `⚠ IMPACT VERDICT IS UNRELIABLE — it ${symptom}${risk ? ` and graded the change \`risk: ${risk}\`` : ""}.\n\n` +
    "Treat this as **UNKNOWN blast radius, not LOW**. A zero caller set is the graph's known " +
    "coverage gap, not a finding: calls through factory-returned objects and destructured DI " +
    "bindings (`const { fn } = createThing()`, `deps.fn()`), plus module-scope consts, do not " +
    "resolve — so a symbol wired to a live route reports zero callers. This has produced a LOW " +
    "grade on symbols with production call sites.\n\n" +
    "Before you edit, confirm the caller set classically and say which check you ran:\n" +
    "  • `Grep` the bare symbol name (a search scoped to one file or directory is allowed)\n" +
    "  • check route/registration/DI wiring — where is the factory's result destructured?\n" +
    "  • if the symbol is exported, search for its import sites\n\n" +
    "If a classical check finds callers the graph missed, that is a defect worth reporting:\n" +
    `  ${howToRun('bearing:fallback')} -- "impact returned 0 callers for <symbol> but grep finds N at <file:line>"`,
  "PostToolUse",
);

bumpScore(root, "impactVerdictsQuestioned");
