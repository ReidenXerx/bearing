#!/usr/bin/env node
/**
 * Lightweight GitNexus persistence / database diagnostics for health + doctor.
 * These checks are intentionally conservative: they surface suspicious local state
 * and classify backend probe output, but do not mutate or repair the graph.
 */
import fs from 'node:fs';
import path from 'node:path';

const DB_ERROR_RE = /\b(database|db|sqlite|ladybug|persistence|persist|lock|locked|corrupt|corruption|readonly|read-only|permission denied|EACCES|ENOSPC|no space|disk|IO error|I\/O error)\b/i;
const PDG_STAT_KEYS = ['pdgNodes', 'pdgEdges', 'basicBlocks', 'cfgEdges', 'cdgEdges', 'reachingDefEdges', 'taintFindings'];

/** @param {string} text */
export function classifyPersistenceOutput(text = '') {
  const out = String(text || '').trim();
  if (!out) return null;
  if (!DB_ERROR_RE.test(out)) return null;
  return {
    ok: false,
    label: 'Persistence / database probe',
    detail: out.split('\n').slice(0, 3).join(' ').slice(0, 240),
  };
}

/** @param {string} root */
export function inspectPersistence(root) {
  const gitnexusDir = path.join(root, '.gitnexus');
  const metaPath = path.join(gitnexusDir, 'meta.json');
  const checks = [];
  let meta = null;

  checks.push({
    id: 'persistence_dir',
    ok: fs.existsSync(gitnexusDir),
    label: 'GitNexus state dir',
    detail: fs.existsSync(gitnexusDir) ? '.gitnexus present' : '.gitnexus missing — run gitnexus refresh',
  });

  if (!fs.existsSync(metaPath)) {
    checks.push({
      id: 'persistence_meta',
      ok: false,
      label: 'Graph metadata',
      detail: 'meta.json missing — index not built or persistence incomplete',
    });
  } else {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      checks.push({
        id: 'persistence_meta',
        ok: true,
        label: 'Graph metadata',
        detail: `meta.json readable${meta.indexedAt ? ` @ ${meta.indexedAt}` : ''}`,
      });
    } catch (err) {
      checks.push({
        id: 'persistence_meta',
        ok: false,
        label: 'Graph metadata',
        detail: `meta.json invalid JSON — ${err.message}`,
      });
    }
  }

  if (meta?.stats) {
    const s = meta.stats;
    const pdgKeys = PDG_STAT_KEYS.filter((k) => Number(s[k] ?? 0) > 0);
    checks.push({
      id: 'pdg_layer_hint',
      ok: true,
      label: 'PDG layer hint',
      detail: pdgKeys.length
        ? `PDG/taint stats present: ${pdgKeys.map((k) => `${k}=${s[k]}`).join(', ')}`
        : 'No PDG stats advertised in meta.json; pre-commit gitnexus:pdg will build/refresh when supported',
    });
  }

  return {
    healthy: checks.filter((c) => c.id !== 'pdg_layer_hint').every((c) => c.ok),
    checks,
    meta,
  };
}
