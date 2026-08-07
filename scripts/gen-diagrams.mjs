#!/usr/bin/env node
/**
 * Generate the README diagrams as SVG. `npm run gen:diagrams`, commit the output.
 *
 * Why SVG and not mermaid: npm does not execute mermaid, so those blocks rendered as raw source on
 * npmjs.com (NS-17). Why generated and not hand-drawn: five hand-written SVGs drift in style the
 * moment one is edited, and the shared primitives keep the type scale and palette identical.
 *
 * ONE IDEA PER DIAGRAM. The previous set drew the whole process — the microscope one had twelve
 * boxes and twenty-four drawing calls at 11px type — which reads as "this product is complicated"
 * to someone deciding in two seconds whether to keep scrolling. Process detail belongs in prose,
 * where it can be skipped; a diagram's job is to land one claim at a glance.
 *
 * Each carries an aria-label stating that claim, so the image is never load-bearing on its own.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  C, svg, card, pill, arrow, elbow, elbowV, eyebrow, headline, caption, MONO,
} from "./diagram-kit.mjs";

const out = {};

// ── 1. drift — the failure the product exists for ────────────────────────────
// Two lanes, same input, opposite endings. Nothing else earns a place.
out["drift"] = svg(
  900, 268,
  [
    eyebrow(28, 34, "an agent reads a doc you abandoned in march"),
    headline(28, 60, "The premise is dead. Nothing fails."),

    card(28, 92, 196, 62, { title: "Stale doc", sub: "confident. fluent.", accent: C.faint }),

    elbow(224, 123, 300, 116, C.bad),
    elbow(224, 123, 300, 218, C.accent),

    caption(300, 100, "WITHOUT", C.bad),
    card(300, 108, 258, 54, { title: "Every later conclusion", sub: "inherits it, silently", accent: C.bad }),
    arrow(558, 135, 606),
    card(606, 108, 266, 54, { title: "Found out 3 days later", sub: "after you shipped on it", accent: C.bad, titleFill: "#f2a58a" }),

    caption(300, 202, "WITH BEARING", C.accent),
    card(300, 210, 258, 54, { title: "Contradicts NS-4", sub: "the north-star outranks it", accent: C.accent }),
    arrow(558, 237, 606),
    card(606, 210, 266, 54, { title: "Caught in one line", sub: "before the premise spreads", accent: C.good, titleFill: "#7fd9b4" }),
  ].join("\n"),
  "Without bearing a stale premise is found three days later; with it the north-star outranks the doc and it is caught in one line.",
);

// ── 2. north-stars — the claim is PRECEDENCE ─────────────────────────────────
out["northstars"] = svg(
  900, 256,
  [
    eyebrow(28, 34, "four sources, one answer"),
    headline(28, 60, "Something has to outrank the rest."),

    ...["A doc from March", "The README", "A code comment", "The agent's own guess"].map((t, i) =>
      card(28, 88 + i * 38, 232, 32, { title: t, titleFill: C.dim }),
    ),
    ...[0, 1, 2, 3].map((i) => elbow(260, 104 + i * 38, 372, 158, C.rule)),

    card(372, 132, 214, 52, { title: "CONFLICT", sub: "which one is true?", accent: C.bad, mono: true }),
    arrow(586, 158, 630),
    card(630, 120, 242, 76, { title: "NS-4 wins", sub: "the others are stale", accent: C.accent }),

    // Bottom-left and full width: at x=630 this ran off the 900px canvas and was clipped mid-word.
    caption(28, 232, "The agent must CITE it for any load-bearing claim — and may never edit it silently.", C.faint),
  ].join("\n"),
  "Docs, README, comments and the agent's own guess conflict; the numbered north-star wins and the others are declared stale.",
);

// ── 3. task-core — the claim is ORDER: written BEFORE the summary lands ──────
out["taskcore"] = svg(
  900, 238,
  [
    eyebrow(28, 34, "long session · context filling"),
    headline(28, 60, "The detail is written down before it's lost."),

    `<line x1="28" y1="150" x2="872" y2="150" stroke="${C.rule}" stroke-width="1.5" stroke-dasharray="3 4"/>`,

    card(28, 118, 176, 62, { title: "~90% full", sub: "pressure detected", accent: C.faint }),
    card(232, 108, 226, 82, { title: "TASK-CORE written", sub: "goal · decisions · gotchas", accent: C.accent }),
    caption(232, 206, "before the summary, not after", C.accent),
    card(486, 118, 168, 62, { title: "COMPACTION", sub: "transcript dropped", accent: C.bad, mono: true }),
    card(682, 108, 190, 82, { title: "Read back", sub: "goal intact", accent: C.good }),

    arrow(204, 150, 232),
    arrow(458, 150, 486),
    arrow(654, 150, 682),
  ].join("\n"),
  "At about 90% context the task-core is written before compaction drops the transcript, then read back with the goal intact.",
);

// ── 4. microscope — the claim is KIND B + adversarial filtering ──────────────
out["microscope"] = svg(
  900, 326,
  [
    eyebrow(28, 34, "milestone review · persona pinned from your repo"),
    headline(28, 60, "Two questions. Only survivors reach you."),

    card(28, 108, 196, 76, { title: "Your change", sub: "reviewed as a ledger engineer", accent: C.faint }),

    // Sub-text lives INSIDE the card. As separate captions it overlapped the box below — caught by
    // rasterising, not by reading the source (NS-10).
    card(252, 92, 286, 58, { title: "KIND A — is it right?", sub: "logic · edges · races", titleFill: C.dim }),
    card(252, 166, 286, 58, { title: "KIND B — the RIGHT thing?", sub: "why does this exist at all?", accent: C.accent }),

    elbow(224, 146, 252, 121, C.rule),
    elbow(224, 146, 252, 195, C.accent),
    elbow(538, 121, 574, 152, C.rule),
    elbow(538, 195, 574, 152, C.accent),

    card(574, 122, 298, 62, { title: "Try to REFUTE it", sub: "trace the value, read the branch", accent: C.bad }),

    // Vertical-first: routed BENEATH the lens cards instead of straight through them.
    elbowV(723, 184, 388, 244, 238, C.good),
    arrow(723, 184, 723, 244),

    pill(252, 250, "✓  survives → reported with file:line", C.good),
    pill(616, 250, "✕  refuted → you never see it", C.bad),

    caption(28, 308, "Kind B is the part a linter can never do — code that runs perfectly and is still the wrong thing.", C.dim),
  ].join("\n"),
  "A change is reviewed by a pinned domain persona through correctness and judgment lenses; every finding must survive an adversarial refutation attempt before it is reported.",
);

// ── 5. gitnexus — the claim is TEXT vs STRUCTURE ─────────────────────────────
out["gitnexus"] = svg(
  900, 244,
  [
    eyebrow(28, 34, "you ask: who uses orderservice?"),
    headline(28, 60, "40 text matches, or the actual callers."),

    caption(28, 96, "GREP", C.bad),
    card(28, 104, 380, 60, { title: "40 matches. No structure.", sub: "strings, comments, its own definition", accent: C.bad }),

    caption(492, 96, "GRAPH", C.accent),
    card(492, 104, 380, 60, { title: "3 callers, 2 flows, 1 route", sub: "what actually calls what", accent: C.accent }),

    `<text x="450" y="141" text-anchor="middle" font-family="${MONO}" font-size="15" font-weight="700" fill="${C.faint}">vs</text>`,

    caption(28, 200, "A zero is not a finding: the graph is authoritative about what it FINDS, never about what it misses.", C.dim),
    caption(28, 222, "Unresolvable callers are flagged, distrust is logged as a bug report you can send upstream.", C.faint),
  ].join("\n"),
  "A grep returns 40 unstructured text matches; the graph returns the actual callers and flows — and a zero result is treated as unknown, not as absence.",
);

/**
 * Text that runs off the canvas is CLIPPED, silently — SVG neither wraps nor complains, and the
 * source looks correct. Two captions shipped past the right edge during this rewrite and only a
 * rasteriser revealed it. This is the cheap half of that check so a regeneration cannot
 * reintroduce one; rasterising and LOOKING is still required for collisions (NS-10).
 */
function assertNoOverflow(name, body) {
  const w = Number(body.match(/viewBox="0 0 (\d+)/)[1]);
  const bad = [];
  for (const m of body.matchAll(/<text x="([\d.]+)"([^>]*)>([^<]*)</g)) {
    const attrs = m[2];
    const size = Number((attrs.match(/font-size="([\d.]+)"/) || [, 13])[1]);
    const width = m[3].length * size * 0.55; // conservative for the sans stack used here
    const end = /text-anchor="middle"/.test(attrs) ? Number(m[1]) + width / 2 : Number(m[1]) + width;
    if (end > w - 8) bad.push(`${JSON.stringify(m[3].slice(0, 44))} ends ~${Math.round(end)} > ${w}`);
  }
  if (bad.length) {
    console.error(`✗ ${name}.svg: text overflows the canvas\n   ${bad.join("\n   ")}`);
    process.exitCode = 1;
  }
}

mkdirSync("docs/assets", { recursive: true });
for (const [name, body] of Object.entries(out)) {
  assertNoOverflow(name, body);
  writeFileSync(`docs/assets/${name}.svg`, body);
  console.log(`  wrote docs/assets/${name}.svg`);
}
