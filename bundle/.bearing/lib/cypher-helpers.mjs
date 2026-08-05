#!/usr/bin/env node
/**
 * Cypher copy-paste helpers — raw graph queries when query/context/impact are not enough.
 * READ gitnexus://repo/{name}/schema before ad-hoc Cypher.
 */

/** @param {string} s */
function escCypher(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} repo */
export function mcpReadSchema(repo) {
  return `READ gitnexus://repo/${repo}/schema`;
}

/**
 * @param {string} query Cypher query (single line ok)
 * @param {string} repo
 * @param {Record<string, string | number> | null} [params]
 */
export function mcpCypher(query, repo, params = null) {
  const q = escCypher(query);
  if (params && Object.keys(params).length > 0) {
    return `gitnexus_cypher({ statement: "${q}", params: ${JSON.stringify(params)}, repo: "${repo}" })`;
  }
  return `gitnexus_cypher({ statement: "${q}", repo: "${repo}" })`;
}

/** Shortest directed call path between two symbols (GitNexus v1.6.8 trace tool). */
export function mcpTrace(from, to, repo, maxDepth = 10) {
  const a = escCypher(from);
  const b = escCypher(to);
  return `gitnexus_trace({ from: "${a}", to: "${b}", repo: "${repo}", maxDepth: ${maxDepth} })`;
}

/** PDG-powered impact for precise control/data affectedness (requires index built with --pdg). */
export function mcpPdgImpact(target, repo, opts = {}) {
  const safe = escCypher(target);
  const line = Number.isInteger(opts.line) ? `, line: ${opts.line}` : "";
  return `gitnexus_impact({ target: "${safe}", direction: "upstream", mode: "pdg", repo: "${repo}", summaryOnly: false${line} })`;
}

/** Control-dependence query: what guards/conditions control this function or file? */
export function mcpPdgControls(target, repo) {
  const safe = escCypher(target);
  return `gitnexus_pdg_query({ mode: "controls", target: "${safe}", repo: "${repo}" })`;
}

/** Data-dependence query: where does a variable flow inside the anchored function/file? */
export function mcpPdgFlows(target, repo, variable = "") {
  const safe = escCypher(target);
  const varArg = variable ? `, variable: "${escCypher(variable)}"` : "";
  return `gitnexus_pdg_query({ mode: "flows", target: "${safe}", repo: "${repo}"${varArg} })`;
}

/** Persisted taint findings (security source→sink paths; requires PDG/taint layer). */
export function mcpTaintExplain(target, repo) {
  const safe = escCypher(target || "");
  return safe
    ? `gitnexus_explain({ target: "${safe}", repo: "${repo}" })`
    : `gitnexus_explain({ repo: "${repo}" })`;
}

/**
 * Field read/write via ACCESSES edges.
 * Source node is left untyped so Methods/Structs/Impls (polyglot) count, not only Functions.
 * @param {'read'|'write'|'both'} reason
 */
export function cypherFieldAccess(field, repo, reason = "both") {
  const name = escCypher(field);
  const rel =
    reason === "read"
      ? "{type: 'ACCESSES', reason: 'read'}"
      : reason === "write"
        ? "{type: 'ACCESSES', reason: 'write'}"
        : "{type: 'ACCESSES'}";
  const q = `MATCH (f)-[r:CodeRelation ${rel}]->(p:Property {name: $name}) RETURN f.name, f.filePath, f.kind, r.reason ORDER BY f.filePath LIMIT 50`;
  return mcpCypher(q, repo, { name: field });
}

/** Multi-hop CALLS chain ending at symbol (target untyped — Functions or Methods). */
export function cypherCallChain(symbol, repo, maxDepth = 3) {
  const q = `MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..${maxDepth}]->(b {name: $name}) RETURN [n IN nodes(path) | n.name] AS chain, length(path) AS depth ORDER BY depth LIMIT 20`;
  return mcpCypher(q, repo, { name: symbol, maxDepth });
}

/** Direct callers via CALLS (when context incoming is incomplete). */
export function cypherCallers(symbol, repo) {
  const q =
    "MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f {name: $name}) RETURN caller.name, caller.filePath, caller.kind ORDER BY caller.filePath LIMIT 50";
  return mcpCypher(q, repo, { name: symbol });
}

/** Method override chain (MRO). */
export function cypherMethodOverrides(method, repo) {
  const q =
    "MATCH (winner:Method)-[r:CodeRelation {type: 'METHOD_OVERRIDES'}]->(loser:Method {name: $name}) RETURN winner.name, winner.filePath, loser.filePath, r.reason LIMIT 30";
  return mcpCypher(q, repo, { name: method });
}

