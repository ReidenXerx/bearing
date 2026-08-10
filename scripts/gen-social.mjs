#!/usr/bin/env node
/**
 * Social cards — a square 1200×1200 for the feed, not a docs diagram.
 *
 * The docs diagrams are 900 wide and ~340 tall with 12–15px type: correct inside a README, illegible
 * as a feed thumbnail. A feed image is read at roughly 200px on a phone before anyone decides to
 * stop, so this carries ONE idea in type big enough to survive that, and nothing else.
 *
 * Dark on purpose: LinkedIn's feed is white, so a dark card is the thing that stops the scroll.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { C, FONT, MONO, esc } from "./diagram-kit.mjs";

const W = 1200;
const H = 1200;

const text = (x, y, t, { size = 32, fill = C.ink, weight = 400, anchor = "start", font = FONT, ls = 0 } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="${fill}">${esc(t)}</text>`;

/** A slab with a thick left edge — the same accent-edge language as the docs diagrams, scaled up. */
const slab = (x, y, w, h, accent) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${C.panel}" stroke="${C.panelEdge}" stroke-width="2"/>` +
  `<path d="M${x + 2} ${y + 22} a20 20 0 0 1 20 -20 h4 v${h - 4} h-4 a20 20 0 0 1 -20 -20 z" fill="${accent}"/>`;

const body = [
  `<rect width="${W}" height="${H}" fill="${C.surface}"/>`,
  `<rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="28" fill="none" stroke="${C.edge}" stroke-width="2"/>`,

  text(100, 150, "A HEALTHCARE CLAIMS PLATFORM", { size: 26, fill: C.faint, weight: 700, ls: 3 }),
  text(100, 214, "Who is reviewing your code?", { size: 58, fill: C.ink, weight: 700 }),

  // The wrong answer first, and in the failure colour — the reader should feel the mismatch before
  // reading the fix.
  text(100, 316, "WAS REVIEWED BY", { size: 24, fill: C.bad, weight: 700, ls: 3 }),
  slab(100, 340, 1000, 160, C.bad),
  text(148, 412, "a developer-tooling engineer", { size: 52, fill: C.ink, weight: 700 }),
  text(148, 460, "inference read the tool's own boilerplate as evidence", { size: 26, fill: C.dim }),

  `<path d="M600 530 V596" stroke="${C.rule}" stroke-width="4" marker-end="url(#a)"/>`,

  text(100, 686, "NOW REVIEWED BY", { size: 24, fill: C.accent, weight: 700, ls: 3 }),
  slab(100, 710, 1000, 172, C.accent),
  text(148, 782, "a clinical systems engineer", { size: 52, fill: C.ink, weight: 700 }),
  // One line, at a size that fits it. Wrapping this left "expertise" orphaned on its own line —
  // fine in a paragraph, but a feed card is read as a shape before it is read as words.
  text(148, 836, "with HIPAA and patient-safety expertise", { size: 36, fill: C.good, weight: 600 }),

  // The line that makes it about the reader rather than about one bug.
  text(100, 1010, "The agent was confident. It was wrong.", { size: 40, fill: C.ink, weight: 600 }),
  text(100, 1060, "Nothing would have told you.", { size: 40, fill: C.dim, weight: 600 }),

  text(100, 1140, "bearing", { size: 40, fill: C.accent, weight: 800 }),
  text(1100, 1140, "npx bearing", { size: 30, fill: C.faint, anchor: "end", font: MONO }),
].join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="A healthcare claims platform was reviewed by a developer-tooling engineer because inference read the tool's own boilerplate as evidence; it is now reviewed by a clinical systems engineer with HIPAA and patient-safety expertise. The agent was confident, it was wrong, and nothing would have told you.">
<defs><marker id="a" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L10 6 L1 11 z" fill="${C.rule}"/></marker></defs>
${body}
</svg>`;

// Same clipping guard as the docs diagrams: SVG neither wraps nor complains, and a card that runs
// off the edge looks correct in source.
const bad = [];
for (const m of svg.matchAll(/<text x="([\d.]+)"([^>]*)>([^<]*)</g)) {
  const size = Number((m[2].match(/font-size="([\d.]+)"/) || [, 32])[1]);
  const width = m[3].length * size * 0.55;
  const end = /text-anchor="end"/.test(m[2]) ? Number(m[1]) : Number(m[1]) + width;
  if (end > W - 40) bad.push(`${JSON.stringify(m[3].slice(0, 40))} ends ~${Math.round(end)}`);
}
if (bad.length) {
  console.error(`✗ text overflows:\n   ${bad.join("\n   ")}`);
  process.exitCode = 1;
}

mkdirSync("docs/social", { recursive: true });
writeFileSync("docs/social/persona.svg", svg);
console.log("  wrote docs/social/persona.svg");
