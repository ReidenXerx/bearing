#!/usr/bin/env node
/**
 * Generate the README diagrams as SVG.
 *
 * Why SVG and not mermaid: npm does not execute mermaid, so those blocks rendered as raw source on
 * npmjs.com. Why generated and not hand-drawn: five hand-written SVGs drift in style the moment one
 * is edited; a spec keeps the visual language in one place.
 *
 * No emoji in the SVG text: emoji rendering depends on the viewer's font stack, so they can arrive
 * as tofu boxes. Dingbats (U+2713/2717/25B6/2605) exist in every text font.
 *
 * Colours are chosen to read on BOTH light and dark backgrounds — saturated fills with white text,
 * mid-grey connectors — because GitHub has a dark theme and npm does not, and <picture> media
 * queries are not honoured on npm.
 *
 *   node scripts/gen-diagrams.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";

const C = {
  step: "#334155", accent: "#1d4ed8", role: "#6d28d9",
  warn: "#b45309", danger: "#991b1b", good: "#15803d", mute: "#64748b",
};
const LINE = "#94a3b8", LABEL = "#64748b";
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** rounded node with wrapped white text */
function node(x, y, w, h, lines, fill) {
  const fs = 13, lh = 17;
  const startY = y + h / 2 - ((lines.length - 1) * lh) / 2 + 4;
  const text = lines
    .map((l, i) => `<text x="${x + w / 2}" y="${startY + i * lh}" font-family="${F}" font-size="${fs}" font-weight="${i === 0 ? 600 : 400}" fill="#fff" text-anchor="middle">${esc(l)}</text>`)
    .join("");
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}"/>${text}`;
}
function arrow(x1, y1, x2, y2, label) {
  const mx = (x1 + x2) / 2;
  const lbl = label
    ? `<text x="${mx}" y="${(y1 + y2) / 2 - 7}" font-family="${F}" font-size="11" fill="${LABEL}" text-anchor="middle">${esc(label)}</text>`
    : "";
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${LINE}" stroke-width="2" fill="none" marker-end="url(#a)"/>${lbl}`;
}
function elbow(x1, y1, x2, y2, label) {
  const mx = x1 + (x2 - x1) / 2;
  const lbl = label
    ? `<text x="${mx}" y="${y2 - 8}" font-family="${F}" font-size="11" fill="${LABEL}" text-anchor="middle">${esc(label)}</text>`
    : "";
  return `<path d="M${x1} ${y1} H${mx} V${y2} H${x2}" stroke="${LINE}" stroke-width="2" fill="none" marker-end="url(#a)"/>${lbl}`;
}
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${LINE}"/></marker></defs>
${body}
</svg>\n`;

const out = {};

// 1 — drift: one input, two outcomes
out["drift"] = svg(880, 250, [
  node(10, 95, 150, 60, ["Agent reads", "a stale doc"], C.step),
  elbow(160, 125, 210, 50, "without"),
  elbow(160, 125, 210, 200, "with"),
  node(210, 20, 170, 60, ["adopts a", "dead premise"], C.mute),
  arrow(380, 50, 420, 50),
  node(420, 20, 190, 60, ["every conclusion", "after it inherits it"], C.mute),
  arrow(610, 50, 650, 50),
  node(650, 20, 220, 60, ["✕  found out", "three days later"], C.danger),
  node(210, 170, 170, 60, ["it contradicts", "NS-4"], C.accent),
  arrow(380, 200, 420, 200),
  node(420, 170, 190, 60, ["north-star wins,", "doc flagged stale"], C.accent),
  arrow(610, 200, 650, 200),
  node(650, 170, 220, 60, ["✓  caught in", "one line"], C.good),
].join("\n"));

// 2 — north-stars: fan-in to an authority
out["northstars"] = svg(880, 250, [
  node(10, 15, 150, 42, ["docs/"], C.mute),
  node(10, 65, 150, 42, ["README"], C.mute),
  node(10, 115, 150, 42, ["code comments"], C.mute),
  node(10, 165, 150, 42, ["the agent's guess"], C.mute),
  ...[36, 86, 136, 186].map((y) => elbow(160, y, 230, 111)),
  node(230, 86, 150, 50, ["conflict?"], C.step),
  arrow(380, 111, 430, 111),
  node(430, 76, 210, 70, ["★  NORTH-STAR WINS", "the other source", "is declared STALE"], C.accent),
  arrow(640, 111, 690, 111),
  node(690, 81, 180, 60, ["agent cites NS-4,", "names the stale doc"], C.good),
].join("\n"));

// 3 — task-core: a timeline through compaction
out["taskcore"] = svg(920, 190, [
  node(10, 60, 130, 60, ["session", "starts"], C.step),
  arrow(140, 90, 180, 90),
  node(180, 60, 140, 60, ["work…", "context fills"], C.step),
  arrow(320, 90, 360, 90),
  node(360, 55, 170, 70, ["▲  ~90% full", "writes task-core", "BEFORE the summary"], C.warn),
  arrow(530, 90, 570, 90),
  node(570, 60, 150, 60, ["✕  COMPACTION", "transcript gone"], C.danger),
  arrow(720, 90, 760, 90),
  node(760, 55, 150, 70, ["✓  reads it back", "goal + decisions", "+ next step intact"], C.good),
].join("\n"));

// 4 — microscope: role, then two lens kinds, then verify
out["microscope"] = svg(900, 300, [
  node(10, 110, 190, 80, ["▶  ADOPT THE ROLE", "trading → quant trader", "payments → ledger eng."], C.role),
  arrow(200, 150, 245, 150),
  node(245, 120, 140, 60, ["map the target", "flows · seams"], C.step),
  elbow(385, 150, 440, 55),
  elbow(385, 150, 440, 245),
  node(440, 20, 220, 70, ["KIND A — is it RIGHT?", "logic · edges · races", "contracts · taint"], C.step),
  node(440, 210, 220, 70, ["KIND B — the RIGHT THING?", "necessity · soundness", "proportionality"], C.accent),
  elbow(660, 55, 700, 150),
  elbow(660, 245, 700, 150),
  node(700, 120, 190, 60, ["verify against", "REAL logic"], C.step),
  arrow(795, 120, 795, 95),
  node(700, 35, 190, 55, ["✓  survives → finding", "✕  refuted → dropped"], C.good),
].join("\n"));

// 5 — gitnexus: two gates
out["gitnexus"] = svg(900, 230, [
  node(10, 85, 170, 60, ["grep", "'handleOrder'"], C.step),
  arrow(180, 115, 225, 115),
  node(225, 15, 200, 55, ["index STALE?", "→ refresh first"], C.warn),
  node(225, 85, 200, 55, ["tree DRIFTED?", "→ re-index first"], C.warn),
  node(225, 155, 200, 55, ["fresh → pass"], C.step),
  ...[42, 112, 182].map((y) => elbow(425, y, 480, 112)),
  node(480, 85, 160, 55, ["graph query"], C.accent),
  arrow(640, 112, 685, 112),
  node(685, 77, 205, 70, ["✓  callers, callees,", "execution flows", "— not 40 text matches"], C.good),
].join("\n"));

mkdirSync(new URL("../docs/assets/", import.meta.url), { recursive: true });
for (const [name, body] of Object.entries(out)) {
  writeFileSync(new URL(`../docs/assets/${name}.svg`, import.meta.url), body);
  console.log(`  docs/assets/${name}.svg  ${body.length} bytes`);
}
