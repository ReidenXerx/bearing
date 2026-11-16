#!/usr/bin/env node
/**
 * Render one HTML card to an image — and refuse to hand back a half-drawn one.
 *
 *   node render.mjs <card.html> <out.png|out.jpg> <width> <height> [jpegQuality]
 *
 * A card is an HTML page. The page says it is finished by setting `window.__ready = true` after its
 * fonts, data and canvases are done; this waits for exactly that and fails if it never comes. Every
 * rule below is a publish that went out wrong:
 *
 * - **Served over http, never file://.** Module scripts and `fetch()` of the card's own data refuse
 *   file://, and the failure is silent: the card renders with an empty chart.
 * - **Wait for the page's own `__ready`, never a timer.** A fixed sleep screenshots whatever had
 *   loaded by then — canvas text drawn in a fallback font, a chart before its data.
 * - **A broken image fails the render**, and so does a page error. Console errors are printed.
 * - **Exit 1 on any of it.** A render that prints an error and exits 0 is a lie the next step trusts.
 *
 * Playwright is not bundled. It is resolved from the project (its node_modules, or the e2e kit's), or
 * from PLAYWRIGHT_MODULE — nothing is installed.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const [, , cardArg, outArg, wArg, hArg, qArg] = process.argv;
if (!cardArg || !outArg || !wArg || !hArg) {
  console.error("usage: node render.mjs <card.html> <out.png|out.jpg> <width> <height> [jpegQuality]");
  process.exit(2);
}
const card = path.resolve(cardArg);
const out = path.resolve(outArg);
const width = Number(wArg);
const height = Number(hArg);
const quality = Number(qArg ?? 90);
const READY_MS = Number(process.env.RENDER_READY_MS) > 0 ? Number(process.env.RENDER_READY_MS) : 30000;
if (!fs.existsSync(card)) {
  console.error(`✗ no such card: ${card}`);
  process.exit(1);
}

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, process.cwd(), path.join(process.cwd(), ".e2e")].filter(Boolean);
  for (const from of tries) {
    try {
      // CommonJS: require it, or `chromium` hides under `default` and `.launch` is undefined.
      return createRequire(path.join(path.resolve(from), "package.json"))("playwright");
    } catch {
      /* next */
    }
  }
  console.error("✗ playwright not found in this project (or its .e2e/). Add it as a dev dependency, or point");
  console.error("  PLAYWRIGHT_MODULE at a directory that has it; then `npx playwright install chromium`.");
  process.exit(1);
}

// charset on every text type: without it a page with no <meta charset> is decoded as Windows-1252,
// and "·" renders as "Â·", "→" as "â†'" — found by LOOKING at a card every check had passed.
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".gif": "image/gif" };
const root = path.dirname(card);
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(path.basename(card))}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && console.error(`  console: ${m.text()}`));
  page.on("requestfailed", (r) => problems.push(`failed to load: ${r.url()}`));
  // A browser's own favicon probe would 404 on this bare server and is not the card's request. Playwright's
  // headless Chromium does not send one (checked); other browsers may — so it is ignored, untested.
  page.on("response", (r) => r.status() >= 400 && !/\/favicon\.ico$/.test(new URL(r.url()).pathname) && problems.push(`HTTP ${r.status()}: ${r.url()}`));
  await page.goto(url, { waitUntil: "load" });
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS });
  } catch {
    problems.push(`the card never set window.__ready = true within ${READY_MS} ms — set it once fonts, data and canvases are done`);
  }
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  for (const b of broken) problems.push(`broken image: ${b}`);
  if (problems.length) throw new Error(problems.join("\n  "));
  const jpeg = /\.jpe?g$/i.test(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // A divider that must be transparent says so; everything else gets the card's own solid background.
  const transparent = !jpeg && (await page.evaluate(() => window.__transparent === true));
  await page.screenshot({ path: out, type: jpeg ? "jpeg" : "png", ...(jpeg ? { quality } : {}), omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  console.log(`✓ ${path.relative(process.cwd(), out)} — ${width}×${height}. Now OPEN it and look: at full size, and at the width it will be shown.`);
} catch (e) {
  console.error(`✗ ${path.basename(card)} not rendered:\n  ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
