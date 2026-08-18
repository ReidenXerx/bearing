#!/usr/bin/env node
/**
 * Render the HTML social cards to PNG with Playwright (chromium, headless).
 *
 * The SVG generators (gen-social.mjs, gen-diagrams.mjs) are precise but every position is
 * hand-computed. The HTML cards (docs/social/*.html) lay out with CSS + Tailwind, so anyone
 * can edit them in a browser and regenerate. This script is the regenerate step: it loads
 * each card, waits for the Tailwind CDN to compile, and screenshots the `.card` element at
 * 2x device-pixel-ratio for a crisp result.
 *
 *   node scripts/gen-social-html.mjs            # render every docs/social/*.html
 *   node scripts/gen-social-html.mjs receipts   # render one by name
 *
 * Output: docs/social/<name>.png next to the .html. The .svg variants from the old generator
 * are left untouched; the PNGs here are the ones the README embeds.
 */
import { chromium } from "playwright";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const socialDir = join(here, "..", "docs", "social");

const filter = process.argv[2]; // optional: a card name without extension

const htmlFiles = readdirSync(socialDir)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !filter || f.startsWith(filter));

if (!htmlFiles.length) {
  console.error(`✗ no HTML cards found${filter ? ` matching "${filter}"` : ""} in docs/social`);
  process.exit(1);
}

const browser = await chromium.launch();

for (const file of htmlFiles) {
  const name = file.replace(/\.html$/, "");
  const url = `file://${join(socialDir, file)}`;
  const out = join(socialDir, `${name}.png`);

  const page = await browser.newPage({
    viewport: { width: 1500, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(url, { waitUntil: "networkidle" });

  // Tailwind's CDN compiles utilities after load; give it a beat, then assert the card exists.
  await page.waitForTimeout(800);
  if (!(await page.locator(".card").count())) {
    console.error(`✗ ${file}: no element with class="card" found`);
    await page.close();
    continue;
  }

  await page.locator(".card").screenshot({ path: out });
  console.log(`  wrote ${out.replace(here + "/..", ".")}`);
  await page.close();
}

await browser.close();