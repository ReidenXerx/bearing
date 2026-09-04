#!/usr/bin/env node
/**
 * Vendor-neutral search classifier — the portable enforcement-policy core.
 *
 * This module knows NOTHING about Cursor's hook protocol (stdin shape,
 * `permission`/`agent_message` keys). It takes a normalized search request plus
 * a context object and returns a neutral {@link Verdict}. Any adapter — today the
 * Cursor `.sh` glue, tomorrow a Zed/other hook host — maps that Verdict onto its
 * own allow/deny wire format. This is where the grep/glob/semantic policy lives,
 * so effectiveness fixes happen in one tested place instead of inside shell heredocs.
 *
 * @typedef {Object} Verdict
 * @property {'allow'|'deny'} decision
 * @property {string} [agentMessage]   Full message for the agent (already composed).
 * @property {string} [userKey]        Key into hook-helpers.userMessage for the human line.
 * @property {Record<string, string|number>} [userVars]
 * @property {string} [scoreEvent]     On deny, glue bumps this session-scorecard counter.
 *
 * @typedef {Object} ClassifyCtx
 * @property {'fresh'|'must_refresh'|'classical_fallback'} phase
 * @property {boolean} graphUsed       Has any GitNexus MCP tool been used this session.
 * @property {ReturnType<import('./hook-helpers.mjs').loadHookConfig>} config
 * @property {string} repo
 * @property {string} root
 * @property {string} [staleMustRefreshMsg]  Precomputed agent message for must_refresh.
 * @property {string} [staleFallbackMsg]     Precomputed agent message for classical_fallback.
 * @property {boolean} [impactUsed]    (edit) gitnexus_impact already called this session.
 * @property {boolean} [detectUsed]    (commit) gitnexus_detect_changes already called.
 * @property {object} [promptHint]     (read) session prompt-router hint.
 * @property {() => number} [readLines] (read) lazily count lines of the target file.
 */
import * as helpers from "./hook-helpers.mjs";
import { howToRun, refreshCost } from './how-to-run.mjs';

/** Strip ONE layer of matching surrounding quotes or /regex/ delimiters. */
export function coreToken(pattern) {
  const t = String(pattern || "").trim();
  const m = t.match(/^(['"`/])([\s\S]*)\1[gimsuy]*$/);
  return (m ? m[2] : t).trim();
}

function isPlainIdentifier(t) {
  return /^[A-Za-z_$][\w$]*$/.test(t) && t.length >= 3;
}
function isDottedAccess(t) {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(t);
}
function isDeclSearch(t) {
  return /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+[A-Za-z_$]/.test(
    t,
  );
}

/**
 * True when the search is scoped to a clearly NON-source file/dir (config, docs,
 * fixtures, assets). Searching *inside* such a file is legitimate grep work even
 * if the term looks like an identifier — so this takes precedence over symbol shape.
 * @param {string} pathArg
 * @param {ClassifyCtx['config']} config
 * @param {string} [root] repo root, so classification is location-independent
 */
export /**
 * Paths this repo's index is not expected to contain — so redirecting a search there hands back an
 * empty result and no way forward.
 *
 * Measured, not assumed: `MATCH (n:File) WHERE n.filePath CONTAINS '<dir>'` returns 0 for
 * node_modules, vendor, dist, build and coverage on two real indexes. Anything outside the repo
 * root is excluded by definition. A search there is not a graph question asked the wrong way, it is
 * a question the graph cannot answer, and the redirect names a `context({name})` call that returns
 * nothing — a false deny (NS-5) whose suggested exit does not exist (NS-6). Found by being blocked
 * from reading a dependency's source while doing exactly that.
 *
 * `build` and `dist` are the soft entries: a repo CAN keep real source there, and if one does, the
 * gate stops covering it. That is a missed gate rather than a false deny, which is the direction
 * NS-5 says to err in — but it is a heuristic, not a proof, and the two are worth not confusing.
 */
function isUnindexedPath(pathArg, root) {
  const pa = String(pathArg || "").replace(/\\/g, "/");
  if (!pa) return false;
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.git|\.gitnexus)(?:\/|$)/.test(pa)) {
    return true;
  }
  // bearing's OWN installed files. `.gitnexusignore` excludes `.bearing/`, `.claude/`, `.agents/`
  // and `.zed/` from the index, and this list did not — so reading or grepping the kit's own hook
  // library was denied and redirected to a graph that provably has zero rows for it (measured:
  // `MATCH (n:File) WHERE n.filePath CONTAINS '.bearing'` returns nothing). The only exit was
  // `bearing:fallback`, which is a large share of the fallback grants in the field log — and it
  // fires on anyone auditing bearing inside their own repo. `editSensitivity` already exempts
  // `.bearing/`; the search side never did (NS-5, NS-6).
  if (/(?:^|\/)\.(?:bearing|claude|agents|zed|cursor|githooks)(?:\/|$)/.test(pa)) {
    return true;
  }
  // An absolute path that is not under the repo root is, by definition, not in this repo's graph.
  if (pa.startsWith("/") && root) {
    const r = String(root).replace(/\\/g, "/").replace(/\/$/, "");
    if (pa !== r && !pa.startsWith(r + "/")) return true;
  }
  return false;
}

function isNonSourcePath(pathArg, config, root) {
  const pa = String(pathArg || "").replace(/\\/g, "/");
  if (isUnindexedPath(pa, root)) return true;
  if (!pa || helpers.isSourceCodePath(pa, config, root)) return false;
  return (
    /\.(json|jsonl|ya?ml|toml|ini|cfg|conf|lock|csv|tsv|env|md|mdc|txt|log|rst|html?|css|scss|less|svg)$/i.test(
      pa,
    ) ||
    /(?:^|\/)(docs|fixtures?|__snapshots__|test-?data|testdata|public|assets|locales?|i18n|logs?)(?:\/|$)/i.test(
      pa,
    )
  );
}

/**
 * True when the pattern itself is a literal string / phrase / URL / regex rather
 * than a code symbol. Quotes are stripped first, so a quoted identifier is NOT a
 * literal (that was the historical bypass — `grep "validateUser"` sailed through).
 * @param {string} pattern
 */
export function isLiteralPattern(pattern) {
  const p = String(pattern || "");
  const t = coreToken(p);
  if (!t) return true;
  if (/\s/.test(t)) return true; // multi-word phrase / literal sentence
  if (/https?:\/\//i.test(p)) return true; // URL
  if (/\/[\w.-]+\/[\w.-]+/.test(p)) return true; // a/b/c path-ish
  if (/^\/[\s\S]*\/[gimsuy]*$/.test(p.trim())) return true; // /regex/
  if (/(TODO|FIXME|HACK|XXX|eslint-|@ts-|@type\b|@param\b|@returns?\b)/.test(p))
    return true;
  if (/\b(?:import|require|from|export\s+\*)\b/.test(t)) return true;
  if (/(?:console\.|process\.env|window\.|document\.|localStorage\.)/.test(p))
    return true;
  return false;
}

/** Reduce a token to the symbol an agent should look up (last dotted segment). */
function symbolOf(token) {
  return token.split(".").pop() || token;
}

/**
 * Pull a code symbol out of ONE grep branch — a bare/dotted identifier, or the name
 * in a decl/assignment search (`function foo`, `const foo`, `foo =`). Null for a
 * plain literal branch.
 * @param {string} raw
 */
function extractSymbol(raw) {
  const t = coreToken(raw).trim();
  if (!t) return null;
  if (isDottedAccess(t)) return symbolOf(t);
  if (isPlainIdentifier(t)) return t;
  let m = t.match(/\b(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]{2,})/);
  if (m) return m[1];
  m =
    t.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]{2,})/) ||
    t.match(/^([A-Za-z_$][\w$]{2,})\s*=(?!=)/);
  return m ? m[1] : null;
}

