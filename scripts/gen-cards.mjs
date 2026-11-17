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
 *
 * The infographics (docs/infographics/<name>.html) are fixed 1600×900 cards, each drawn from a real run
 * whose data sits beside it in docs/infographics/data/. They render to the same docs/assets/cards/, so a
 * name may exist in only one of the two folders.
 *
 * One card is not a README card: `social` is the site's Open Graph image. Link previews want exactly
 * 1200×630 and a small JPEG, so it renders at that size, 1×, to docs/assets/social.jpg.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "docs/cards");
const INFO = path.join(ROOT, "docs/infographics");
const OUT = path.join(ROOT, "docs/assets/cards");
const RENDER = path.join(ROOT, "bundle/skills/bearing-publish-visuals/render.mjs");

const only = process.argv[2];
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)) : []);
const clash = list(SRC).filter((n) => list(INFO).includes(n));
if (clash.length) {
  console.error(`✗ in both docs/cards and docs/infographics, rendering to the same PNG: ${clash.join(", ")}`);
  process.exit(1);
}
const dirOf = Object.fromEntries([...list(SRC).map((n) => [n, SRC]), ...list(INFO).map((n) => [n, INFO])]);
const cards = Object.keys(dirOf).filter((n) => !only || n === only).sort();
if (!cards.length) {
  console.error(`✗ no card${only ? ` named "${only}"` : "s"} in docs/cards or docs/infographics`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const SPECIAL = { social: [path.join(ROOT, "docs/assets/social.jpg"), "1200", "630", "88"] };
let failed = 0;
for (const name of cards) {
  const args = SPECIAL[name] ?? (dirOf[name] === INFO ? [path.join(OUT, `${name}.png`), "1600", "900"] : [path.join(OUT, `${name}.png`), "1200", "auto", "--scale", "2"]);
  const r = spawnSync(process.execPath, [RENDER, path.join(dirOf[name], `${name}.html`), ...args], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE || ROOT },
  });
  if (r.status === 0) console.log(`  ${name}: ${r.stdout.trim().split(" — ")[1]?.split(".")[0] ?? "ok"}`);
  else {
    failed++;
    console.error(`✗ ${name}:\n${(r.stderr || r.stdout).trim()}`);
  }
}
if (failed) process.exit(1);
console.log(`✓ ${cards.length} card(s) → docs/assets/cards/ (social → docs/assets/social.jpg). Now open every one and look.`);
