#!/usr/bin/env node
/**
 * Shared GitNexus hook helpers: path rules, MCP copy-paste shortcuts, playbooks, guide mode.
 */
import fs from "node:fs";
import path from "node:path";
import {
  playbookCypherForHint,
  isDataFlowReadContext,
} from "./cypher-helpers.mjs";
import {
  playbookRenameForHint,
  detectIdentifierRename,
  mcpRename,
} from "./rename-helpers.mjs";

export {
  cypherCallChain,
  cypherCallers,
  cypherClassMethods,
  cypherFieldAccess,
  cypherMethodOverrides,
  cypherMidSessionNudge,
  mcpPdgControls,
  mcpPdgFlows,
  mcpPdgImpact,
  mcpTaintExplain,
  mcpTrace,
  cypherProcessSteps,
  isLikelyFieldName,
  isDataFlowReadContext,
  mcpCypher,
  mcpReadSchema,
  playbookCypherForHint,
} from "./cypher-helpers.mjs";

export {
  detectIdentifierRename,
  mcpRename,
  parseRenameFromPrompt,
  playbookRenameForHint,
} from "./rename-helpers.mjs";

export const CONFIG_FILE = ".bearing/hooks.json";
// Gitignored per-machine override — same shape as CONFIG_FILE, wins over it. Lets one dev tune the
// mode / thresholds (e.g. taskCoreEveryEdits) without editing the
// team-shared file. Precedence: defaults < CONFIG_FILE < LOCAL_CONFIG_FILE < env.
/**
 * Did this shell command CHANGE a file?
 *
 * The edit counters watched Write|Edit|MultiEdit|NotebookEdit and nothing else. Measured on a real
 * three-day session: ~6 edits went through those tools and ~90 went through Bash — python heredocs,
 * `sed -i`, redirection — so the counter reached 6 against a threshold of 25 and the task-core
 * nudge never fired once. The core sat 67 hours stale while the work it describes was being done.
 * An agent that works through the shell is not exotic, and it was invisible.
 *
 * Deliberately generous. A false positive makes the nudge arrive slightly early, which costs a line;
 * a false negative is what produced silence for three days.
 * @param {string} command @returns {boolean}
 */