/**
 * A grep alternation (`a\|b`, `a|b`) is a symbol search when ANY branch names a
 * symbol. This was the historical miss — `grep "fooBar\|bazQux" file.js` matched
 * neither the symbol nor the literal test, so it defaulted to ALLOW.
 * @param {string} pattern
 * @returns {string|null} the first symbol found
 */
function symbolFromAlternation(pattern) {
  const core = coreToken(pattern);
  if (!/\|/.test(core)) return null;
  for (const branch of core.split(/\\?\|/)) {
    const s = extractSymbol(branch);
    if (s) return s;
  }
  return null;
}

/**
 * Classify a Grep/Glob/SemanticSearch request into an allow/deny Verdict.
 * @param {{ tool: string, toolInput: Record<string, any> }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyGrep(req, ctx) {
  const { tool, toolInput: ti = {} } = req;
  const { phase, config, repo, root, graphUsed } = ctx;
  const reNudge = helpers.midSessionGraphNudge(graphUsed, root);
  const tail = reNudge ? `\n${reNudge}` : "";

  // ── Stale phases: refresh-first, regardless of tool ──────────────────────
  if (phase === "classical_fallback") {
    return {
      decision: "allow",
      agentMessage: ctx.staleFallbackMsg,
      userKey: "stale.classical",
    };
  }

  // ── SemanticSearch: always route to hybrid query when not in fallback ────
  if (tool === "SemanticSearch") {
    if (phase === "must_refresh") {
      return {
        decision: "deny",
        agentMessage: ctx.staleMustRefreshMsg,
        userKey: "stale.must_refresh",
        scoreEvent: "grepRedirects",
      };
    }
    const q = ti.query ?? ti.search_term ?? "<topic>";
    const call = helpers.mcpQuery({ query: q, taskContext: q, goal: "flows", repo });
    return {
      decision: "deny",
      agentMessage: `SemanticSearch blocked → ${call}${tail}`,
      userKey: "block.semantic",
      scoreEvent: "grepRedirects",
    };
  }

  // ── Glob: block broad source sweeps, allow targeted/non-source globs ─────
  if (tool === "Glob") {
    const pattern = ti.glob_pattern ?? ti.pattern ?? "";
    if (phase === "fresh" && helpers.isBroadSourceGlob(pattern, config)) {
      const call = helpers.mcpQuery({
        query: "<concept>",
        taskContext: "find modules",
        goal: "entry points",
        repo,
      });
      return {
        decision: "deny",
        agentMessage: `Glob blocked → ${call}${tail}`,
        userKey: "block.glob",
        scoreEvent: "grepRedirects",
      };
    }
    return { decision: "allow", agentMessage: "Glob OK for non-source patterns." };
  }

  // ── Grep ─────────────────────────────────────────────────────────────────
  const pattern = ti.pattern ?? "";
  const pathArg = ti.path ?? ti.glob ?? "";
  if (!pattern) return { decision: "allow" };

  const nonSource = isNonSourcePath(pathArg, config, ctx?.root);

  // SCOPE-based allows. Each of these is a question the graph cannot answer better — or at all —
  // so redirecting them hands the agent a tool that returns nothing and no way forward (NS-5/NS-6).
  // All three were reported from real use, every one redirected to `cypher ACCESSES`:
  //   - a path naming ONE file: already scoped. "Is this string in this file" is not a graph query,
  //     and it is the exact inverse of the broad sweep the gate exists to catch.
  //   - tests/: which test exercises a name is not a source relationship the graph models.
  //   - count mode: "how many occurrences" is quantitative; the graph does not count text.
  const normPath = String(pathArg).replace(/\\/g, "/");
  const scopedToOneFile = /\.[A-Za-z0-9]+$/.test(normPath) && !/[*?]/.test(normPath);
  const inTests = /(?:^|\/)(?:tests?|__tests__|spec|specs)(?:\/|$)/.test(normPath);
  // Count mode ONLY counts as scoped when a path is given. Claude's `output_mode: "count"` returns
  // per-FILE counts, so a repo-wide count is `files_with_matches` (denied) plus a number — it
  // answers "which files contain this symbol", which is discovery. Allowing it unconditionally
  // handed every agent a one-flag bypass of the symbol gate. The reported case — counting a field
  // in the file just written — still passes, because it names a path.
  // A DIRECTORY scope is deliberately NOT allowed, and the deny message must stop promising it.
  // Allowing `src/hooks` sounds narrow until you notice `src` takes the same branch — and `src` is
  // the whole codebase, i.e. precisely the discovery sweep this gate exists to catch. The suite
  // pins that ("still denies the sweep the gate exists for"), and it is right: the exit is a FILE.
  const counting = (ti.output_mode ?? "") === "count" && Boolean(normPath);
  const scoped = scopedToOneFile || inTests || counting;

  const literal = nonSource || scoped || isLiteralPattern(pattern);

  if (phase === "must_refresh") {
    if (literal) {
      return {
        decision: "allow",
        agentMessage:
          "Literal/config grep OK during stale — run " + howToRun("bearing:agent-refresh") + " before symbol exploration.",
      };
    }
    return {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
      userKey: "stale.must_refresh",
      scoreEvent: "grepRedirects",
    };
  }

  // fresh — searching inside a non-source config/doc file is always fine, even
  // when the term is identifier-shaped.
  if (nonSource) {
    return { decision: "allow", agentMessage: "Grep OK — non-source config/doc search." };
  }
  if (scoped) {
    return {
      decision: "allow",
      agentMessage: scopedToOneFile
        ? "Grep OK — scoped to a single file, not a repo-wide sweep."
        : inTests
          ? "Grep OK — test-coverage search; the graph does not model which test names a symbol."
          : "Grep OK — counting occurrences is not a graph question.",
    };
  }

  const token = coreToken(pattern);
  let symbolish =
    isDeclSearch(token) || isPlainIdentifier(token) || isDottedAccess(token);
  // Alternation of symbols (a\|b\|c) — historically slipped through as neither symbol
  // nor literal. If any branch names a symbol, redirect on the first one.
  const altSym = symbolish ? null : symbolFromAlternation(pattern);
  if (altSym) symbolish = true;

  // LITERAL beats plain-identifier SHAPE, but never beats an explicit symbol alternation. A marker
  // like TODO/FIXME is a plain identifier by shape, so the symbolish branch used to win and deny it
  // — redirecting to gitnexus_context({name:"TODO"}), which resolves to nothing, and making the
  // TODO|FIXME|HACK|XXX carve-out in isLiteralPattern unreachable for single-token patterns.
  // The !altSym guard matters: a decl alternation ("isScaleIn =|const oppStop") contains a space,
  // so isLiteralPattern calls it literal — it is still a symbol search.
  // SCOPE and NON-SOURCE beat an alternation; only pattern SHAPE loses to it. A grep over ONE FILE
  // — or over a .txt/.log — that happens to contain `a|b|c` is not repo-wide symbol discovery, and
  // the graph has nothing to say about either. Denying it redirected to `context({name:"a"})` for
  // a word that is not a symbol. Hit while reading a test-run log during this very audit (NS-5).
  if (nonSource || scoped || (literal && !altSym)) {
    return { decision: "allow", agentMessage: "Grep OK — literal/config/doc search." };
  }

  if (symbolish) {
    if (altSym) {
      const call = helpers.mcpContext(altSym, repo);
      return {
        decision: "deny",
        agentMessage: `Grep blocked (symbol alternation) → ${call}${tail}`,
        userKey: "block.grep.symbol",
        userVars: { symbol: altSym },
        scoreEvent: "grepRedirects",
      };
    }
    const seg = symbolOf(token);
    // EVIDENCE, not capitalization. `isLikelyFieldName` is a camelCase test — `/^[a-z][a-zA-Z0-9]*$/`
    // — which is also the naming convention for every JS/TS function, method and hook. Measured on
    // this repo's own index: 380 of 398 indexed Function names took this branch, and 371 of those
    // have no :Property of that name at all. Only snake_case and PascalCase escaped, so the policy
    // was accidentally right for Python and wrong for JavaScript. `context` answers the Function
    // case AND returns the same ACCESSES edges for a real Property, so it is a strict superset.
    // A dotted access — `accountingHelpers.getJEDocumentCell` — is real evidence of a field read;
    // a bare `getJEDocumentCell` is not, and both took this branch (NS-5).
    const fieldLike =
      !isDeclSearch(token) && isDottedAccess(token) && helpers.isLikelyFieldName(seg);
    if (fieldLike) {
      const schema = helpers.mcpReadSchema(repo);
      const call = helpers.cypherFieldAccess(seg, repo);
      return {
        decision: "deny",
        // ACCESSES covers class fields; for plain-object shapes — option bags, config objects,
        // destructured params, object literals — it returns [] for fields that are read on every
        // request. Prescribing it without saying that turns the block into a dead end: the agent
        // runs the query, gets nothing, and has no sanctioned next step (NS-6).
        agentMessage:
          `Field grep blocked → ${schema} → ${call}${tail}\n` +
          `If that returns [] it is a known coverage gap, NOT proof the field is unused: ACCESSES ` +
          `indexes class fields, and plain-object properties (option bags, config objects, ` +
          `destructured params) often produce no rows. Then re-run this grep scoped to a single FILE ` +
          `— that is allowed; a directory is not — and report the gap: ` +
          `${howToRun("bearing:fallback")} -- "ACCESSES returned [] for <field> but grep finds N".\n` +
          `${helpers.cypherMidSessionNudge()}`,
        userKey: "block.grep.field",
        userVars: { symbol: seg },
        scoreEvent: "grepRedirects",
      };
    }
    const sym = isDeclSearch(token)
      ? token.replace(/^.*?\b((?:function|class|interface|type|enum)\s+)?([A-Za-z_$][\w$]*).*$/, "$2")
      : seg;
    const call = helpers.mcpContext(sym, repo);
    return {
      decision: "deny",
      agentMessage: `Grep blocked (symbol) → ${call}${tail}`,
      userKey: "block.grep.symbol",
      userVars: { symbol: sym },
      scoreEvent: "grepRedirects",
    };
  }

  if (literal) {
    return { decision: "allow", agentMessage: "Grep OK — literal/config/doc search." };
  }

  // Lowercase word, no path scope — likely a field or loosely-typed symbol.
  if (/^[a-z][a-zA-Z0-9]*$/.test(token) && token.length >= 6 && !pathArg) {
    if (helpers.isLikelyFieldName(token)) {
      const schema = helpers.mcpReadSchema(repo);
      const call = helpers.cypherFieldAccess(token, repo);
      return {
        decision: "deny",
        agentMessage: `Field grep → ${schema} → ${call}${tail}`,
        userKey: "block.grep.field",
        userVars: { symbol: token },
        scoreEvent: "grepRedirects",
      };
    }
    const call = helpers.mcpContext(token, repo);
    return {
      decision: "deny",
      agentMessage: `Symbol grep → ${call}${tail}`,
      userKey: "block.grep.likely",
      scoreEvent: "grepRedirects",
    };
  }

  return {
    decision: "allow",
    agentMessage:
      "Grep allowed — if this is a structural lookup, prefer:\n" +
      `  ${helpers.mcpContext("<symbol>", repo)}\n` +
      `  Field/property: ${helpers.mcpReadSchema(repo)} → ${helpers.cypherFieldAccess("<field>", repo)}${tail}`,
  };
}

/**
 * Classify a Read request. The glue supplies a lazy `readLines()` so this stays
 * pure (no fs) and only counts lines when the decision actually needs the size.
 * @param {{ toolInput: Record<string, any> }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyRead(req, ctx) {
  const { toolInput: ti = {} } = req;
  const { phase, config, repo, root, graphUsed } = ctx;
  // path (Cursor) | target_file (Cursor StrReplace) | file_path (Claude Code Read).
  const filePath = ti.path ?? ti.target_file ?? ti.file_path ?? "";
  const norm = String(filePath).replace(/\\/g, "/");
  const isSmallConfig =
    /\.(json|md|yaml|yml|mdc|sh)$/.test(filePath) || /package\.json$/.test(filePath);
  const isGeneratedSkill = /(\.cursor|\.claude|\.agents)\/skills\//.test(norm);
  // Can this repo's index contain the file AT ALL? `classifyGrep` has asked this since the day
  // someone was blocked from reading a dependency's source; `classifyRead` never did. So a Read of
  // another repo's file, or of node_modules, was denied and redirected at `query({repo:"<this>"})`
  // — a graph that cannot hold it. `isSourceCodePath` made it worse by matching `/src/` or `/lib/`
  // anywhere in an absolute path, so any foreign path containing either read as this repo's source.
  const unindexed = helpers ? isUnindexedPath(norm, root) : false;

  if (phase === "classical_fallback") {
    return { decision: "allow", agentMessage: ctx.staleFallbackMsg, userKey: "stale.classical" };
  }
  if (phase === "must_refresh") {
    // A stale index says nothing about a file the graph never indexed. The old allow-list was a
    // handful of extensions (.json/.md/.yaml/.sh), so reading a .csv, a .jsonl log or a .txt was
    // denied because HEAD had moved one commit — index freshness is irrelevant to all of them
    // (NS-5). Gate SOURCE reads, which is what the graph would actually have answered.
    const staleNonSource = filePath && !helpers.isSourceCodePath(norm, config, ctx.root);
    if (!filePath || isSmallConfig || isGeneratedSkill || staleNonSource || unindexed) {
      return {
        decision: "allow",
        agentMessage:
          "Non-source/config read OK during stale — refresh before source reads.",
      };
    }
    return {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
      userKey: "stale.must_refresh",
      scoreEvent: "readRedirects",
    };
  }

  // fresh
  if (!filePath) return { decision: "allow" };
  const hasRange = ti.offset !== undefined || ti.limit !== undefined;
  const isCode = helpers.isSourceCodePath(norm, config, ctx.root);
  const isTest = /(?:^|\/)tests?\//.test(norm);
  if (hasRange || isSmallConfig || isGeneratedSkill || isTest || !isCode) {
    return { decision: "allow" };
  }
  if (unindexed) {
    return {
      decision: "allow",
      agentMessage:
        "Read OK — that path is outside this repo's index (another repo, a dependency, or a directory .gitnexusignore excludes), so the graph has nothing to say about it.",
    };
  }

  const lineCount = typeof ctx.readLines === "function" ? ctx.readLines() : 0;
  const threshold = config.readLineThreshold ?? 60;
  if (lineCount <= threshold) return { decision: "allow" };

  // The index is built at HEAD, so an UNTRACKED file is not in it and never was. Redirecting the
  // read to `query`/`context` sends the agent to tools that return nothing for it — the block has
  // no alternative, which is the worst kind (NS-5/NS-6). Reported repeatedly during refactors that
  // scaffold new modules. Checked lazily and only here, on the path we were about to deny, so the
  // common allow case still costs nothing (NS-7).
  if (ctx.isUntracked?.()) {
    return {
      decision: "allow",
      agentMessage:
        "Read OK — this file is untracked, so the index (built at HEAD) cannot contain it and the graph has nothing to say about it.",
    };
  }

  const rel = norm;
  const base = rel.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const reNudge = helpers.midSessionGraphNudge(graphUsed, root);
  const tail = reNudge ? `\n${reNudge}` : "";
  const hint = ctx.promptHint ?? {};
  const dataFlow = helpers.isDataFlowReadContext(hint, rel);

  if (dataFlow) {
    const schema = helpers.mcpReadSchema(repo);
    const field = hint.fieldHint || base;
    const cy =
      hint.fieldHint || helpers.isLikelyFieldName(field)
        ? helpers.cypherFieldAccess(field, repo)
        : helpers.mcpQuery({ query: base, taskContext: rel, goal: "field data flow", repo });
    return {
      decision: "deny",
      agentMessage: `Read blocked (${lineCount}L, data-flow) → ${schema} → ${cy}; then Read offset/limit on cited symbols.${tail}`,
      userKey: "block.read.dataflow",
      userVars: { lines: lineCount },
      scoreEvent: "readRedirects",
    };
  }
  const q = helpers.mcpQuery({ query: base, taskContext: rel, goal: "module", repo });
  const c = helpers.mcpContext("<symbol>", repo);
  return {
    decision: "deny",
    agentMessage: `Read blocked (${lineCount}L) → ${q} then ${c}; Read offset/limit for edits.${tail}`,
    userKey: "block.read.full",
    userVars: { lines: lineCount },
    scoreEvent: "readRedirects",
  };
}

/**
 * Classify a Write/StrReplace edit: staleness gate → impact-before-edit gate →
 * tiered reminder (allow). Mirrors the historical edit-guard exactly.
 * @param {{ tool: string, toolInput: Record<string, any> }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyEdit(req, ctx) {
  const { toolInput: ti = {} } = req;
  const { phase, config, repo } = ctx;
  const filePath = (ti.path ?? ti.file_path ?? "").replace(/\\/g, "/");
  const sensitivity = helpers.editSensitivity(filePath, config, ctx.root);
  const staleDetail = ctx.staleDetail || "GitNexus index is not fresh.";
  // Rename is detected by an old→new identifier swap, regardless of which edit
  // tool fired it (Cursor StrReplace or Claude Edit).
  const hasReplace = ti.old_string !== undefined && ti.new_string !== undefined;

  // Staleness gate — runtime source/tests/scripts (medium|full) wait for refresh.
  if (sensitivity !== "none" && sensitivity !== "light" && phase !== "fresh") {
    if (phase === "classical_fallback") {
      return {
        decision: "allow",
        agentMessage:
          "STALENESS: refresh failed — editing allowed; graph may be behind, state why in one sentence.",
      };
    }
    return {
      decision: "deny",
      agentMessage:
        "STALENESS GATE: " +
        staleDetail +
        ` Edits blocked until refresh — Shell NOW: ${howToRun("bearing:agent-refresh")} (required_permissions: ["all"], pre-approved). Never ask the user to analyze.`,
      userKey: "block.edit.stale",
      scoreEvent: "editStaleBlocks",
    };
  }

  // Impact-before-edit — runtime source edits require one impact/rename call/session.
  if (sensitivity === "full" && !ctx.impactUsed) {
    const renameAhead =
      hasReplace ? helpers.detectIdentifierRename(ti.old_string, ti.new_string) : null;
    const widen = helpers.isDataFlowReadContext({}, filePath);
    const impactOpts = widen ? { relationTypes: ["CALLS", "IMPORTS", "ACCESSES"] } : {};
    const playbook = renameAhead
      ? `${helpers.mcpImpact(renameAhead.oldName, repo, impactOpts)} → ${helpers.mcpRename(renameAhead.oldName, renameAhead.newName, repo, true)}`
      : helpers.mcpImpact("<symbol-you-are-editing>", repo, impactOpts);
    return {
      decision: "deny",
      agentMessage:
        `IMPACT GATE: run blast-radius analysis before editing runtime source — ${playbook}. ` +
        (widen ? "Model/DTO file — widened to ACCESSES so field readers/writers are included. " : "") +
        "Review d=1 (WILL BREAK) + risk; warn on HIGH/CRITICAL. This gate clears for the rest of the session after one impact call.",
      userVars: {},
      userMessageText:
        "Before editing source, the agent checks blast radius in GitNexus (what breaks) — graph-first safety, not blind edits.",
      scoreEvent: "impactGate",
    };
  }

  // Allow with a tiered reminder.
  const renamePair =
    hasReplace ? helpers.detectIdentifierRename(ti.old_string, ti.new_string) : null;
  let agentMessage;
  if (renamePair && sensitivity !== "none") {
    const impact = helpers.mcpImpact(renamePair.oldName, repo);
    const rn = helpers.mcpRename(renamePair.oldName, renamePair.newName, repo, true);
    agentMessage = `RENAME detected: ${impact} → ${rn} (dry_run) — do NOT StrReplace symbol names across files.`;
  } else if (sensitivity === "full") {
    agentMessage = `EDIT: ${helpers.mcpImpact("<symbol>", repo)} first. HIGH/CRITICAL → review full impact output. Done: ${helpers.mcpDetectChanges(repo)}`;
  } else if (sensitivity === "medium") {
    agentMessage = `EDIT: ${helpers.mcpImpact("<symbol>", repo)} if shared symbol. Done: ${helpers.mcpDetectChanges(repo)}`;
  } else if (phase !== "fresh") {
    agentMessage = `STALE: ${staleDetail}`;
  }
  return { decision: "allow", agentMessage };
}

/**
 * Classify a `git commit` shell command: require one detect_changes/session,
 * refresh first if stale. Non-commit commands pass straight through.
 * @param {{ command: string }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyCommit(req, ctx) {
  const command = req.command || "";
  const { phase, repo } = ctx;
  // `commit` must be the SUBCOMMAND, not any occurrence of the word. As a loose substring this
  // denied read-only work: `git rev-parse HEAD^{commit}`, `git log --grep=commit`,
  // `git show <sha> -- src/commit.ts` — all allowed by the shell gate, then blocked here.
  const isCommit =
    /\bgit\b(?:\s+\S+)*?\s+commit(?:\s|$)/.test(command) &&
    !/--help|-h\b/.test(command);
  if (!isCommit) return { decision: "allow" };

  if (phase === "must_refresh") {
    return {
      decision: "deny",
      agentMessage: `${ctx.staleMustRefreshMsg}${compoundNotice(command)}`,
      userKey: "block.shell.stale",
    };
  }
  if (ctx.detectUsed) return { decision: "allow" };

  const noVerify = /--no-verify/.test(command);
  return {
    decision: "deny",
    agentMessage:
      "COMMIT GATE: review change scope in the graph before committing — " +
      `${helpers.mcpDetectChanges(repo, "staged")}. ` +
      "Confirm affected processes match intent + run tests for them; warn on HIGH/CRITICAL. " +
      "This gate clears for the session after one detect_changes call." +
      (noVerify
        ? " NOTE: --no-verify also skips the pre-commit refresh — run " + howToRun("bearing:pdg") + " after."
        : "") +
      // `git add -A && git commit -m x` is the most common shape this gate ever sees, and the
      // whole line is blocked — the staging did NOT happen either.
      compoundNotice(command),
    userMessageText:
      "Before committing, the agent checks what changed across the graph (affected flows) via GitNexus — not a blind commit.",
    scoreEvent: "commitGate",
  };
}

/**
 * Classify a generic Shell command under the staleness gate. GitNexus maintenance
 * and read-only git pass; otherwise stale → refresh first.
 * @param {{ command: string }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
// ── Shell-command code search ────────────────────────────────────────────────
// The Grep TOOL is gated by classifyGrep, but an agent can run `grep`/`rg`/`git grep`
// in the terminal to search source and bypass it entirely (the exact behaviour that
// looks like "grepping instead of using the graph"). parseShellSearch pulls the
// (pattern, path) out of such a command so classifyShell can apply the SAME policy.

const SEARCH_TOOL_RE = /^(grep|egrep|fgrep|rg|ripgrep|ag|ack)$/;
const RECURSIVE_TOOL_RE = /^(rg|ripgrep|ag|ack|git grep)$/;
const GREP_FAMILY_RE = /^(grep|egrep|fgrep)$/;
const FLAG_TAKES_VALUE_RE =
  /^(-m|-A|-B|-C|-d|-g|-t|--max-count|--context|--after-context|--before-context|--glob|--type|--include|--exclude)$/;

/**
 * Quote/escape-aware split of a shell command into pipeline segments (each a token
 * list), tracking whether a segment is fed by a pipe (stdin). Keeps `grep "a\|b"`
 * as ONE segment — the `\|` is inside quotes, not a pipeline separator.
 * @param {string} command
 */
