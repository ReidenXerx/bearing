#!/usr/bin/env node
/**
 * Draft a graph-grounded commit message from staged changes — offline, via CLI cypher.
 * Lists affected execution flows + functional areas for the changed symbols.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { repoName } from './hook-helpers.mjs';
import { runCypher, firstColumn, parseRows } from './cypher-cli.mjs';

const CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|cs|cpp|c|scala)$/i;

function git(root, args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function symbolFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base || null;
}

function cypherList(names) {
  return names.map((n) => `'${String(n).replace(/'/g, "\\'")}'`).join(', ');
}

/**
 * @param {string} root
 * @param {string} [repoArg]
 * @param {Record<string,string>} [env]
 * @returns {{ message: string, grounded: boolean }}
 */
export function draftCommitMessage(root, repoArg, env) {
  const repo = repoArg ?? repoName(root);
  const staged = git(root, 'diff --cached --name-only').split('\n').filter(Boolean);
  const codeFiles = staged.filter((f) => CODE_RE.test(f));
  const symbols = [...new Set(codeFiles.map(symbolFromFile).filter(Boolean))].slice(0, 25);

  let flows = [];
  let modules = [];
  let grounded = false;

  if (symbols.length) {
    const inList = cypherList(symbols);
    const procQ = `MATCH (s)-[:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process) WHERE s.name IN [${inList}] RETURN DISTINCT p.heuristicLabel LIMIT 12`;
    const modQ = `MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community) WHERE s.name IN [${inList}] RETURN DISTINCT c.heuristicLabel LIMIT 12`;
    try {
      const pr = runCypher(root, repo, procQ, env);
      if (pr.ok) {
        flows = firstColumn(parseRows(pr.stdout)).filter((x) => x && !/^null$/i.test(x));
        grounded = true;
      }
      const mr = runCypher(root, repo, modQ, env);
      if (mr.ok) {
        modules = firstColumn(parseRows(mr.stdout)).filter((x) => x && !/^null$/i.test(x));
      }
    } catch {
      /* fall back to file-only */
    }
  }

  const lines = [];
  lines.push('<type>(<scope>): <one-line summary>   # fill in: feat | fix | refactor | docs …');
  lines.push('');
  if (flows.length) lines.push(`Affected flows: ${flows.join(', ')}`);
  if (modules.length) lines.push(`Modules: ${modules.join(', ')}`);
  if (codeFiles.length) {
    lines.push('');
    lines.push('Changed:');
    for (const f of codeFiles.slice(0, 20)) lines.push(`- ${f}`);
    if (codeFiles.length > 20) lines.push(`- … +${codeFiles.length - 20} more`);
  }
  if (!codeFiles.length) {
    lines.push('# No staged code files. Stage changes (git add) before drafting.');
  }
  if (!grounded && symbols.length) {
    lines.push('');
    lines.push('# (Graph unavailable — flows/modules omitted. Run npm run gitnexus:agent-refresh, then retry.)');
  }

  return { message: lines.join('\n'), grounded };
}
