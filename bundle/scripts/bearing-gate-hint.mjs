#!/usr/bin/env node
/**
 * Print GitNexus npm script gate documentation (package.json comment entries).
 * Usage: node scripts/bearing-gate-hint.mjs 1-session
 */
import { GITNEXUS_SCRIPT_GATES, findGate } from './bearing-teaching/script-gates.mjs';

const id = process.argv[2];

if (!id || id === '--all') {
  console.log('GitNexus npm script gates (match enforcement rule workflow)\n');
  for (const g of GITNEXUS_SCRIPT_GATES) {
    console.log(`  ${g.title}`);
    console.log(`    ${g.description}`);
    console.log(`    scripts: ${Object.keys(g.scripts).join(', ')}\n`);
  }
  process.exit(0);
}

const g = findGate(id);
if (!g) {
  console.error(`Unknown gate: ${id}. Use: ${GITNEXUS_SCRIPT_GATES.map((x) => `${x.gate}-${x.name}`).join(', ')}`);
  process.exit(1);
}

console.log(`${g.title}\n${g.description}\n`);
console.log('Commands in this gate:');
for (const [k, v] of Object.entries(g.scripts)) {
  console.log(`  npm run ${k}`);
  console.log(`    → ${v.length > 72 ? v.slice(0, 69) + '…' : v}`);
}
