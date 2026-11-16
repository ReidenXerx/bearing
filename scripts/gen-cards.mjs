#!/usr/bin/env node
/**
 * Render the README's cards: docs/cards/<name>.html → docs/assets/cards/<name>.png.
 *
 *   node scripts/gen-cards.mjs            # every card
 *   node scripts/gen-cards.mjs hero       # one, by name
 *
 * Uses the publish skill's own renderer (bundle/skills/bearing-publish-visuals/render.mjs): each card
 * is laid out at the width it is SHOWN in a README (1200 CSS px), rendered at 2× for retina, sized to
 * its own height, and refused if it never says it is ready or an image is broken. Exits 1 if ANY card
 * fails — a generator that prints an error and exits 0 is how a missing card ships (NS-20).
 * Then LOOK at every PNG before committing it (the skill's §1.6).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "docs/cards");
const OUT = path.join(ROOT, "docs/assets/cards");
const RENDER = path.join(ROOT, "bundle/skills/bearing-publish-visuals/render.mjs");

const only = process.argv[2];
const cards = fs.readdirSync(SRC).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).filter((n) => !only || n === only).sort();
if (!cards.length) {
  console.error(`✗ no card${only ? ` named "${only}"` : "s"} in docs/cards`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const name of cards) {
  const r = spawnSync(process.execPath, [RENDER, path.join(SRC, `${name}.html`), path.join(OUT, `${name}.png`), "1200", "auto", "--scale", "2"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE || ROOT },
  });
  if (r.status === 0) console.log(`  ${name}: ${r.stdout.trim().split(" — ")[1]?.split(".")[0] ?? "ok"}`);
  else {
    failed++;
    console.error(`✗ ${name}:\n${(r.stderr || r.stdout).trim()}`);
  }
}
if (failed) process.exit(1);
console.log(`✓ ${cards.length} card(s) → docs/assets/cards/. Now open every one and look.`);
