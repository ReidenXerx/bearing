/**
 * Drawing primitives for the README diagrams.
 *
 * ONE IDEA PER DIAGRAM, large type, one accent per diagram. The palette is the validated
 * colorblind-safe trio (blue/orange/green) on a dark surface; colour carries STATUS, text
 * wears text tokens, so meaning never rests on hue alone.
 *
 * Visual treatment v2 — "sexier" without changing what each diagram *says*:
 *  - the surface is a subtle radial gradient, not a flat fill, so a card reads as an object
 *    lit from above rather than a pasted rectangle;
 *  - cards get a soft drop shadow (feGaussianBlur'd offset rect) so the layout gains depth
 *    hierarchy without competing with the one accent that carries meaning;
 *  - accent-coloured cards pick up a faint accent glow so the "this is the load-bearing box"
 *    one is the first thing the eye lands on;
 *  - headline type is larger and heavier — the one-line claim the diagram exists to make.
 *
 * The shared primitives keep every diagram's type scale and palette identical, so editing
 * one SVG can't quietly drift the style of the other five.
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
  accent: "#3987e5", // the product doing its job
  bad: "#d95926", // the failure being described
  good: "#199e70", // the outcome that survives
  rule: "#3a465c",
};

export const FONT =
  "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif";
export const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export const esc = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let filterSeq = 0;
/** A uniquely-id'd soft drop shadow, so multiple diagrams in one README don't clash IDs. */
function shadowDef(name = "sh") {
  const id = `${name}${++filterSeq}`;
  return {
    id,
    def: `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
  <feOffset dx="0" dy="6" result="off"/>
  <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
  <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`,
    ref: `filter="url(#${id})"`,
  };
}
function glowDef(color, name = "gl") {
  const id = `${name}${++filterSeq}`;
  return {
    id,
    def: `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>
  <feColorMatrix in="b" type="matrix" values="0 0 0 0 ${hexN(color,0)}  0 0 0 0 ${hexN(color,1)}  0 0 0 0 ${hexN(color,2)}  0 0 0 0.5 0"/>
  <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`,
    ref: `filter="url(#${id})"`,
  };
}
function hexN(hex, i) {
  return (parseInt(hex.slice(1 + i * 2, 3 + i * 2), 10) / 255).toFixed(3);
}

/** Uppercase tracked eyebrow — orients the reader before they parse any boxes. */
export function eyebrow(x, y, text, fill = C.faint) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11.5" font-weight="600" letter-spacing="1.6" fill="${fill}">${esc(
    text.toUpperCase(),
  )}</text>`;
}

/** The one-line claim the diagram exists to make. Larger + heavier in v2. */
export function headline(x, y, text, fill = C.ink) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="21" font-weight="700" fill="${fill}">${esc(
    text,
  )}</text>`;
}

export function caption(x, y, text, fill = C.faint, anchor = "start") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="12.5" fill="${fill}">${esc(
    text,
  )}</text>`;
}

/** A soft shadow applied once per diagram; returns the filter id so callers can reference it. */
const cardShadow = shadowDef("cardsh");

/**
 * A card. `accent` paints a 3px left edge rather than flooding the fill: a wall of saturated
 * boxes has no hierarchy, and the eye needs somewhere to land first. v2: gradient panel fill
 * + soft drop shadow for depth. Accent cards additionally glow in their accent colour.
 */
export function card(x, y, w, h, { title, sub, accent, titleFill, mono } = {}) {
  const parts = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#panelGrad)" stroke="${C.panelEdge}" ${cardShadow.ref}/>`,
  ];
  if (accent) {
    parts.push(
      `<path d="M${x + 1} ${y + 11} a10 10 0 0 1 10 -10 h2 v${h - 2} h-2 a10 10 0 0 1 -10 -10 z" fill="${accent}"/>`,
    );
  }
  const tx = x + (accent ? 20 : 16);
  const ty = sub ? y + h / 2 - 4 : y + h / 2 + 5;
  parts.push(
    `<text x="${tx}" y="${ty}" font-family="${mono ? MONO : FONT}" font-size="${mono ? 13 : 15}" font-weight="600" fill="${titleFill ?? C.ink}">${esc(title)}</text>`,
  );
  if (sub) {
    parts.push(
      `<text x="${tx}" y="${y + h / 2 + 15}" font-family="${FONT}" font-size="12.5" fill="${C.dim}">${esc(sub)}</text>`,
    );
  }
  return parts.join("\n");
}

/**
 * A card drawn as a small DECK — two offset ghosts behind it.
 * Says "there are N of these, running at once" without spending N boxes on it.
 */
export function deck(x, y, w, h, opts = {}) {
  return [
    `<rect x="${x + 10}" y="${y - 8}" width="${w}" height="${h}" rx="10" fill="url(#panelGrad)" stroke="${C.panelEdge}" opacity="0.4"/>`,
    `<rect x="${x + 5}" y="${y - 4}" width="${w}" height="${h}" rx="10" fill="url(#panelGrad)" stroke="${C.panelEdge}" opacity="0.7"/>`,
    card(x, y, w, h, opts),
  ].join("\n");
}

/** Pill for short state words — reads as a badge, not another box in the flow. */
export function pill(x, y, text, fill, textFill = "#ffffff") {
  const w = 13 + String(text).length * 7.4;
  return `<g ${cardShadow.ref}><rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${fill}"/><text x="${
    x + w / 2
  }" y="${y + 17.5}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="600" fill="${textFill}">${esc(
    text,
  )}</text></g>`;
}

/** y2 defaults to y1: most arrows here are horizontal, and a forgotten y2 rendered NaN silently. */
export function arrow(x1, y1, x2, y2 = y1, stroke = C.rule) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.75" marker-end="url(#ar)"/>`;
}

/** Orthogonal connector — diagonal lines across a layout read as scribble. */
export function elbow(x1, y1, x2, y2, stroke = C.rule) {
  const mx = x1 + (x2 - x1) / 2;
  return `<path d="M${x1} ${y1} H${mx} V${y2} H${x2}" fill="none" stroke="${stroke}" stroke-width="1.75" marker-end="url(#ar)"/>`;
}

/** Vertical-first connector: down, across, down. Use when the target is to the LEFT. */
export function elbowV(x1, y1, x2, y2, band, stroke = C.rule) {
  return `<path d="M${x1} ${y1} V${band} H${x2} V${y2}" fill="none" stroke="${stroke}" stroke-width="1.75" marker-end="url(#ar)"/>`;
}

export function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(
    title,
  )}">
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
  ${cardShadow.def}
</defs>
<rect width="${w}" height="${h}" rx="14" fill="url(#surfaceGrad)" stroke="${C.edge}"/>
${body}
</svg>
`;
}