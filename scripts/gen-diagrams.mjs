#!/usr/bin/env node
/**
 * Generate the README diagrams as SVG. `npm run gen:diagrams`, commit the output.
 *
 * v3 — REMADE FROM SCRATCH (see the approved plan). Each diagram now has its own visual
 * metaphor instead of six variations on "boxes connected by elbow arrows". The rules:
 *   - no arrow-spaghetti: at most one connector, usually none;
 *   - no `X vs Y` crutch reused across the set (only gitnexus keeps a contrast, because the
 *     contrast IS the product);
 *   - one focal element; everything else is lower-weight context;
 *   - type that survives as a 200px thumbnail: min 16px for load-bearing text;
 *   - show the THING (a code snippet, a ranked list, a topology) not a box labeled with its name.
 *
 * Each carries an aria-label stating the one claim, so the image is never load-bearing on
 * its own.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  C, FONT, esc, svg, card, pill, eyebrow, headline, caption, MONO, dot, link, ghostText, gate, codeLine,
} from "./diagram-kit.mjs";

const out = {};

// ── 1. drift — the contagion that stops at the gate ──────────────────────────
// Left: one infected source fans infection out to ~5 downstream conclusions (the spread).
// Right: the same source, but a vertical NS gate wall between source and conclusions —
// the lines hit the wall and stop. The SHAPE (fan vs blocked) is the meaning; no box labels
// on the conclusions, no two-lane before/after.
out["drift"] = svg(
  900, 300,
  [
    eyebrow(28, 34, "a stale premise spreads to every later conclusion"),
    headline(28, 62, "It spreads — until a north-star stops it."),

    // --- LEFT: the spread (without) ---
    caption(28, 104, "WITHOUT", C.bad),
    // infected source
    dot(70, 150, 12, C.bad, { glow: C.bad }),
    caption(70, 182, "stale doc", C.bad, "start"),
    // fan-out to 5 downstream conclusions — straight thin links, no labels
    ...[0, 1, 2, 3, 4].map((i) => {
      const ty = 116 + i * 34;
      link(82, 150, 380, ty, C.bad, { width: 1.5, opacity: 0.55 });
    }),
    ...[0, 1, 2, 3, 4].map((i) => dot(388, 116 + i * 34, 7, C.bad, { opacity: 0.7 })),
    caption(400, 96, "every later conclusion inherits it", C.dim),

    // divider
    `<line x1="450" y1="100" x2="450" y2="200" stroke="${C.edge}" stroke-width="1.5" stroke-dasharray="2 5"/>`,

    // --- RIGHT: contained (with bearing) ---
    caption(478, 104, "WITH BEARING", C.accent),
    dot(520, 150, 12, C.bad, { glow: C.bad }),
    caption(520, 182, "stale doc", C.faint, "start"),
    // the gate wall
    gate(620, 110, 84, C.accent, "NS"),
    // links fan toward the wall and STOP at x=620 — no conclusions beyond
    ...[0, 1, 2, 3, 4].map((i) => {
      const ty = 116 + i * 34;
      link(532, 150, 620, ty, C.accent, { width: 1.5, opacity: 0.5, dash: "4 4" });
    }),
    // clean conclusions beyond the gate, never reached
    ...[0, 1, 2, 3, 4].map((i) => dot(800, 116 + i * 34, 7, C.good, { opacity: 0.35 })),
    caption(648, 222, "the gate outranks it — spread stops", C.accent),

    caption(28, 276, "A drifted agent doesn't crash. You find out three days later — unless a north-star caught it first.", C.faint),
  ].join("\n"),
  "Without bearing a stale premise spreads silently to every later conclusion; with it a north-star gate stops the spread at the source.",
);

// ── 2. northstars — the precedence stack ─────────────────────────────────────
// A ranked leaderboard, not a fan-in. NS-4 at the top in accent = current authority;
// the four sources below are struck through and tagged stale. Outranking read as vertical
// position — no arrows converging on a winner box.
const sources = ["A doc from March", "The README", "A code comment", "The agent's own guess"];
out["northstars"] = svg(
  900, 300,
  [
    eyebrow(28, 34, "four sources, one answer"),
    headline(28, 62, "Something has to outrank the rest."),

    // #1 — the current authority, accent, top of the stack
    `<rect x="28" y="92" width="540" height="52" rx="10" fill="url(#panelGrad)" stroke="${C.accent}" stroke-width="1.5" filter="url(#cardsh)"/>`,
    `<path d="M29 103 a10 10 0 0 1 10 -10 h4 v50 h-4 a10 10 0 0 1 -10 -10 z" fill="${C.accent}"/>`,
    `<text x="56" y="125" font-family="${MONO}" font-size="18" font-weight="700" fill="${C.accent}">#1</text>`,
    `<text x="96" y="125" font-family="${FONT}" font-size="18" font-weight="700" fill="${C.ink}">NS-4</text>`,
    `<text x="172" y="125" font-family="${FONT}" font-size="14" font-weight="600" fill="${C.dim}">— the current authority</text>`,

    // the four stale sources, ranked below, each struck through
    ...sources.map((s, i) => {
      const y = 160 + i * 30;
      return [
        `<text x="56" y="${y + 5}" font-family="${MONO}" font-size="14" font-weight="600" fill="${C.faint}">#${i + 2}</text>`,
        `<text x="96" y="${y + 5}" font-family="${FONT}" font-size="15" font-weight="600" fill="${C.dim}" text-decoration="line-through">${esc(s)}</text>`,
        pill(440, y - 8, "stale", C.bad),
      ].join("\n");
    }),

    caption(28, 284, "The agent must CITE it for any load-bearing claim — and may never edit it silently.", C.faint),
  ].join("\n"),
  "Four sources conflict; the numbered north-star outranks them all and the others are declared stale.",
);

// ── 3. taskcore — what survives the erasure ──────────────────────────────────
// Not a timeline. Top: a ghosted, half-erased transcript (what compaction destroys).
// Bottom: a crisp structured task-core card (what was saved). The contrast between erasure
// and crispness IS the claim; no ~90% box, no arrows.
out["taskcore"] = svg(
  900, 300,
  [
    eyebrow(28, 34, "long session · compaction incoming"),
    headline(28, 62, "What compaction erases, the task-core already saved."),

    // top panel — ghosted transcript, fading
    `<rect x="28" y="88" width="844" height="84" rx="10" fill="${C.panel}" stroke="${C.panelEdge}" opacity="0.5"/>`,
    ghostText(48, 112, "user: let's fix the fee calc so it handles net...", { size: 13, opacity: 0.18 }),
    ghostText(48, 132, "agent: I'll change RATE to net-gated... tried gross*RATE, that", { size: 13, opacity: 0.14 }),
    ghostText(48, 152, "broke the ledger test. gotcha: don't touch the RATE const, gate", { size: 13, opacity: 0.10 }),
    pill(720, 108, "transcript · dropped", C.bad),

    // the marker between the two panels
    `<text x="450" y="192" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" fill="${C.accent}">↓ written before the erasure ↓</text>`,

    // bottom panel — crisp, structured, fully opaque
    `<rect x="28" y="206" width="844" height="70" rx="10" fill="url(#panelGrad)" stroke="${C.accent}" stroke-width="1.5" filter="url(#cardsh)"/>`,
    `<path d="M29 217 a10 10 0 0 1 10 -10 h4 v68 h-4 a10 10 0 0 1 -10 -10 z" fill="${C.accent}"/>`,
    `<text x="56" y="232" font-family="${MONO}" font-size="14" font-weight="700" fill="${C.accent}">TASK-CORE</text>`,
    `<text x="56" y="256" font-family="${MONO}" font-size="13" font-weight="500" fill="${C.ink}">GOAL · CONSTRAINTS · DECISIONS(+why) · STATE · ANCHORS(file:line) · GOTCHAS</text>`,
    pill(740, 226, "goal intact", C.good),
  ].join("\n"),
  "Before compaction erases the transcript, the task-core saves the goal, decisions, and gotchas — and reads them back intact.",
);

// ── 4. microscope — the catch, not the machinery ─────────────────────────────
// A real code snippet with two stacked annotations: a green linter pass (Kind A, anyone can
// do it) and an orange expert catch (Kind B, the semantic wrongness). Below: a small
// 'refute → survived' gate stamp. No panel-of-lens boxes.
out["microscope"] = svg(
  900, 300,
  [
    eyebrow(28, 34, "domain-expert review · every finding must survive refutation"),
    headline(28, 62, "It runs perfectly. It's still the wrong fee."),

    // the code snippet
    `<rect x="28" y="92" width="520" height="56" rx="10" fill="${C.panel}" stroke="${C.panelEdge}" filter="url(#cardsh)"/>`,
    codeLine(48, 126, [
      { t: "const ", fill: C.faint },
      { t: "fee", fill: C.ink },
      { t: " = ", fill: C.faint },
      { t: "gross", fill: "#f2a58a" },
      { t: " * RATE;", fill: C.ink },
    ], { size: 19 }),
    caption(560, 120, "← the bug lives here", C.bad),
    caption(560, 138, "fee on gross, should be net", C.dim),

    // Kind A — linter / tests pass (green, lower weight)
    pill(28, 168, "✓  passes tests · linter  (Kind A)", C.good),
    // Kind B — expert catch (orange, the figure)
    pill(28, 206, "✗  fee computed on gross — ledger engineer  (Kind B)", C.bad),

    // the refute gate stamp
    `<rect x="28" y="246" width="280" height="34" rx="8" fill="none" stroke="${C.good}" stroke-width="1.5" stroke-dasharray="3 3"/>`,
    `<text x="168" y="268" text-anchor="middle" font-family="${MONO}" font-size="14" font-weight="700" fill="${C.good}">REFUTE → SURVIVED → reported</text>`,

    caption(330, 268, "Kind B is the part a linter can never do.", C.dim),
  ].join("\n"),
  "Kind A asks 'is it right?' — a linter can ask that. Kind B asks 'is it the right thing?' and catches a fee computed on gross that should be net: code that runs perfectly and is still wrong. Every finding must survive an adversarial refutation pass before it reaches you.",
);

// ── 5. minions — the fan-out topology ────────────────────────────────────────
// A topology: one agent node → fan of ~40 dots → converge back to 'you conclude'. The serial
// alternative is a tiny low-weight inset (a line threading dots). The shape is the meaning;
// no labeled boxes for 'spawn one per unit'.
out["minions"] = svg(
  900, 320,
  [
    eyebrow(28, 34, "forty files, one rule to check"),
    headline(28, 62, "Send forty gatherers, not one thread."),

    // agent node (top center-left)
    `<circle cx="120" cy="120" r="16" fill="${C.accent}" filter="url(#cardsh)"/>`,
    `<text x="120" y="158" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.accent}">agent</text>`,

    // fan-out links to 40 dots across a wide band
    ...(Array.from({ length: 40 }, (_, i) => {
      const x = 220 + i * 16;
      const y = 200 + Math.sin(i * 0.7) * 26;
      return [
        link(132, 120, x, y, C.rule, { width: 1, opacity: 0.5 }),
        dot(x, y, 4.5, C.accent, { opacity: 0.8 }),
      ].join("\n");
    })),

    // converge funnel back down to 'you conclude'
    `<path d="M220 250 Q450 300 690 250" fill="none" stroke="${C.accent}" stroke-width="1.5" opacity="0.5"/>`,
    `<circle cx="780" cy="276" r="16" fill="${C.good}" filter="url(#cardsh)"/>`,
    `<text x="780" y="314" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.good}">you conclude</text>`,

    // evidence chips on the converge (citations, not verdicts)
    pill(300, 268, "FOUND src/fees.ts:88", C.good),
    pill(520, 268, "CHECKED", C.faint),
    pill(640, 268, "MISSED", C.bad),

    // serial alternative — tiny low-weight inset, top right
    caption(700, 104, "SERIAL (the alternative)", C.faint),
    ...(Array.from({ length: 12 }, (_, i) => {
      const x = 700 + i * 14;
      return [
        x === 700 ? "" : link(x - 14, 120, x, 120, C.bad, { width: 1.25, opacity: 0.5 }),
        dot(x, 120, 3, C.bad, { opacity: 0.6 }),
      ].join("\n");
    })),
    caption(700, 142, "one agent, forty reads", C.faint),
  ].join("\n"),
  "Forty files checked serially by one agent, versus forty cheap anchored subagents each carrying the project's north-stars and persona; they return citations — FOUND file:line, CHECKED, MISSED — and the main agent draws the conclusion itself.",
);

// ── 6. gitnexus — noise vs structure ─────────────────────────────────────────
// The one diagram that keeps a contrast, because the contrast IS the product. Left: a wall of
// ~40 highlighted OrderService occurrences in a code-like texture (noise). Right: a tiny clean
// 3-node call graph with arrows (signal). No 'vs' badge; the density difference is the claim.
out["gitnexus"] = svg(
  900, 280,
  [
    eyebrow(28, 34, "you ask: who uses OrderService?"),
    headline(28, 62, "40 text matches, or the actual callers."),

    // LEFT — noise wall: ~40 highlighted occurrences in code texture
    caption(28, 96, "GREP · 40 matches, no structure", C.bad),
    `<rect x="28" y="104" width="396" height="120" rx="10" fill="${C.panel}" stroke="${C.panelEdge}" opacity="0.6"/>`,
    ...(Array.from({ length: 40 }, (_, i) => {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const x = 48 + col * 44;
      const y = 124 + row * 24;
      // faded code-ish line with one highlighted "OrderService" token
      return [
        `<text x="${x}" y="${y}" font-family="${MONO}" font-size="11" fill="${C.dim}" opacity="0.35">${esc("· use.")}</text>`,
        `<text x="${x + 34}" y="${y}" font-family="${MONO}" font-size="11" font-weight="700" fill="${C.bad}" opacity="0.85">O</text>`,
      ].join("\n");
    })),

    // RIGHT — signal: a tiny clean 3-node call graph
    caption(492, 96, "GRAPH · 3 callers, 2 flows", C.accent),
    `<rect x="492" y="104" width="380" height="120" rx="10" fill="url(#panelGrad)" stroke="${C.accent}" stroke-width="1.2" opacity="0.9"/>`,
    // 3 caller nodes
    dot(540, 134, 8, C.accent),
    `<text x="556" y="138" font-family="${MONO}" font-size="13" font-weight="600" fill="${C.ink}">Checkout</text>`,
    dot(540, 166, 8, C.accent),
    `<text x="556" y="170" font-family="${MONO}" font-size="13" font-weight="600" fill="${C.ink}">Refund</text>`,
    dot(540, 198, 8, C.accent),
    `<text x="556" y="202" font-family="${MONO}" font-size="13" font-weight="600" fill="${C.ink}">Webhook</text>`,
    // arrows into OrderService
    `<line x1="640" y1="134" x2="760" y2="166" stroke="${C.accent}" stroke-width="1.5" marker-end="url(#ar)"/>`,
    `<line x1="640" y1="166" x2="760" y2="166" stroke="${C.accent}" stroke-width="1.5" marker-end="url(#ar)"/>`,
    `<line x1="640" y1="198" x2="760" y2="166" stroke="${C.accent}" stroke-width="1.5" marker-end="url(#ar)"/>`,
    dot(772, 166, 10, C.ink),
    `<text x="772" y="194" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" fill="${C.ink}">OrderService</text>`,

    caption(28, 256, "A zero is not a finding — the graph is authoritative about what it FINDS, never about what it misses.", C.dim),
  ].join("\n"),
  "A grep returns 40 unstructured text matches; the graph returns the actual callers and flows — and a zero result is treated as unknown, not as absence.",
);

/**
 * Text that runs off the canvas is CLIPPED silently. Conservative width check so a
 * regeneration cannot reintroduce one; rasterising and LOOKING is still required for
 * collisions.
 */
function assertNoOverflow(name, body) {
  const w = Number(body.match(/viewBox="0 0 (\d+)/)[1]);
  const bad = [];
  for (const m of body.matchAll(/<text x="([\d.]+)"([^>]*)>([^<]*)</g)) {
    const attrs = m[2];
    const size = Number((attrs.match(/font-size="([\d.]+)"/) || [, 13])[1]);
    const width = m[3].length * size * 0.55;
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