function shellSegments(command) {
  const segs = [];
  let cur = [];
  let tok = "";
  let hasTok = false;
  let quote = null;
  let segPiped = false;
  const pushTok = () => {
    if (hasTok) {
      cur.push(tok);
      tok = "";
      hasTok = false;
    }
  };
  const flush = (nextPiped) => {
    pushTok();
    if (cur.length) segs.push({ args: cur, piped: segPiped });
    cur = [];
    segPiped = nextPiped;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === "\\" && i + 1 < command.length) tok += command[++i];
      else tok += c;
      hasTok = true;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      hasTok = true;
      continue;
    }
    if (c === "\\") {
      if (i + 1 < command.length) {
        tok += command[++i];
        hasTok = true;
      }
      continue;
    }
    if (c === "|") {
      const dbl = command[i + 1] === "|";
      flush(!dbl); // single pipe feeds the next segment stdin; `||` is logical
      if (dbl) i++;
      continue;
    }
    if (c === "&") {
      if (command[i + 1] === "&") i++;
      flush(false);
      continue;
    }
    if (c === ";" || c === "\n") {
      flush(false);
      continue;
    }
    if (/\s/.test(c)) {
      pushTok();
      continue;
    }
    tok += c;
    hasTok = true;
  }
  flush(false);
  return segs;
}

