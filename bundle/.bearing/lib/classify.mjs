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
 */
export function isNonSourcePath(pathArg, config) {
  const pa = String(pathArg || "").replace(/\\/g, "/");
  if (!pa || helpers.isSourceCodePath(pa, config)) return false;
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

  const nonSource = isNonSourcePath(pathArg, config);
  const literal = nonSource || isLiteralPattern(pattern);

  if (phase === "must_refresh") {
    if (literal) {
      return {
        decision: "allow",
        agentMessage:
          "Literal/config grep OK during stale — run npm run gitnexus:agent-refresh before symbol exploration.",
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

  const token = coreToken(pattern);
  let symbolish =
    isDeclSearch(token) || isPlainIdentifier(token) || isDottedAccess(token);
  // Alternation of symbols (a\|b\|c) — historically slipped through as neither symbol
  // nor literal. If any branch names a symbol, redirect on the first one.
  const altSym = symbolish ? null : symbolFromAlternation(pattern);
  if (altSym) symbolish = true;

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
    const fieldLike = !isDeclSearch(token) && helpers.isLikelyFieldName(seg);
    if (fieldLike) {
      const schema = helpers.mcpReadSchema(repo);
      const call = helpers.cypherFieldAccess(seg, repo);
      return {
        decision: "deny",
        agentMessage: `Field grep blocked → ${schema} → ${call}${tail}\n${helpers.cypherMidSessionNudge()}`,
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

  if (phase === "classical_fallback") {
    return { decision: "allow", agentMessage: ctx.staleFallbackMsg, userKey: "stale.classical" };
  }
  if (phase === "must_refresh") {
    if (!filePath || isSmallConfig || isGeneratedSkill) {
      return {
        decision: "allow",
        agentMessage:
          "Small/config read OK during stale — refresh before large source reads.",
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
  const isCode = helpers.isSourceCodePath(norm, config);
  const isTest = /(?:^|\/)tests?\//.test(norm);
  if (hasRange || isSmallConfig || isGeneratedSkill || isTest || !isCode) {
    return { decision: "allow" };
  }

  const lineCount = typeof ctx.readLines === "function" ? ctx.readLines() : 0;
  const threshold = config.readLineThreshold ?? 60;
  if (lineCount <= threshold) return { decision: "allow" };

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
  const sensitivity = helpers.editSensitivity(filePath, config);
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
        ' Edits blocked until refresh — Shell NOW: npm run gitnexus:agent-refresh (required_permissions: ["all"], pre-approved). Never ask the user to analyze.',
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
  const isCommit = /\bgit\b[^\n]*\bcommit\b/.test(command) && !/--help|-h\b/.test(command);
  if (!isCommit) return { decision: "allow" };

  if (phase === "must_refresh") {
    return {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
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
        ? " NOTE: --no-verify also skips the pre-commit PDG refresh — run npm run gitnexus:pdg after."
        : ""),
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
  // grep-family with no path and not recursive = a stdin filter, not a file search.
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

export function classifyShell(req, ctx) {
  const command = req.command || "";
  const { phase } = ctx;
  const isGitnexusMaint =
    /\bnpm run gitnexus:[\w.-]+/.test(command) ||
    /\bnode scripts\/gitnexus-agent\.mjs\b/.test(command) ||
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
          agentMessage: `Shell \`${s.tool}\` for a code symbol bypasses the graph → ${g.agentMessage}`,
        };
      }
    }
    return { decision: "allow" };
  }
  if (phase === "classical_fallback") {
    return { decision: "allow", agentMessage: ctx.staleFallbackMsg };
  }
  return {
    decision: "deny",
    agentMessage: ctx.staleMustRefreshMsg,
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
export function classifyMcpDrift(toolName, stale, config, phase) {
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
      "return STALE results that ignore your changes. Resync first: `npm run gitnexus:refresh` " +
      "(incremental — reindexes only your changed files; usually quick), then retry.",
    userKey: "drift.refresh",
    scoreEvent: "driftRefreshBlocks",
  };
}