export function bashWritesFiles(command) {
  const cmd = String(command ?? "");
  if (!cmd.trim()) return false;

  // Redirection to a real path. `> /dev/null` and `2>&1` are plumbing, not edits — counting them
  // would mean counting nearly every command that reports anything.
  //
  // QUOTED TEXT IS NOT SHELL SYNTAX. This tested the raw command, so any `>` inside a string or a
  // script body counted as a redirect: `node -e "all.filter(l => l.length > 200)"`,
  // `if (x > 5)`, and `git log --pretty=format:"%h %an <%ae>"` were all classified as file writes.
  // All three nudges share this detector, so a read-only session was told "25 edits since your
  // task-core was last written" having edited nothing, and consult could burn its one-per-session
  // budget on a `git log`. Strip quoted runs first, and require the target to look like a PATH
  // rather than the number an arrow function or a comparison leaves there.
  const unquoted = cmd
    .replace(/'[^']*'/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/=>/g, " ");
  const redirect = /(?:^|[^0-9<>|&=])>>?\s*(?!\/dev\/)(?![&|])(?![0-9]+(?:\s|$))[^\s;|&]+/.test(unquoted);
  const inPlace = /\bsed\s+-i|\bperl\s+-\w*i|\bgit\s+apply\b|\bpatch\b/.test(cmd);
  const writers = /\b(?:cp|mv|install|tee|truncate|touch|mkdir|rmdir|rm|ln)\s/.test(cmd);
  const formatters = /\b(?:prettier|eslint|black|gofmt|rustfmt)\b[^|]*--(?:write|fix|in-place)/.test(cmd);
  // A heredoc fed to an interpreter is how most scripted edits are actually made.
  const scripted =
    /<<-?\s*['"]?\w+['"]?/.test(cmd) &&
    /\b(?:python3?|node|ruby|perl|php|bash|sh)\b/.test(cmd);
  // `sed -n`/`grep` read; only the in-place forms above write. Left as-is deliberately.

  return redirect || inPlace || writers || formatters || scripted;
}


export const LOCAL_CONFIG_FILE = ".bearing/hooks.local.json";

/**
 * Keys that once did something and now do nothing, and why. A setting that silently does nothing is
 * worse than one that errors: it looks handled. hooks.json is seed-once, so an old install keeps
 * whatever its version seeded — an update drops a retired key only while it still holds the value
 * bearing seeded (see SEEDED_RETIRED_VALUES); one you set yourself stays, and verify names it.
 *  - NS-19 retired the context-fullness family: the window is not knowable at runtime.
 *  - NS-28 retired the gates, and with them every setting that tuned one.
 */
export const RETIRED_HOOK_KEYS = new Map([
  ["contextWindowTokens", "NS-19: the context window is not measurable at runtime"],
  ["contextPressureThreshold", "NS-19: the context window is not measurable at runtime"],
  ["contextCheckpointEvery", "NS-19: the context window is not measurable at runtime"],
  ["mode", "NS-28: it chose how the GitNexus gates enforced, and the gates are retired"],
  ["readLineThreshold", "NS-28: it sized the large-Read gate, which is retired"],
  ["stalenessGate", "NS-28: nothing blocks on a stale index any more"],
  ["graceCommitsBehind", "NS-28: it tuned a staleness gate that is retired"],
  ["stalenessCacheTtlMs", "NS-28: only the retired gates kept a staleness cache"],
  ["sourceGlobs", "NS-28: it scoped the retired Read/Edit gates; drift counts use sourceExts"],
  ["microscopeFileThreshold", "microscope is user-invoked: the nudge it sized is retired"],
  ["minionFanoutThreshold", "minions are user-invoked: the nudge it sized is retired"],
]);

/** What bearing itself seeded for each retired key, across every version that seeded it. */
export const SEEDED_RETIRED_VALUES = {
  mode: "enforce",
  readLineThreshold: 60,
  graceCommitsBehind: 2,
  stalenessCacheTtlMs: 2500,
  sourceGlobs: ["src/**", "lib/**", "apps/**", "packages/**"],
};

/**
 * Retired keys the user has actually set, across the team file and the per-machine override.
 * @param {string} root @returns {{key: string, file: string, why: string}[]}
 */
export function retiredHookKeysInUse(root) {
  const found = [];
  for (const rel of [CONFIG_FILE, LOCAL_CONFIG_FILE]) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    } catch {
      continue;
    }
    if (!cfg || typeof cfg !== "object") continue;
    for (const key of Object.keys(cfg)) {
      if (RETIRED_HOOK_KEYS.has(key)) found.push({ key, file: rel, why: RETIRED_HOOK_KEYS.get(key) });
    }
  }
  return found;
}

// Polyglot: GitNexus indexes many languages — drift counting should not be JS/TS-only.
// Override in .bearing/hooks.json via "sourceExts": ["js","py","rs", …].
// Every extension the ANALYZER indexes, plus a few it does not — the asymmetry is deliberate.
//
// This list decides what counts as drift, and drift decides whether the graph is too stale to
// answer with. An extension missing here is not a wrong count, it is NO count: those edits never
// register and drift is never reported. `.vue` was missing while the analyzer ships a vue module —
// a whole framework whose graph went stale on exactly the files being edited, silently. `.cbl`,
// `.cob` and `.cpy` were missing the same way.
//
// The extras (scala, lua, ex/exs, clj) have no analyzer module today. They are kept because the
// two directions are not symmetric: an extra extension makes drift fire slightly early, which
// costs a refresh; a missing one makes it never fire, which costs correctness.
//
// Re-derive when the analyzer gains a language:
//   ls $(npm root -g)/gitnexus/dist/core/ingestion/languages/*.js | xargs grep -h "extensions:"
const DEFAULT_SOURCE_EXT_RE =
  /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|vue|py|pyi|rb|go|rs|java|kt|kts|swift|php|cs|cpp|cc|cxx|hpp|hh|c|h|cu|cuh|scala|m|mm|dart|lua|ex|exs|clj|cbl|cob|cpy)$/i;