/**
 * If a segment is a source-searching grep/rg/ag/ack/git-grep, return {tool, pattern,
 * path}. Returns null for a stdin filter (`ps aux | grep node`) or a non-search command.
 * @param {{ args: string[], piped: boolean }} seg
 */
function segSearch(seg) {
  const piped = Boolean(seg?.piped);
  const a = seg.args;
  if (!a.length) return null;
  let tool = a[0];
  let rest = a.slice(1);
  if (tool === "git" && rest[0] === "grep") {
    tool = "git grep";
    rest = rest.slice(1);
  } else if (!SEARCH_TOOL_RE.test(tool)) {
    return null;
  }

  let patternFromE = null;
  let recursive = RECURSIVE_TOOL_RE.test(tool);
  const positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--") {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (t.length > 1 && t[0] === "-") {
      if (t === "-e" || t === "--regexp") {
        patternFromE = patternFromE ?? rest[++i];
        continue;
      }
      if (t.startsWith("--regexp=")) {
        patternFromE = patternFromE ?? t.slice(9);
        continue;
      }
      if (FLAG_TAKES_VALUE_RE.test(t) || t === "-f" || t === "--file") {
        i++; // consume the flag's value
        continue;
      }
      if (/^-[A-Za-z]*[rR]/.test(t)) recursive = true;
      continue; // other flags carry no positional
    }
    positionals.push(t);
  }
  const pattern = patternFromE ?? positionals.shift();
  if (pattern == null) return null;
  const paths = positionals;
  // A search with NO PATH that is fed by a pipe reads STDIN — it is filtering command output, not
  // searching the repo, so the graph cannot answer it and a redirect is unfollowable advice. This
  // applied only to grep/egrep/fgrep before: rg/ag/ack are "recursive by default", so
  // `npm run build 2>&1 | rg error` and `kubectl get pods | rg gateway` were denied and the agent
  // was handed a Cypher query for a log filter.
  if (piped && paths.length === 0) return null;
  // Unpiped grep-family with no path is also a stdin filter (it would hang otherwise).
  if (GREP_FAMILY_RE.test(tool) && !recursive && paths.length === 0) return null;
  return { tool, pattern, path: paths[0] ?? "" };
}