/** Process steps ordered by step index. */
export function cypherProcessSteps(processLabel, repo) {
  const q =
    "MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process) WHERE p.heuristicLabel CONTAINS $label RETURN s.name, s.filePath, r.step ORDER BY r.step LIMIT 40";
  return mcpCypher(q, repo, { label: processLabel });
}

/** Class methods via HAS_METHOD. */
export function cypherClassMethods(className, repo) {
  const q =
    "MATCH (c:Class {name: $name})-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method) RETURN m.name, m.filePath, m.parameterCount ORDER BY m.name LIMIT 50";
  return mcpCypher(q, repo, { name: className });
}

/**
 * Prompt / grep pattern looks like a field/property name (not PascalCase symbol).
 * @param {string} pattern
 */
export function isLikelyFieldName(pattern) {
  if (!pattern || pattern.length < 3 || pattern.length > 40) return false;
  if (!/^[a-z][a-zA-Z0-9]*$/.test(pattern)) return false;
  if (
    /^(true|false|null|undefined|async|await|const|let|var|function|class|import|export|return|throw|catch|default)$/.test(
      pattern,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Pick a Cypher playbook from prompt-router hint.
 * @param {object} hint
 * @param {string} repo
 */
export function playbookCypherForHint(hint, repo) {
  const schema = mcpReadSchema(repo);

  if (hint.taintHint) {
    return `PLAYBOOK: ${mcpTaintExplain(hint.fileHint || hint.symbolHint || "", repo)} → ${mcpPdgImpact(hint.symbolHint || hint.fileHint || "<symbol-or-file>", repo)}`;
  }
  if (hint.pdgFlowHint) {
    return `PLAYBOOK: ${mcpPdgFlows(hint.symbolHint || hint.fileHint || "<function-or-file>", repo, hint.variableHint || "")}`;
  }
  if (hint.pdgControlHint) {
    return `PLAYBOOK: ${mcpPdgControls(hint.symbolHint || hint.fileHint || "<function-or-file>", repo)}`;
  }
  if (hint.pdgImpactHint) {
    return `PLAYBOOK: ${mcpPdgImpact(hint.symbolHint || hint.fileHint || "<symbol-or-file>", repo)}`;
  }

  if (hint.fieldHint) {
    const reason = hint.fieldWrite ? "write" : hint.fieldRead ? "read" : "both";
    return `PLAYBOOK: ${schema} → ${cypherFieldAccess(hint.fieldHint, repo, reason)}`;
  }
  if (hint.traceFrom && hint.traceTo) {
    return `PLAYBOOK: ${mcpTrace(hint.traceFrom, hint.traceTo, repo, hint.hopDepth ?? 10)}`;
  }
  if (hint.callChainHint) {
    return `PLAYBOOK: ${schema} → ${cypherCallChain(hint.callChainHint, repo, hint.hopDepth ?? 3)} (or ${mcpTrace("<from>", hint.callChainHint, repo)} when you know both endpoints)`;
  }
  if (hint.overrideHint) {
    return `PLAYBOOK: ${schema} → ${cypherMethodOverrides(hint.overrideHint, repo)}`;
  }
  if (hint.processHint) {
    return `PLAYBOOK: ${schema} → ${cypherProcessSteps(hint.processHint, repo)}`;
  }
  if (hint.structural) {
    return `PLAYBOOK: ${schema} → gitnexus_cypher({ statement: "<MATCH …>", repo: "${repo}" })`;
  }
  return "";
}

/** One-line agent reminder for mid-session nudges. */
export function cypherMidSessionNudge() {
  return "Structural precision: trace for known A→B paths; pdg_query for control/data flow; cypher for ACCESSES/overrides/process steps — not grep.";
}

/**
 * Large Read likely for data-flow / model tracing (not generic module understanding).
 * @param {object} hint from prompt-router
 * @param {string} relPath
 */
export function isDataFlowReadContext(hint, relPath) {
  if (hint?.dataFlow || hint?.structural || hint?.fieldHint) return true;
  const norm = (relPath ?? "").replace(/\\/g, "/");
  if (
    /(?:^|\/)(models?|entities|dto|schemas?|domain|types)(?:\/|$)/i.test(norm)
  )
    return true;
  if (
    /(?:Model|Entity|Dto|Schema|Record|Payload)\.(js|mjs|ts|tsx)$/i.test(norm)
  )
    return true;
  return false;
}