/** @param {string[]} exts */
function buildExtRe(exts) {
  const cleaned = exts
    .map((e) => String(e).replace(/^\./, "").trim())
    .filter(Boolean)
    .map((e) => e.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
  if (!cleaned.length) return DEFAULT_SOURCE_EXT_RE;
  return new RegExp(`\\.(${cleaned.join("|")})$`, "i");
}

/**
 * @param {string} root
 */
export function loadHookConfig(root) {
  const cfg = {
    sourceExtRe: DEFAULT_SOURCE_EXT_RE,
    // Pose the consult test once per chat, at the first edit. false/0 disables.
    consultNudge: true,
    // Working-tree drift: after this many uncommitted source edits since the index, the staleness
    // report counts the index as drifted. It is REPORTED, never enforced — nothing blocks on it and
    // nothing refreshes because of it (NS-25). 0 disables drift counting. 8, not 3: three dirty
    // files is five minutes of ordinary work, not a graph that has drifted away from the code.
    driftRefreshThreshold: 8,
    // TASK-CORE: nudge after this many EDITS since the core was last written. Counts unsaved work
    // rather than context fullness, because the window is not knowable at runtime — see
    // bearing-taskcore-nudge.mjs for why two attempts at inferring it both shipped wrong. 0 disables.
    taskCoreEveryEdits: 25,
    // NORTH-STARS re-anchor: re-inject the numbered NS-# propositions verbatim every N tool calls
    // (and always right after the agent writes a doc/conclusion). Loading them once at session
    // start loses to 100k+ tokens of drift, so the anchor has to RECUR. 0 disables.
    // MINIONS: the tier a fanned-out subagent runs on. A middle tier is correct BECAUSE minions do
    // no reasoning (NS-24) — gathering citations does not need a flagship. Override per machine in
    // .bearing/hooks.local.json if your account has different models. Wanting a SMARTER minion is a
    // design smell, not a config problem: it means judgment was delegated.
    minionModel: "sonnet",
    northStarAnchorEvery: 25,
    // Cap on how many NS-# propositions the re-anchor repeats. Each is clipped to its opening
    // claim, so the whole set normally fits; raise this only for an unusually large north-stars doc.
    northStarAnchorMaxLines: 80,
  };

  // Shared team config first, then the gitignored per-machine override (each present file wins over
  // the prior). A missing file is a no-op — readFileSync throws inside the helper and is swallowed.
  applyHookConfigFile(cfg, path.join(root, CONFIG_FILE));
  applyHookConfigFile(cfg, path.join(root, LOCAL_CONFIG_FILE));
  return cfg;
}

/**
 * Merge one hook-config JSON file into cfg (mutates). Missing/invalid file → no-op (keeps prior
 * values), so it's safe to layer several files by precedence. Shared by CONFIG_FILE + LOCAL_CONFIG_FILE.
 * @param {Record<string, any>} cfg
 * @param {string} cfgPath
 */
function applyHookConfigFile(cfg, cfgPath) {
  try {
    const file = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (typeof file.driftRefreshThreshold === "number")
      cfg.driftRefreshThreshold = file.driftRefreshThreshold;
    if (typeof file.taskCoreEveryEdits === "number")
      cfg.taskCoreEveryEdits = file.taskCoreEveryEdits;
    // Boolean OR 0, because "off" is spelled both ways by different people and a setting that
    // silently ignores the spelling you chose is the same defect as one nothing reads at all.
    if (file.consultNudge === false || file.consultNudge === 0) cfg.consultNudge = false;
    if (file.consultNudge === true || file.consultNudge === 1) cfg.consultNudge = true;
    // A non-empty string only: `"minionModel": ""` or a stray number would otherwise be handed to
    // a spawn as a model name.
    if (typeof file.minionModel === "string" && file.minionModel.trim())
      cfg.minionModel = file.minionModel.trim();
    if (typeof file.northStarAnchorEvery === "number")
      cfg.northStarAnchorEvery = file.northStarAnchorEvery;
    if (typeof file.northStarAnchorMaxLines === "number")
      cfg.northStarAnchorMaxLines = file.northStarAnchorMaxLines;
    if (Array.isArray(file.sourceExts) && file.sourceExts.length) {
      cfg.sourceExtRe = buildExtRe(file.sourceExts);
    }
  } catch {
    /* missing or invalid → keep prior values */
  }
}

/** @param {string} root */
export function repoName(root) {
  if (process.env.GITNEXUS_REPO) return process.env.GITNEXUS_REPO;
  return path.basename(root);
}

/** @param {string} repo */
export function mcpContext(name, repo, opts = {}) {
  const safe = String(name).replace(/"/g, '\\"');
  const include =
    opts.include_content === true
      ? ", include_content: true"
      : ", include_content: false";
  if (opts.uid) {
    const uid = String(opts.uid).replace(/"/g, '\\"');
    return `gitnexus_context({ uid: "${uid}", repo: "${repo}"${include} })`;
  }
  return `gitnexus_context({ name: "${safe}", repo: "${repo}"${include} })`;
}

/** @param {object} opts */
export function mcpQuery({
  query,
  taskContext = "",
  goal = "",
  repo,
  limit = 5,
  max_symbols = 12,
}) {
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `gitnexus_query({ search_query: "${esc(query)}", task_context: "${esc(taskContext)}", goal: "${esc(goal)}", repo: "${repo}", limit: ${limit}, max_symbols: ${max_symbols} })`;
}

/**
 * @param {string} target
 * @param {string} repo
 * @param {{ summaryOnly?: boolean, relationTypes?: string[] }} [opts]
 */
export function mcpImpact(target, repo, opts = {}) {
  const safe = String(target).replace(/"/g, '\\"');
  const summaryOnly = opts.summaryOnly === true;
  const extra = summaryOnly
    ? ", summaryOnly: true"
    : ", summaryOnly: false, limit: 100";
  const rel =
    Array.isArray(opts.relationTypes) && opts.relationTypes.length
      ? `, relationTypes: [${opts.relationTypes.map((r) => `"${r}"`).join(", ")}]`
      : "";
  return `gitnexus_impact({ target: "${safe}", direction: "upstream", repo: "${repo}"${extra}${rel} })`;
}

/** @param {string} repo @param {string} [scope] */
export function mcpDetectChanges(repo, scope = "unstaged") {
  return `gitnexus_detect_changes({ scope: "${scope}", repo: "${repo}" })`;
}

/** @param {string} repo */
export function mcpReadContext(repo) {
  return `READ gitnexus://repo/${repo}/context`;
}

/**
 * Is this path a test file?
 *
 * ONE definition. There were two, and they disagreed: bearing-ci's caught `.test.mjs` while
 * test-order's `[jt]sx?` did not, so the same repo could be told a file both was and was not a
 * test depending on which script asked. The one that missed it reported "no test found" for
 * `lib/kit.test.mjs` — the exact confusion between "not found" and "not tested" that the ordering
 * feature exists to avoid (GP-11).
 * @param {string} filePath
 */
export function isTestPath(filePath) {
  return /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py|rb|rs)$|(?:^|\/)test_[^/]+\.py$|Test\.java$|Tests?\.cs$/i.test(
    String(filePath || ""),
  );
}

/**
 * Read the changed symbols out of `detect-changes` output.
 *
 * `detect-changes` prints for humans (`impact` prints JSON), and the line carries the KIND, not the
 * word "Symbol":
 *
 *     Changed symbols:
 *       Function shouldCopyBundleFile → lib/kit-shared.mjs
 *
 * bearing-ci matched /^\s*Symbol\s+.../ and therefore matched NOTHING, ever. It fell through to a
 * fallback that used file basenames as symbol names — which resolve to no graph node, so every row
 * of the blast-radius table read 0 callers while `Risk level:`, parsed separately, reported the real
 * value. A table of zeros next to "risk: critical" is worse than no table: it trains people to
 * ignore the part that works.
 *
 * `parsed` distinguishes "no symbols changed" from "could not read the output" so a caller can be
 * loud about the second (GP-6).
 * @param {string} text
 * @returns {{symbols: {kind: string, name: string, filePath: string}[], parsed: boolean}}
 */
export function parseChangedSymbols(text) {
  const src = String(text || "");
  const start = src.indexOf("Changed symbols:");
  if (start < 0) return { symbols: [], parsed: false };
  const out = [];
  for (const line of src.slice(start).split("\n").slice(1)) {
    if (!line.startsWith("  ")) break;
    const m = line.match(/^\s+(\w+)\s+(\S+)\s+(?:\u2192|->)\s+(\S+)/);
    if (m) out.push({ kind: m[1], name: m[2], filePath: m[3] });
  }
  return { symbols: out, parsed: true };
}