/** First source-code search in a shell command, else null. */
function parseShellSearch(command) {
  for (const seg of shellSegments(command)) {
    const s = segSearch(seg);
    if (s) return s;
  }
  return null;
}

/**
 * A denied Bash call blocks the ENTIRE command line — no segment of it runs. Naming only the
 * offending part reads as "the rest executed", so an agent whose `python3 edit.py && grep …` was
 * blocked believes its edits landed and reports work that never happened. In a repo whose whole
 * point is not shipping silent failures, that is the worst failure mode available, so say it
 * outright whenever the command was sequenced.
 *
 * NEWLINES COUNT. A newline separates steps in bash exactly as `;` does, and the incident this
 * notice was written for had no operator in it at all — a heredoc, then a search on the next line:
 *
 *     python3 - <<'PY'      # rewrites several call sites
 *     …
 *     PY
 *     grep -c "someField" src/thing.js
 *
 * The guard blocked the trailing grep, bash rejected the whole line, and the rewrites never ran —
 * so an operator-only test stayed silent on precisely the shape that costs silent edits.
 *
 * A backslash-escaped newline is a LINE CONTINUATION, not a separator, and is excluded: `foo \`
 * then `--bar` is one step. The second lookbehind covers CRLF, where the byte before the `\n` is
 * the `\r` rather than the backslash — without it the exclusion silently fails on Windows.
 *
 * Over-warning is the safe direction: this fires only on a DENY, where "nothing ran" is true by
 * construction. A missing notice costs silently-lost work; a redundant one costs a line of text.
 * @param {string} command
 */
