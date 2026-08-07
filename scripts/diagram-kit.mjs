/**
 * Drawing primitives for the README diagrams.
 *
 * These are CONCEPT diagrams, not charts, but the same discipline applies: the palette is the
 * validated colorblind-safe trio (blue/orange/green stepped for a dark surface — worst adjacent
 * pair ΔE 9.4 deutan, 26.5 normal), colour carries STATUS rather than identity, and text always
 * wears text tokens so meaning never rests on hue alone.
 *
 * The old set produced 24 drawing calls for one diagram at 11px type. That reads as "this product
 * is complicated" — the opposite of the job. A README diagram gets about two seconds: it has to
 * land ONE idea at a glance, and anything that does not serve that idea is noise competing with it.
 * So: few elements, large type, one accent per diagram, and generous space.
 *
 * Self-contained dark card on purpose. GitHub renders READMEs on both themes and npm on white; a
 * transparent SVG would need text that works on all three, which nothing does. A card is legible
 * everywhere and looks deliberate rather than like a broken asset.
 */

/** Validated on the dark surface — see scripts/validate_palette.js in the dataviz skill. */
export const C = {
  surface: "#11161f",
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

/** Uppercase tracked eyebrow — orients the reader before they parse any boxes. */
export function eyebrow(x, y, text, fill = C.faint) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11.5" font-weight="600" letter-spacing="1.6" fill="${fill}">${esc(
    text.toUpperCase(),
  )}</text>`;
}

/** The one-line claim the diagram exists to make. Deliberately the largest thing on the canvas. */
export function headline(x, y, text, fill = C.ink) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="19" font-weight="650" fill="${fill}">${esc(
    text,
  )}</text>`;
}

export function caption(x, y, text, fill = C.faint, anchor = "start") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="12.5" fill="${fill}">${esc(
    text,
  )}</text>`;
}

/**
 * A card. `accent` paints a 3px left edge rather than flooding the fill: a wall of saturated boxes
 * has no hierarchy, and the eye needs somewhere to land first.
 */
export function card(x, y, w, h, { title, sub, accent, titleFill, mono } = {}) {
  const parts = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.panelEdge}"/>`,
  ];
  if (accent) {
    parts.push(
      `<path d="M${x + 1} ${y + 11} a10 10 0 0 1 10 -10 h2 v${h - 2} h-2 a10 10 0 0 1 -10 -10 z" fill="${accent}"/>`,
    );
  }
  const tx = x + (accent ? 20 : 16);
  const ty = sub ? y + h / 2 - 4 : y + h / 2 + 5;
  parts.push(
    `<text x="${tx}" y="${ty}" font-family="${mono ? MONO : FONT}" font-size="${mono ? 13 : 14.5}" font-weight="600" fill="${titleFill ?? C.ink}">${esc(title)}</text>`,
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
 *
 * Says "there are N of these, running at once" without spending N boxes on it. The microscope
 * spawns one lens per meaningful slice, so a diagram showing exactly two understates it as a fixed
 * pair; drawing the multiplicity is the honest shape and costs no extra reading.
 */
export function deck(x, y, w, h, opts = {}) {
  return [
    `<rect x="${x + 10}" y="${y - 8}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.panelEdge}" opacity="0.4"/>`,
    `<rect x="${x + 5}" y="${y - 4}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.panelEdge}" opacity="0.7"/>`,
    card(x, y, w, h, opts),
  ].join("\n");
}

/** Pill for short state words — reads as a badge, not another box in the flow. */
export function pill(x, y, text, fill, textFill = "#ffffff") {
  const w = 13 + String(text).length * 7.4;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${fill}"/><text x="${
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

/**
 * Vertical-first connector: down, across, down. `elbow` goes horizontal first, which routes a
 * backward link straight THROUGH the boxes it is meant to pass beneath — visible only once
 * rasterised. Use this whenever the target is to the LEFT of the source.
 */
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
</defs>
<rect width="${w}" height="${h}" rx="14" fill="${C.surface}" stroke="${C.edge}"/>
${body}
</svg>
`;
}
