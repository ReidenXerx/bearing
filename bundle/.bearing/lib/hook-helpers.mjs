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
  const redirect = /(?:^|[^0-9<>|&])>>?\s*(?!\/dev\/)(?![&|])[^\s;|&]+/.test(cmd);
  const inPlace = /\bsed\s+-i|\bperl\s+-\w*i|\bgit\s+apply\b|\bpatch\b/.test(cmd);
  const writers = /\b(?:cp|mv|install|tee|truncate|touch|mkdir|rmdir|rm|ln)\s/.test(cmd);
  const formatters = /\b(?:prettier|eslint|black|gofmt|rustfmt)\b[^|]*--(?:write|fix|in-place)/.test(cmd);
  // A heredoc fed to an interpreter is how most scripted edits are actually made.
  const scripted =
    /<<-?\s*['"]?\w+['"]?/.test(cmd) &&
    /\b(?:python3?|node|ruby|perl|php|bash|sh)\b/.test(cmd);

  return redirect || inPlace || writers || formatters || scripted;
}

/**
 * Which FILES a shell command writes, where that is knowable.
 *
 * `bashWritesFiles` answers "was this an edit", which is enough to COUNT edits. The deep-review
 * nudge counts DISTINCT FILES — twenty passes over one file is iteration, five files touched once
 * is a change with a shape — so it needs the paths, and a Bash call does not hand you one.
 *
 * Best-effort by design, and partial on purpose: a python heredoc that computes its target at
 * runtime cannot be read off the command line, and guessing would inflate the distinct-file count
 * with paths that were never touched. Returning fewer, certain paths keeps the threshold meaning
 * what it says.
 * @param {string} command @returns {string[]} repo-relative-ish paths, deduped
 */