function compoundNotice(command) {
  return /(?:&&|\|\||;|(?<!\\)(?<!\\\r)[\r\n])/.test(String(command ?? ""))
    ? "\n\u26a0 NOTHING IN THIS COMMAND RAN \u2014 the WHOLE line was blocked, not just the flagged part. Any earlier steps (edits, writes, installs) did NOT execute. Re-run them separately after the graph call."
    : "";
}

export function classifyShell(req, ctx) {
  const command = req.command || "";
  const { phase } = ctx;
  // CURRENT script name first, the pre-rename one kept as an alias (NS-15). This named only
  // `gitnexus-agent.mjs` after the rename to `bearing-*`, so the escape hatch the gates themselves
  // print — `node scripts/bearing-agent.mjs fallback "<why>"` — was not recognised as maintenance
  // and got the graph-first redirect instead of a pass. A block whose documented exit is itself
  // gated is the trap NS-6 exists to prevent. The identical defect was fixed in the Cursor shell
  // allowlist and this sibling was missed — GP-24, on the path that now matters most.
  const isGitnexusMaint =
    /\bnpm run (bearing|gitnexus):[\w.-]+/.test(command) ||
    /\bnode scripts\/(bearing|gitnexus)-agent\.mjs\b/.test(command) ||
    /\bnpx(?:\s+-y)?\s+gitnexus(?:@latest)?\b/.test(command);
  const isReadOnlyGit =
    /\bgit\s+(status|diff|log|show|branch|rev-parse|check-ignore|check-attr)\b/.test(command);

  if (isGitnexusMaint || isReadOnlyGit) {
    return {
      decision: "allow",
      agentMessage: isGitnexusMaint ? "GitNexus maintenance pre-approved." : undefined,
    };
  }
  if (phase === "fresh") {
    // Close the terminal escape hatch: a shell code-symbol search gets the SAME
    // graph-first redirect as the Grep tool. Piped filters / non-source / literal
    // searches fall through to allow (classifyGrep decides).
    const s = parseShellSearch(command);
    if (s) {
      const g = classifyGrep(
        { tool: "Grep", toolInput: { pattern: s.pattern, path: s.path } },
        ctx,
      );
      if (g.decision === "deny") {
        return {
          ...g,
          userKey: "block.shell.search",
          agentMessage: `Shell \`${s.tool}\` for a code symbol bypasses the graph → ${g.agentMessage}${compoundNotice(command)}`,
        };
      }
    }
    return { decision: "allow" };
  }
  if (phase === "classical_fallback") {
    return { decision: "allow", agentMessage: ctx.staleFallbackMsg };
  }

  // must_refresh. Deny only what a STALE GRAPH would have answered — a code search. Everything
  // else (ls, tail, cat, npm test, a python script) has nothing to do with index freshness, and
  // blanket-denying it bricked the shell over a single commit of drift: the agent could not run
  // `ls` or tail a log until a full reindex finished. That is the textbook false deny — it blocks
  // work the gate was never meant to cover, with advice the agent cannot act on (NS-5).
  const staleSearch = parseShellSearch(command);
  if (!staleSearch) return { decision: "allow" };
  let staleGrep;
  try {
    staleGrep = classifyGrep(
      { tool: "Grep", toolInput: { pattern: staleSearch.pattern, path: staleSearch.path } },
      ctx,
    );
  } catch {
    // A caller that supplies no config cannot classify paths. Deny the search — it IS a code
    // search against a stale index — but never take the whole shell down with it
    // (NS-8: fail open on the hot path, fail closed on the graph).
    staleGrep = { decision: "deny" };
  }
  if (staleGrep.decision !== "deny") return { decision: "allow" };
  return {
    decision: "deny",
    agentMessage: `${ctx.staleMustRefreshMsg}${compoundNotice(command)}`,
    userKey: "block.shell.stale",
  };
}

