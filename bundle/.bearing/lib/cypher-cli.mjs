#!/usr/bin/env node
/**
 * Run Cypher against the GitNexus graph via the CLI (no MCP needed).
 * Used by offline kit features: arch-doc generation, commit-message drafting, CI impact gate.
 * Output parsing is intentionally lenient — the CLI table format may vary across versions.
 */
import { spawnSync } from 'node:child_process';

/**
 * @param {string} root repo root (cwd)
 * @param {string} repo indexed repo name
 * @param {string} query single-line Cypher
 * @param {Record<string,string>} [env]
 * @returns {{ ok: boolean, stdout: string, stderr: string }}
 */
export function runCypher(root, repo, query, env) {
  const r = spawnSync('npx', ['-y', 'gitnexus@latest', 'cypher', '-r', repo, query], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ?? process.env,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Extract the first integer from cypher output (count queries). */
export function parseCount(out) {
  const m = (out ?? '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Lenient row parse. Tries JSON first; otherwise reads a markdown/ascii table,
 * dropping header + separator rows. Returns an array of cell arrays.
 * @param {string} out
 * @returns {string[][]}
 */
export function parseRows(out) {
  const text = (out ?? '').trim();
  if (!text) return [];

  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) {
      return j.map((row) =>
        typeof row === 'object' && row ? Object.values(row).map((v) => String(v)) : [String(row)]
      );
    }
  } catch {
    /* not JSON — parse as table */
  }

  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || !t.includes('|')) continue;
    if (/^[\s|:+-]+$/.test(t)) continue; // separator row
    const cells = t
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length) rows.push(cells);
  }
  // Drop a header row that looks like column names (no spaces, all lowercase identifiers).
  if (rows.length > 1 && rows[0].every((c) => /^[a-zA-Z_][\w.]*$/.test(c))) {
    return rows.slice(1);
  }
  return rows;
}

/** First-column values from a row list. */
export function firstColumn(rows) {
  return rows.map((r) => r[0]).filter(Boolean);
}
