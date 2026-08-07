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
/** Small node for fan-out items, where a full-size box would not fit the count. */
function chip(x, y, w, h, lines, fill) {
  const startY = y + h / 2 - ((lines.length - 1) * 15) / 2 + 4;
  const text = lines
    .map((l, i) => `<text x="${x + w / 2}" y="${startY + i * 15}" font-family="${F}" font-size="${i === 0 ? 11.5 : 11}" font-weight="${i === 0 ? 600 : 400}" fill="#fff" text-anchor="middle">${esc(l)}</text>`)
    .join("");
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}"/>${text}`;
}
/** Standalone caption, for naming a band of the diagram rather than a box. */
function label(x, y, t) {
  return `<text x="${x}" y="${y}" font-family="${F}" font-size="11.5" fill="${LABEL}" text-anchor="middle" font-style="italic">${esc(t)}</text>`;
}
/** Feedback arrow that leaves a box, loops out to the left, and returns above it. */
function loop(x, y, dx, up, t) {
  const lx = x - dx;
  return (
    `<path d="M${x} ${y} H${lx} V${y - up} H${x}" stroke="${LINE}" stroke-width="2" stroke-dasharray="5 4" fill="none" marker-end="url(#a)"/>` +
    `<text x="${lx + 8}" y="${y - up - 8}" font-family="${F}" font-size="11.5" fill="${LABEL}" font-style="italic">${esc(t)}</text>`
  );
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

// 4 — microscope: the whole routine. The old version showed two lens boxes and implied a fixed
// checklist, which undersells the thing that makes it different — lenses are spawned PER SLICE,
// every finding must survive an attempt to refute it, and it iterates in numbered waves.
// Left gutter (x < 44) is reserved for the wave-loop return path — keep boxes out of it.
out["microscope"] = svg(1000, 500, [
  // Row 1 — scope gate, the pinned persona, and a map that works with or without the graph.
  node(44, 26, 158, 68, ["SCOPE GATE", "one-file fix?", "→ skip, don't fan out"], C.mute),
  arrow(202, 60, 238, 60),
  node(238, 20, 226, 80, ["PERSONA — pinned", ".bearing/domain.json", "payments → ledger engineer"], C.role),
  arrow(464, 60, 500, 60),
  node(500, 20, 256, 80, ["MAP THE TARGET", "graph: clusters · flows · impact", "no graph: dirs · imports · entry pts"], C.step),
  label(628, 118, "one lens per meaningful slice — not a fixed checklist"),

  // Row 2 — the fan-out. Five chips stand in for "as many as the target has slices".
  ...[[44, "A", "auth flow", "logic · edges"], [230, "B", "auth flow", "necessity"],
      [416, "A", "ledger write", "races · taint"], [602, "B", "ledger write", "proportionality"],
      [788, "A", "api surface", "contracts"]]
    .map(([x, kind, slice, sub]) =>
      chip(x, 142, 160, 58, [`KIND ${kind} — ${slice}`, sub], kind === "A" ? C.step : C.accent)),
  ...[124, 310, 496, 682, 868].map((x) => elbow(628, 100, x, 142)),
  // One caption, centred: the chips already carry their own KIND, so two band labels were both
  // redundant and — at this width — overlapping the wave-loop text.
  label(500, 226, "KIND A — is it RIGHT?    ·    KIND B — is it the RIGHT THING?"),

  // Row 3 — the part a linter cannot do: try to kill your own finding.
  ...[124, 310, 496, 682, 868].map((x) => elbow(x, 200, 500, 250)),
  node(256, 250, 488, 62, ["ADVERSARIAL VERIFY — try to REFUTE every finding", "trace the value, read the branch — not plausibility"], C.warn),

  // Row 4 — survivors only.
  elbow(380, 312, 268, 362),
  elbow(620, 312, 732, 362),
  node(114, 362, 308, 58, ["✓  survives → reported", "with file:line + the WHY"], C.good),
  node(578, 362, 308, 58, ["✕  refuted → dropped", "never reaches you"], C.danger),

  // The wave: survivors feed the next numbered pass, which re-maps the target. Routed down and
  // around the left gutter so it crosses nothing.
  `<path d="M268 420 V462 H20 V60 H44" stroke="${LINE}" stroke-width="2" stroke-dasharray="5 4" fill="none" marker-end="url(#a)"/>`,
  `<text x="290" y="466" font-family="${F}" font-size="11.5" fill="${LABEL}" font-style="italic">WAVE N+1 — fix criticals, fold in the rest, re-run until clean</text>`,
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