// ── Graph query tools gated by working-tree DRIFT ────────────────────────────
// The grep/shell gates keep the agent ON the graph, but the graph goes stale vs the
// agent's UNCOMMITTED edits — commit-based staleness can't see them (HEAD unchanged →
// "fresh" forever). These tools READ graph structure, so after N source edits they
// return answers that ignore the edits → require a FAST incremental refresh first.
// Non-query tools (detect_changes, rename, check, tool_map…) always pass.
const DRIFT_GATED_TOOLS = new Set([
  "query", "context", "cypher", "impact", "pdg_query",
  "trace", "explain", "api_impact", "route_map", "shape_check",
]);

/** Normalize a GitNexus MCP tool name to its bare suffix (query/context/pdg_query/…). */
export function mcpToolSuffix(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^mcp__gitnexus__/, "")
    .replace(/^mcp_gitnexus_/, "")
    .replace(/^gitnexus[_.]/, "")
    .trim();
}

/**
 * Drift gate for graph QUERY tools. When ≥threshold source files changed since the index
 * (stale.driftingFiles), those tools return results that ignore the edits → deny with a
 * nudge to a FAST incremental refresh. Allow for non-query tools, under threshold, or when
 * disabled (threshold ≤ 0), or when the phase isn't `fresh`.
 * @param {string} toolName
 * @param {{ driftingFiles?: number }} stale
 * @param {{ driftRefreshThreshold?: number }} config
 * @param {string} [phase] staleness phase — drift only applies on `fresh`
 * @returns {Verdict}
 */