export function bashWriteTargets(command) {
  const cmd = String(command ?? "");
  if (!cmd.trim()) return [];
  const out = new Set();
  const add = (p) => {
    const clean = String(p || "").replace(/^['"]|['"]$/g, "").trim();
    if (!clean || clean.startsWith("/dev/") || clean.startsWith("-")) return;
    // Must LOOK like a path. A capture with no separator and no extension is far more likely to be
    // a string that happened to sit where a path goes — which is how `write_text('x')` once
    // registered a file called `x`. Rejecting it costs a missed count; accepting it costs a wrong
    // one AND suppresses the fallback that would have been right.
    if (!clean.includes("/") && !/\.[A-Za-z0-9]{1,6}$/.test(clean)) return;
    out.add(clean);
  };

  // `> path`, `>> path`
  for (const m of cmd.matchAll(/(?:^|[^0-9<>|&])>>?\s*(?!\/dev\/)([^\s;|&<>]+)/g)) add(m[1]);
  // `sed -i [ext] 's/…/…/' path…` — the trailing operands are the files
  for (const m of cmd.matchAll(/\bsed\s+-i\b[^\n;|&]*/g)) {
    const tail = m[0].split(/\s+/).slice(1).filter((t) => !t.startsWith("-") && !/^['"]?s[\/|]/.test(t));
    for (const t of tail.slice(1)) add(t);
  }
  // `cp a b` / `mv a b` / `install a b` — the DESTINATION is what changed
  for (const m of cmd.matchAll(/\b(?:cp|mv|install)\s+(?:-\S+\s+)*(\S+)\s+(\S+)/g)) add(m[2]);
  // A quoted path inside a heredoc body. `Path(...)` and `writeFileSync(path, data)` take the path
  // first; `write_text(...)` takes the CONTENT and was captured here by mistake — it recorded a
  // file's text as its name, and worse, a non-empty bogus target suppressed the git fallback that
  // would have got the answer right.
  for (const m of cmd.matchAll(/(?:writeFileSync|Path|open)\s*\(\s*['"]([^'"]+)['"]/g)) add(m[1]);

  return [...out];
}

export const LOCAL_CONFIG_FILE = ".bearing/hooks.local.json";

/**
 * Keys that once did something and now do nothing.
 *
 * NS-19 retired the whole context-fullness family: the window is not knowable at runtime, so a gate
 * on a percentage of it produced confident false alarms. The settings kept being SET, though —
 * hooks.json is seed-once, so an old install's comment still worked-examples
 * `"contextWindowTokens": 1000000`, and a reader who follows it configures a no-op. A setting that
 * silently does nothing is worse than one that errors: it looks handled.
 */
export const RETIRED_HOOK_KEYS = new Set([
  "contextWindowTokens",
  "contextPressureThreshold",
  "contextCheckpointEvery",
]);

/**
 * Retired keys the user has actually set, across the team file and the per-machine override.
 * @param {string} root @returns {{key: string, file: string}[]}
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
      if (RETIRED_HOOK_KEYS.has(key)) found.push({ key, file: rel });
    }
  }
  return found;
}

/** @typedef {'enforce' | 'guide'} HookMode */
/** @typedef {'none' | 'light' | 'medium' | 'full'} EditSensitivity */

const DEFAULT_SOURCE_RES = [
  /(?:^|\/)src(?:\/|$)/,
  /(?:^|\/)lib(?:\/|$)/,
  /(?:^|\/)apps(?:\/|$)/,
  /(?:^|\/)packages(?:\/|$)/,
];

const DEFAULT_BROAD_GLOB_RES = [
  /^\*\*\/\*\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|php|cs|cpp|cc|c|cu|cuh|scala)$/,
  /^\*\*\/src\//,
  /^src\//,
  /^\*\*\/lib\//,
  /^lib\//,
  /^\*\*\/apps\//,
  /^apps\//,
];

// Polyglot: GitNexus indexes many languages — enforcement should not be JS/TS-only.
// Override in .bearing/hooks.json via "sourceExts": ["js","py","rs", …].
// Every extension the ANALYZER indexes, plus a few it does not — the asymmetry is deliberate.
//
// This list decides what counts as drift, and drift decides whether the graph is too stale to
// answer with. An extension missing here is not a wrong count, it is NO count: those edits never
// register and the gate never fires. `.vue` was missing while the analyzer ships a vue module —
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
    mode: hookModeFromEnv(),
    readLineThreshold: 60,
    sourcePathRes: DEFAULT_SOURCE_RES,
    broadGlobRes: DEFAULT_BROAD_GLOB_RES,
    sourceExtRe: DEFAULT_SOURCE_EXT_RE,
    stalenessCacheTtlMs: 2500,
    // Pose the consult test once per chat, at the first edit. false/0 disables.
    consultNudge: true,
    // Distinct files edited before the deep-review nudge fires. 0 disables.
    microscopeFileThreshold: 5,
    // Working-tree drift: after this many uncommitted source edits since the index,
    // graph query tools require a fast incremental refresh. 0 disables the drift gate.
    // Does a STALE INDEX block anything? "off" (default) | "block".
    //
    // Off by default because the judgement is not good enough yet to spend the user's attention on.
    // Deciding that a graph is too far behind to answer with means predicting whether the drift
    // touches what is being asked about, and neither the file count nor the commit count knows that
    // — so the gate stopped work it did not need to stop and the cost landed on whoever was typing.
    // A gate that is wrong often enough to be worked around protects nothing (NS-5).
    //
    // What still happens with it off: the graph refreshes on commit and on demand, and the staleness
    // is REPORTED. What stops: denying tools because of it, and ordering an autonomous refresh.
    // Set "block" in .bearing/hooks.json to restore the gates.
    stalenessGate: "off",
    // 8, not 3. Three dirty source files is an ordinary five minutes of work, so the gate fired
    // during normal editing rather than at the point the graph had actually drifted away from the
    // code. A gate that interrupts routine work gets worked around, and a worked-around gate
    // protects nothing (NS-5: a false deny is worse than a missed gate).
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
    // MINIONS nudge: after this many DISTINCT gather targets in a row with no delegation, suggest
    // fanning out. Once per session, advisory only. 0 disables.
    minionFanoutThreshold: 8,
    northStarAnchorEvery: 25,
    // Cap on how many NS-# propositions the re-anchor repeats. Each is clipped to its opening
    // claim, so the whole set normally fits; raise this only for an unusually large north-stars doc.
    northStarAnchorMaxLines: 80,
  };

  // Shared team config first, then the gitignored per-machine override (each present file wins over
  // the prior). A missing file is a no-op — readFileSync throws inside the helper and is swallowed.
  applyHookConfigFile(cfg, path.join(root, CONFIG_FILE));
  applyHookConfigFile(cfg, path.join(root, LOCAL_CONFIG_FILE));

  // Per-machine env override wins over both files (handy for CI / ad-hoc). The context window is
  // model-specific — a 1M-context session and a teammate's 200k model can't share one committed

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
    if (file.mode) cfg.mode = file.mode === "guide" ? "guide" : "enforce";
    if (typeof file.readLineThreshold === "number")
      cfg.readLineThreshold = file.readLineThreshold;
    if (typeof file.stalenessCacheTtlMs === "number")
      cfg.stalenessCacheTtlMs = file.stalenessCacheTtlMs;
    if (file.stalenessGate === "block" || file.stalenessGate === "off")
      cfg.stalenessGate = file.stalenessGate;
    if (typeof file.driftRefreshThreshold === "number")
      cfg.driftRefreshThreshold = file.driftRefreshThreshold;
    if (typeof file.taskCoreEveryEdits === "number")
      cfg.taskCoreEveryEdits = file.taskCoreEveryEdits;
    // Boolean OR 0, because "off" is spelled both ways by different people and a setting that
    // silently ignores the spelling you chose is the same defect as one nothing reads at all.
    if (file.consultNudge === false || file.consultNudge === 0) cfg.consultNudge = false;
    if (file.consultNudge === true || file.consultNudge === 1) cfg.consultNudge = true;
    if (typeof file.microscopeFileThreshold === "number")
      cfg.microscopeFileThreshold = file.microscopeFileThreshold;
    // A non-empty string only: `"minionModel": ""` or a stray number would otherwise be handed to
    // a spawn as a model name.
    if (typeof file.minionModel === "string" && file.minionModel.trim())
      cfg.minionModel = file.minionModel.trim();
    if (typeof file.minionFanoutThreshold === "number")
      cfg.minionFanoutThreshold = file.minionFanoutThreshold;
    if (typeof file.northStarAnchorEvery === "number")
      cfg.northStarAnchorEvery = file.northStarAnchorEvery;
    if (typeof file.northStarAnchorMaxLines === "number")
      cfg.northStarAnchorMaxLines = file.northStarAnchorMaxLines;
    if (Array.isArray(file.sourceGlobs) && file.sourceGlobs.length) {
      cfg.sourcePathRes = file.sourceGlobs.map((g) => globToRegExp(g));
    }
    if (Array.isArray(file.sourceExts) && file.sourceExts.length) {
      cfg.sourceExtRe = buildExtRe(file.sourceExts);
    }
  } catch {
    /* missing or invalid → keep prior values */
  }
}

function hookModeFromEnv() {
  const m = (
    process.env.GITNEXUS_MODE ||
    process.env.GITNEXUS_HOOK_MODE ||
    "enforce"
  ).toLowerCase();
  return m === "guide" ? "guide" : "enforce";
}

/**
 * @param {string} glob
 */
function globToRegExp(glob) {
  const norm = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  const re = norm
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`(?:^|/)${re}`);
}

