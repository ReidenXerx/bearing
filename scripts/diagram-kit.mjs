/**
 * Drawing primitives for the README diagrams.
 *
 * ONE IDEA PER DIAGRAM, large type, one accent per diagram. The palette is the validated
 * colorblind-safe trio (blue/orange/green) on a dark surface; colour carries STATUS, text
 * wears text tokens, so meaning never rests on hue alone.
 *
 * Sharpness rule (the bug this version fixes): SVG `filter` regions rasterize EVERYTHING in
 * the region, including text, and blur it. So filters are NEVER applied to a group containing
 * text, and glow is drawn as a clean concentric halo (a larger faint circle behind) instead of
 * a feGaussianBlur on the shape — halos stay crisp-edged. The only filter in use is a soft
 * drop shadow on the *background rect only*, never on text-bearing containers.
 */

/** Validated on the dark surface. */
export const C = {
  surface: "#11161f",
  surface2: "#161c27",
  edge: "#232c3b",
  panel: "#1a2130",
  panelEdge: "#2c3648",
  ink: "#e8edf5",
  dim: "#9aa8bd",
  faint: "#61708a",
  accent: "#3987e5",
  bad: "#d95926",
  good: "#199e70",
  rule: "#3a465c",
};

export const FONT =
  "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif";
export const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export const esc = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Uppercase tracked eyebrow. */
export function eyebrow(x, y, text, fill = C.faint) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11.5" font-weight="600" letter-spacing="1.6" fill="${fill}">${esc(text.toUpperCase())}</text>`;
}

/** The one-line claim the diagram exists to make. Largest thing on the canvas. */
export function headline(x, y, text, fill = C.ink) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="21" font-weight="700" fill="${fill}">${esc(text)}</text>`;
}

export function caption(x, y, text, fill = C.faint, anchor = "start") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="13" fill="${fill}">${esc(text)}</text>`;
}

/**
 * A card: a panel rect (gradient fill, soft drop shadow via a SEPARATE shadow rect drawn
 * behind, so no filter touches text) + optional 3px accent left edge + title/sub text.
 * Text is drawn as siblings of the rect, NOT inside a filtered group.
 */
export function card(x, y, w, h, { title, sub, accent, titleFill, mono } = {}) {
  const parts = [
    // shadow: a blurred-free soft rect behind, offset down
    `<rect x="${x}" y="${y + 5}" width="${w}" height="${h}" rx="10" fill="#000" opacity="0.35"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#panelGrad)" stroke="${C.panelEdge}"/>`,
  ];
  if (accent) {
    parts.push(`<path d="M${x + 1} ${y + 11} a10 10 0 0 1 10 -10 h2 v${h - 2} h-2 a10 10 0 0 1 -10 -10 z" fill="${accent}"/>`);
  }
  const tx = x + (accent ? 20 : 16);
  const ty = sub ? y + h / 2 - 4 : y + h / 2 + 5;
  parts.push(`<text x="${tx}" y="${ty}" font-family="${mono ? MONO : FONT}" font-size="${mono ? 13 : 15}" font-weight="600" fill="${titleFill ?? C.ink}">${esc(title)}</text>`);
  if (sub) parts.push(`<text x="${tx}" y="${y + h / 2 + 15}" font-family="${FONT}" font-size="12.5" fill="${C.dim}">${esc(sub)}</text>`);
  return parts.join("\n");
}

/**
 * A pill: crisp rect + centered text, with a separate soft shadow rect behind. No filter on
 * the group — the text stays sharp.
 */
export function pill(x, y, text, fill, textFill = "#ffffff") {
  const w = 16 + String(text).length * 7.4;
  return [
    `<rect x="${x}" y="${y + 3}" width="${w}" height="26" rx="13" fill="#000" opacity="0.3"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${fill}"/>`,
    `<text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="600" fill="${textFill}">${esc(text)}</text>`,
  ].join("\n");
}

/** A filled dot. `glow` draws a clean larger faint halo behind it (no blur filter = crisp). */
export function dot(cx, cy, r, fill, { opacity = 1, halo } = {}) {
  const parts = [];
  if (halo) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 2.2}" fill="${halo}" opacity="0.22"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`);
  return parts.join("");
}

/** A thin connector line WITHOUT an arrowhead. */
export function link(x1, y1, x2, y2, stroke = C.rule, { width = 1.25, opacity = 0.7, dash } = {}) {
  const da = dash ? ` stroke-dasharray="${dash}"` : "";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"${da}/>`;
}

/** Ghosted, low-opacity text — for the "erased transcript". Min opacity 0.3 so it reads faint, not broken. */
export function ghostText(x, y, t, { size = 13, anchor = "start", opacity = 0.3 } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${MONO}" font-size="${size}" fill="${C.dim}" opacity="${opacity}">${esc(t)}</text>`;
}

/** A vertical "gate wall" — a tall thin rounded rect that reads as a barrier, with a clean halo. */
export function gate(x, y, h, fill, label) {
  return [
    `<rect x="${x - 2}" y="${y}" width="12" height="${h}" rx="6" fill="${fill}" opacity="0.22"/>`,
    `<rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${fill}"/>`,
    label ? `<text x="${x + 18}" y="${y + h / 2 + 4}" font-family="${FONT}" font-size="13" font-weight="700" letter-spacing="1.5" fill="${fill}">${esc(label)}</text>` : "",
  ].join("\n");
}

/** A mono code line with per-token colour. */
export function codeLine(x, y, parts, { size = 19 } = {}) {
  const tspans = parts.map((p) => `<tspan fill="${p.fill}">${esc(p.t)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="500">${tspans}</text>`;
}

/** A crisp arrow for the one diagram that earns it (gitnexus). */
export function arrow(x1, y1, x2, y2, stroke = C.rule) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.75" marker-end="url(#ar)"/>`;
}

export function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<defs>
  <marker id="ar" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="${C.rule}"/>
  </marker>
  <radialGradient id="surfaceGrad" cx="100%" cy="0%" r="120%">
    <stop offset="0%" stop-color="${C.surface2}"/>
    <stop offset="55%" stop-color="${C.surface}"/>
  </radialGradient>
  <linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#1d2533"/>
    <stop offset="100%" stop-color="${C.panel}"/>
  </linearGradient>
</defs>
<rect width="${w}" height="${h}" rx="14" fill="url(#surfaceGrad)" stroke="${C.edge}"/>
${body}
</svg>
`;
}