/**
 * The `graph_behind` gate: HEAD moved, but by fewer source files than the drift threshold.
 *
 * Same shape as the drift gate and for the same reason — a graph that is a few files out of date
 * answers confidently from code that has changed. The difference from `must_refresh` is what stays
 * open: classical tools, because the index is out of date rather than invalid, and taking away grep
 * over a two-file gap is how a proportionate signal turns into a stopped session.
 * @param {string} toolName @param {{ behindFiles?: number }} stale
 * @returns {Verdict}
 */
export function classifyGraphBehind(toolName, stale) {
  const suffix = mcpToolSuffix(toolName);
  if (!DRIFT_GATED_TOOLS.has(suffix)) return { decision: "allow" };
  const n = Number(stale?.behindFiles) || 0;
  // ALLOW, and say why. Below the threshold the two halves of the same condition used to disagree:
  // a few UNCOMMITTED dirty files left the graph tools open, while the same few files COMMITTED
  // denied them. Same gap, opposite treatment, decided only by whether you had run `git commit`.
  // Under the threshold the graph is close enough to answer with; over it, must_refresh still stops.
  return {
    decision: "allow",
    agentMessage:
      `Graph is ${n} source file(s) behind HEAD — gitnexus_${suffix} would answer from the older ` +
      "code. Resync: `" + howToRun("bearing:refresh") + "`" + refreshCost() + ", then retry. Read/Grep " +
      "are OPEN meanwhile: this is a small measured gap, not a broken index.",
    userKey: "stale.graph_behind",
    scoreEvent: "graphBehindBlocks",
  };
}

export function classifyMcpDrift(toolName, stale, config, phase) {
  // Same switch as the staleness phase: with the gate off, uncommitted drift reports but never
  // denies. Kept here as well as in the policy because this gate is reached directly by the MCP
  // guard on a COMMIT-FRESH index, which never goes through evaluateStalePolicy's stale branch.
  if (config?.stalenessGate !== "block") return { decision: "allow" };
  // Drift applies ONLY on a commit-FRESH index. Never in classical_fallback (a failed refresh
  // OR a user-granted fallback) — forcing a refresh there would loop or override the escape
  // hatch — nor must_refresh (already handled). Undefined phase = caller pre-checked (allow through).
  if (phase != null && phase !== "fresh") return { decision: "allow" };
  const threshold = Number(config?.driftRefreshThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0) return { decision: "allow" };
  const count = Number(stale?.driftingFiles) || 0;
  if (count < threshold) return { decision: "allow" };
  const suffix = mcpToolSuffix(toolName);
  if (!DRIFT_GATED_TOOLS.has(suffix)) return { decision: "allow" };
  return {
    decision: "deny",
    agentMessage:
      `Graph is ${count} uncommitted edit(s) behind your working tree — gitnexus_${suffix} would ` +
      "return STALE results that ignore your changes. Resync first: `" + howToRun("bearing:refresh") + "`" + refreshCost() + " " +
      "(incremental — reindexes only your changed files; usually quick), then retry.",
    userKey: "drift.refresh",
    scoreEvent: "driftRefreshBlocks",
  };
}