/** @param {string} root */
export function repoName(root) {
  if (process.env.GITNEXUS_REPO) return process.env.GITNEXUS_REPO;
  return path.basename(root);
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof loadHookConfig>} config
 */
export function isSourceCodePath(filePath, config, root) {
  let norm = (filePath ?? "").replace(/\\/g, "/");
  // Match against the REPO-RELATIVE path. sourceGlobs like `src/**` compile to patterns that match
  // "/src/" anywhere in the string, so an absolute path made enforcement depend on where the repo
  // happens to live: a checkout under ~/src or ~/go/src had EVERY file classified as source, so
  // every large Read and every Edit was gated repo-wide, with nothing in the message explaining why.
  const base = (root ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (base && norm.startsWith(base + "/")) norm = norm.slice(base.length + 1);
  norm = norm.replace(/^\.\//, "");
  if (!config.sourceExtRe.test(norm)) return false;
  return config.sourcePathRes.some((re) => re.test(norm));
}

/**
 * @param {string} pattern
 * @param {ReturnType<typeof loadHookConfig>} config
 */
export function isBroadSourceGlob(pattern, config) {
  const norm = (pattern ?? "").replace(/\\/g, "/").trim();
  if (!norm) return false;
  // The question is whether this sweeps source BROADLY, but the regexes below only ask "does it
  // start in a source directory / end in a source extension". Those are different questions, and
  // the gap ran both ways: `src/order.js` was blocked and `**/*` was allowed.

  // No wildcard at all → a literal path. Glob is being used to check whether one known file
  // exists, and `query` cannot answer a question about a path you already have. Blocking it is a
  // false deny with advice the agent cannot act on (NS-5).
  if (!/[*?{[]/.test(norm)) return false;

  // Catch-alls sweep every source file in the repo while naming no directory and no extension —
  // so the prefix/extension rules missed precisely the broadest patterns that exist.
  if (/^(?:\.\/)?(?:\*{1,2}|\*\*\/\*)$/.test(norm)) return true;

  // `**/*.{ts,tsx}` is as broad as `**/*.ts`; the single-extension rule alone never matched the
  // brace form, which is the way most people actually write a multi-language sweep.
  const brace = norm.match(/^\*\*\/\*\.\{([^}]+)\}$/);
  if (brace) {
    return brace[1].split(",").some((e) => config.sourceExtRe.test(`x.${e.trim()}`));
  }

  return config.broadGlobRes.some((re) => re.test(norm));
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof loadHookConfig>} config
 * @returns {EditSensitivity}
 */
export function editSensitivity(filePath, config, root) {
  const norm = (filePath ?? "").replace(/\\/g, "/");
  if (!norm) return "none";
  if (
    /\.(md|mdc|json|yaml|yml|txt|gitignore)$/i.test(norm) ||
    /(?:^|\/)docs\//.test(norm)
  ) {
    return "light";
  }
  if (/(\.cursor\/hooks|\.claude\/hooks|\.bearing)\//.test(norm) || /(?:^|\/)bundle\//.test(norm))
    return "light";
  if (/(?:^|\/)tests?\//.test(norm)) return "medium";
  if (/(?:^|\/)scripts\//.test(norm)) return "medium";
  if (isSourceCodePath(norm, config, root)) return "full";
  if (/(?:^|\/)apps\//.test(norm) && config.sourceExtRe.test(norm))
    return "full";
  return "none";
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
 * One playbook line for first nudge.
 * @param {object} hint
 * @param {string} repo
 */
export function playbookForHint(hint, repo) {
  const renamePlaybook = playbookRenameForHint(hint, repo);
  if (renamePlaybook) return renamePlaybook;

  const cypherPlaybook = playbookCypherForHint(hint, repo);
  if (cypherPlaybook) return cypherPlaybook;

  const snippet = (hint.snippet ?? "").replace(/"/g, "'").slice(0, 80);

  if (hint.codeTask) {
    const topic = hint.fileHint
      ? path.basename(hint.fileHint, path.extname(hint.fileHint))
      : hint.symbolHint || "<symbol>";
    return `PLAYBOOK: ${mcpImpact(topic, repo)} → edit → ${mcpDetectChanges(repo)}`;
  }
  if (hint.reasoning) {
    const sym = hint.symbolHint || "<symbol>";
    return `PLAYBOOK: ${mcpContext(sym, repo)} → ${mcpImpact(sym, repo)}`;
  }
  if (hint.architecture || hint.explore) {
    return `PLAYBOOK: ${mcpQuery({ query: snippet || "<topic>", taskContext: snippet, goal: "flows", repo })} → READ process/{name}`;
  }
  if (hint.symbolHint) {
    return `PLAYBOOK: ${mcpContext(hint.symbolHint, repo)}`;
  }
  return "";
}

const DENY_CACHE_FILE = ".gitnexus-deny-cache.json";

/** @param {string} root */
function denyCachePath(root) {
  return path.join(root, ".bearing", DENY_CACHE_FILE);
}

/** @param {string} root */
export function clearDenyCache(root) {
  try {
    fs.unlinkSync(denyCachePath(root));
  } catch {
    /* ignore */
  }
}

/**
 * Hook agent_message — always full (local LLM; no repeat compaction).
 * @param {string} _root
 * @param {string} _cacheKey
 * @param {string} full
 * @param {string} [_compact]
 */
export function hookAgentMessage(_root, _cacheKey, full, _compact) {
  return full;
}

/**
 * @param {{ permission: 'allow' | 'deny', agent_message?: string, user_message?: string }} result
 * @param {HookMode} mode
 */
export function applyHookMode(result, mode) {
  if (mode === "guide" && result.permission === "deny") {
    return {
      permission: "allow",
      agent_message: `[GUIDE MODE — normally blocked]\n${result.agent_message ?? ""}`,
      user_message: result.user_message,
    };
  }
  return result;
}

/**
 * @param {boolean} graphUsedThisSession
 * @param {string} [root]
 */
export function midSessionGraphNudge(graphUsedThisSession, root = "") {
  if (!graphUsedThisSession || !root) return "";
  return hookAgentMessage(
    root,
    "mid-session-graph",
    "MID-SESSION: query (graph+embeddings) for orient; context/impact for symbols and edits; cypher for field access / N-hop chains / overrides.",
    "",
  );
}

/**
 * Human-facing hook messages — enforcement stays on; voice explains the benefit.
 * @param {'block.glob'|'block.semantic'|'block.grep.noGraph'|'block.grep.symbol'|'block.grep.likely'|'block.grep.field'|'block.read.full'|'block.edit.stale'|'block.shell.stale'|'stale.must_refresh'|'stale.classical'|'drift.refresh'} key
 * @param {Record<string, string | number>} [vars]
 */
export function userMessage(key, vars = {}) {
  const sym = vars.symbol != null ? String(vars.symbol) : "";
  const lines = String(vars.lines ?? "");
  const templates = {
    "block.glob":
      "GitNexus has this codebase indexed — the agent will use graph search to find modules instead of scanning every file.",
    "block.semantic":
      "Exploratory questions go through GitNexus (graph + embeddings) so the agent maps real execution flows, not just text matches.",
    "block.grep.noGraph":
      "GitNexus goes first — the agent will look up this symbol in the knowledge graph before searching files.",
    "block.grep.symbol": sym
      ? `Symbol search is routed through GitNexus for "${sym}" — callers and relationships come from the graph, not grep.`
      : "Symbol search is routed through GitNexus — the graph knows callers and relationships better than grep.",
    "block.grep.likely":
      "This looks like a symbol search — GitNexus will resolve it in the knowledge graph instead of grep.",
    "block.grep.field": sym
      ? `Field/property search for "${sym}" is routed through GitNexus Cypher — the graph tracks readers and writers, not just text matches.`
      : "Field/property search is routed through GitNexus Cypher — ACCESSES edges show readers and writers.",
    "block.read.full": lines
      ? `Full-file read is blocked (${lines} lines). The agent will pull the relevant symbols from GitNexus, then read only what's needed.`
      : "Full-file read is blocked. The agent will use GitNexus to find the right symbols first, then read targeted sections.",
    "block.read.dataflow": lines
      ? `Full-file read blocked (${lines} lines) for data-flow tracing. The agent will use GitNexus Cypher (ACCESSES) and the graph instead of scanning the whole file.`
      : "Full-file read blocked for data-flow work — the agent will use GitNexus Cypher on field/property access edges.",
    "block.edit.stale":
      "The code graph is behind your latest commits. The agent must refresh GitNexus before editing source files — so changes stay accurate.",
    "block.shell.stale":
      "The code graph needs a refresh before other commands run. The agent will update GitNexus automatically.",
    "stale.must_refresh":
      "GitNexus index is behind — the agent must refresh the graph first (not grep/read). Hooks enforce refresh-then-graph, not skip-to-classical.",
    "stale.classical":
      "GitNexus refresh failed — the agent may use classic search now and must say why the graph could not be updated.",
    "drift.refresh":
      "The agent edited code since the last index, so graph queries would be stale — it will run a fast incremental refresh before continuing.",
  };
  return (
    templates[key] ??
    "GitNexus is guiding the agent to a better code-reasoning path."
  );
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

