---
name: bearing-publish-visuals
description: "Design the visuals that publish what you built — feature cards, a README hero, a social preview, a release or mod-page header, a before/after or a chart — so each one makes ONE claim that is true, readable at the size it is shown, and rendered whole — drawn as an infographic from a real run (every mark a data point: a funnel, swimlanes, a with/without diptych, a timeline), never a slide of sentences in boxes. Use when asked to make a card, banner, infographic, hero image, social preview, release graphic or store/mod page visuals, or before publishing any image that states a number or a capability. Examples: \"make a card for this feature\", \"design a README hero\", \"we need a social preview\", \"make release visuals\", \"turn these numbers into an infographic\", \"is this banner OK to publish?\"."
---

# Publishing visuals — one true claim per image

An image on a release page is a claim with the authority of a screenshot. Readers believe it more
than the text under it, and they see it at a fraction of the size you designed it. So the craft is
mostly discipline: what the image may claim, whether it shows THIS feature, whether the PICTURE makes
the claim (an infographic drawn from real data, not a slide of sentences in boxes — §2), and whether
it survives the size it is read at. Every rule below was learned on a real publish (mod pages,
product pages, READMEs) — the traps in §6 each went out wrong once.

## 1. The claim comes first

1. **Write the card's one claim as a sentence** before laying anything out: *"the gun leans 15° and
   stays steady to 0.1 units"*, *"one impact question costs 3–13× less through the graph"*. If you
   cannot write the sentence, there is no card yet.
2. **The owner of the code decides what may be claimed; you decide how it looks.** Before drawing,
   ask (or check the code, tests, changelog): which features deserve a card, which numbers were
   MEASURED, which stills or clips exist, what must NOT be claimed.
3. **Check every number's MEANING at its source, not only its value.** A rate that dropped because
   a measuring tool was fixed is not a gain for the user. An endpoint that "goes to zero" may keep a
   cap. Print the context next to the number (*"(at 1600×900, 3 trials)"*).
4. **Unconfirmed is omitted, not caveated.** No "tested"/"untested"/"awaiting reports" in an image.
5. **Measured numbers are the value of a card — volatile ones are not.** A number measured about a
   FIXED mechanism belongs on the card (*"leans 15°"*, *"16.4 vs 16.5 ms per frame"*). A COUNT that
   changes between releases (things shipped, versions, test totals) never goes in the image — it is
   wrong one release later; put it in the page text or a generated badge (§5). A DEFAULT that may be
   retuned goes in the caption text, not the picture (a "0.1% → 2%" default lives under the card).
   Counts INSIDE one recorded run are fixed and belong in its picture (*"28 findings → 27 survived
   the refutation"*), as long as the footer names that run — what goes stale is a project total.
6. **The second gate is your own eyes. Render, OPEN the image, write down what you see — then fix.**
   Looking caught more defects than every automated check together: a crop through the action, a
   label on the subject, the subject hiding the feature, mojibake that every check passed. A render
   nobody looked at is not finished, however green its checks.

## 2. An infographic, not a slide

The default an agent reaches for is a slide: a headline, then rounded boxes that each hold a sentence
— a row per feature, an icon-title-blurb grid, "tiles" whose big number is a word. That is a
presentation slide, not an infographic, and it proves nothing: the reader has to trust the text, and
at the shown size the text is all they get. A card built that way was rejected on sight ("PowerPoint
from 20 years ago") and every card in the set was redrawn from real runs.

**The test: cover the headline, the subtitle and the footer. Does the picture alone still make the
claim?** A funnel of dots that shrinks at each gate says "only what survives reaches you" with no
words at all. Five boxes of prose say nothing once the prose is hidden. If covering the text leaves
decoration, it is a slide — redraw it.

1. **Every mark is a data point.** Each dot, bar, segment, node or line is one counted thing from a
   real run or measurement: a finding, a minion, a trial, a commit, a token. The data lives in
   `data/*.json` exported from the run, and code draws the marks from it — never placed by hand. Ten
   things → ten marks. A mark that stands for nothing is decoration; delete it.
2. **The picture is most of the card — at least 60% of its area.** Text inside it is labels of a few
   words (a lens name, a gate's `28 → 27`, a time axis), never sentences. A sentence that has to be
   there goes in the subtitle or under one highlighted item.
3. **One visual channel per meaning, kept across the whole set.** Position = stage or time, colour =
   class or outcome (severity, pass/fail), fill vs ring vs ✗ = state (found / found twice /
   disproved). Every encoding that is not obvious gets a small legend inside the card.
4. **Pick the shape from what the thing DOES, not from a layout you like:**

| What it does | Shape | Example that worked | Start from |
| --- | --- | --- | --- |
| Turns many inputs into fewer, checked outputs | **Flow / funnel**: a dot per item grouped by source, a gate per check labelled `n → m` and why, then what reaches the reader, ranked, top items named | Microscope: 5 lenses → refute 28→27 → dedupe 27→24 → ranked report | `card-template.html` |
| Runs work in parallel | **Swimlanes on a real time axis**: a bar per worker from its start to its end, its result at the end of its lane | Minions: 8 lanes, 17:19–17:25, `FOUND n` per lane, total → one decision | `shapes/swimlanes.html` |
| Changes an outcome (with vs without) | **Diptych of the real artifact**: the same code or reply WITHOUT / WITH, the outcome under each, then a strip of trial dots per arm | TS/JS: an `any` returned as-is vs guarded; ● per run | `shapes/diptych.html` |
| Acts on events across a session | **Timeline with event marks**: the session as a line, each event a mark at its real position | Task-core: six wipes, a save before each one | `shapes/timeline.html` |
| Costs or weighs something | **Proportional bars or blocks from real sizes** (bytes, tokens, ms) | Context cost: a 200k window drawn to scale, bearing's share by area, measured on fresh installs | `shapes/blocks.html` |
| Has a structure | **The real tree or graph**, exported and laid out | — | — |
| Is a UI | **The real screenshot**, or a mock laid out from the code with made-up content | A panel drawn from its own `main.js` | — |

5. **Before drawing, write down: which run, which file holds its data, and what ONE mark is.** If
   there is no run yet, get one: run the tool once on a real repo and export what it produced. If
   none is possible, that card is a mechanism rebuilt from the code (§3.2) — it is never a text slide.
6. **The headline is read off the picture.** It states what the picture shows (*"Five lenses. Only
   what survives reaches you."*), with the result in the accent colour. The footer names the run:
   where, when, which model or tool, what one mark is.
7. **A set looks like one set:** a shared stylesheet, shared draw helpers, the same palette, kicker,
   legend style and footer across every card. Build it as a folder (§5), not as one-off pages.

## 3. What to show — in this order of preference

1. **The real thing.** A real screenshot or clip; real geometry or data exported from the project and
   drawn (a mesh coloured by a measured quantity, the actual output). The card is its own proof.
2. **The real mechanism, rebuilt**, when the thing cannot be shown — animate what the code does.
3. **Numbers computed from the code's own constants**, when neither is possible — the chart IS the
   mechanism, not an illustration of it.

**It must show OUR feature.** A banner of the game's own animation, or the framework's default
behaviour, sold as the feature is the most damaging card there is. When unsure, get an A/B (feature
off vs on) or a log line proving the feature ran in that clip. Film or capture it the way it actually
runs (a first-person feature filmed in third person shows the default).

## 4. Layout — readable at the size it is SHOWN

A card is designed large and shown small: a 1600-px card in a ~940-px page column, a social preview
as a ~400-px thumbnail, a README image at the reader's window width. Design for the shown size.

- **Top to bottom:** kicker (project · area, small mono, accent colour) → headline (the one claim,
  the result in the accent) → subtitle (what the user gets, ≤ 2 lines) → the visual, ≥ 60% of the
  card (§2) → stat tiles ONLY where a number the picture shows must be read exactly ("from → to" in
  big type, one plain line each) → footer (small mono: the run or source — files, decision ids, the
  tool that measured it).
- **Body text ≥ 22 px at the SHOWN width** (a 1600-px card in a ~940-px column needs ~22 px there, so
  larger in the render); a tile holds ≤ 2 lines; one idea per card. Where the host rescales, render
  at 2× the shown size — but measure the text minimum against what is shown, not what is rendered.
- **Before/after:** same framing and scale in both panes, plain labels ("WITHOUT" / "WITH <name>").
  Before is plain and muted; after carries the accent and the big number. A bottom strip may state
  the single rule.
- **Non-breaking hyphens** (`&#8209;`) in hyphenated names, so they never wrap mid-name.
- **Background: match the HOST page, and give every image a solid background of its own.** A card on
  a dark site sits flush when it is dark too; one on a white page or feed may want the opposite.
  *(General knowledge, not a scar from this method:* a README is viewed in both GitHub themes, so a
  transparent PNG with dark text vanishes in dark mode and light text vanishes in light mode — never
  ship text on transparency there.)
- **Palette from the subject.** A product's own visuals use its own design tokens and fonts. **A
  wordmark or logo is cropped from the brand art, never retyped** in a similar font.
- **Match the weight of the project.** A flagship gets drama; a small utility gets clean, plain type.
  Grand styling on a small thing reads as a joke.
- **The host draws its own UI over your image.** Find where (a title, stats, buttons, a darkening
  gradient) and keep everything that matters out of that zone — on a Nexus header it is the bottom
  ~40% plus the top-right button, which leaves the 5–60% band. Preview by swapping the image's src in
  your own browser tab before uploading.
- **A page is images with one plain line each; depth links out** — to articles, docs or a wiki, one
  per theme — instead of a wall of text around the cards.

## 5. Build and render — deterministic, then LOOK

Cards are HTML/CSS (canvas, SVG or three.js inside when needed), rendered to an image. One folder per
project: one HTML page per card, a shared stylesheet, a small shared `draw.js` (an `el()` that makes an
SVG element, a `text()`, a `ready()` that awaits the fonts and sets `__ready`), and `data/*.json`
exported from the real run. Start from `.bearing/skills/bearing-publish-visuals/card-template.html` —
a funnel drawn from data, with the charset, the helpers, a legend and the `__ready` handshake — or
from the shape in `shapes/` that §2's table names (swimlanes, diptych, timeline, blocks). Each one
renders as it is, with placeholder data marked `REPLACE`; swap in the real run's export and keep the
shape of code: data in, one mark per item out.

```bash
node .bearing/skills/bearing-publish-visuals/render.mjs cards/feature.html out/feature.jpg 1600 900 90
node .bearing/skills/bearing-publish-visuals/render.mjs cards/readme.html out/readme.png 1200 auto --scale 2
```

`auto` takes the page's own height, so a card whose text grew is never cut and never padded with a
dead band. `--scale 2` renders twice the pixels without changing the layout: lay a README card out at
about the width it is shown (~1200 CSS px), so text sized there is the size the reader sees, and it
stays sharp on a retina screen.

The page sets `window.__ready = true` when it is finished; the renderer waits for exactly that,
serves the folder over http, and **exits 1** on a missing `__ready`, a broken image, a failed request
or a page error. Make renders reproducible:

- `await document.fonts.load('700 64px "Your Font"')` before drawing canvas text — otherwise it is
  drawn in the fallback font that happened to be loaded.
- Seeded randomness and pinned assets, so a re-render changes only what you changed.
- Data via `fetch('data/x.json')` works only over http — never open the card as file://.
- **Then open the output and look at it** — at full size AND at the width it will be shown (§1.6).
- **When only a line of TEXT is stale, change that line and re-render from the same pinned assets** —
  a full rebuild from moved sources once came out different from the card it replaced.
- A divider or overlay that must be transparent: set `window.__transparent = true` and render to PNG.

**Live numbers** (tests passing, size, downloads): a shields.io badge generated by a script, never
typed. Check the RENDERED badge text — an error badge loads as successfully as a good one. Group
badges in rows by the question they answer (trust / size and activity / requirements); five in one
row overflow a ~940-px column.

**Hosting images outside the platform:** pin the URL to a full commit SHA
(`cdn.jsdelivr.net/gh/<owner>/<repo>@<sha>/docs/img/x.jpg`, `raw.githubusercontent.com/…/<sha>/…`).
A branch URL changes under a page that is already published.

### Sizes that have worked

| Destination | Size | Format |
| --- | --- | --- |
| README hero | 1600×760 | JPG q92 (or PNG for flat colour) |
| GitHub social preview | 1280×640 | JPG q92 |
| Feature card (README, docs, store/mod page) | 1600×900 | JPG q90 |
| Feed post (square) — *bearing's own, not from this method* | 1200×1200 | PNG/JPG |
| Section divider | 1600×64 | transparent PNG |
| Nexus Mods header | 2600×744 — rendered at 2× of the 1300×372 it is shown at | JPG q90 — content in the 5–60% vertical band, clear of the top-right corner |
| Animated banner from footage | ~1000 px wide, 3.5:1, 12–15 fps, 3–8 s | GIF + animated WebP, ≤ 8 MB each |

For footage, `gif-banner.mjs` makes the GIF and the animated WebP together, under the size cap:

```bash
node .bearing/skills/bearing-publish-visuals/gif-banner.mjs clip.mp4 out/banner --start 2 --dur 5 --y 0.45
```

It crops a 3.5:1 strip centred on `--y` (0..1 of the height), one palette for the whole clip that
favours what moves, and — over 8 MB — drops fps (to no lower than 12), then width by 15%, and
gives up after 7 tries with "shorten the clip": cutting length beats cutting quality. `--pingpong`
hides the loop seam of footage that does not loop by itself. Where ffmpeg has no WebP encoder it
falls back to `gif2webp` on the finished GIF and says so — that WebP inherits the GIF's 192-colour
palette and dither, so it is worse than a direct encode; use an ffmpeg built with libwebp
(`FFMPEG=/path/to/ffmpeg`) when the WebP matters. **The crop must keep the ACTION in
frame** — a strip that cut off the hand doing the reload had to be re-cut at full width.

## 6. Traps — each one went out wrong once

- **The base product's own behaviour (vanilla) sold as our feature** — the game's own NPC peek animation
  looked like the mod's lean. → A/B or log proof.
- **A true value, a false meaning**: "72% → 27%" was a fixed measuring tool, not a user gain.
- **A slide shipped as an infographic**: a headline over rows of rounded boxes, each holding a
  sentence, was rejected as "PowerPoint from 20 years ago" — covering the text left nothing. → §2:
  every mark a data point from a real run, the picture ≥ 60% of the card.
- **A count went stale one release later** ("699" became 706). → Counts live in text or badges.
- **Half-rendered frames**: fallback font on canvas, chart before its data, file:// fetches failing
  silently, a different random layout on every render. → `__ready`, fonts, http, seeds.
- **Mojibake**: `·` became `Â·` and `→` became `â†'` — a page without `<meta charset="utf-8">`
  served without a charset is decoded as Windows-1252. Every automated check passed; looking at the
  render caught it. → The template declares it, and the renderer sends `charset=utf-8` too.
- **The subject hid the feature** (clothing over the area the card was about); **a crop cut the
  action** (the hand doing the reload); **a label landed on the subject**. → Look at every render.
- **Screen capture dropped the bottom fifth** at 125% display scaling. → Check the full frame.
- **Coordinate conventions** — Z-up assets in a Y-up renderer need a −90° rotation on X; an ellipse on
  an equirectangular texture becomes a slit. → Check orientation on the first render.
- **Tone and content**: no gore or adult content on a general-audience page, and assets must not leak
  from a sibling project with a different audience — script the check. Others' meshes, paid assets
  and avatars stay off cards; check where every contributed asset came from.
- **Heavy pages**: eight 12–16 MB banners. → ≤ 8 MB each.
- **Platform quirks**: on a fresh page the first upload may become the header (upload the header
  first); a gallery may not reorder (upload new, repoint, hide old); closing the tab aborts uploads.

## 7. Before you publish — the checklist

1. Cover the headline, subtitle and footer: the picture alone still makes the claim. Every mark is
   drawn from `data/*.json` exported from a real run; no box of prose stands in for a picture.
2. One claim per image, written down, traceable to code, a log, a changelog or a measurement — and
   the owner agreed it may be claimed.
3. Every number's meaning checked at its source, printed with its context, and not a count that
   changes between releases.
4. Nothing unconfirmed shown; no "tested"/"untested" wording.
5. It shows OUR feature — A/B or log proof when unsure.
6. Rendered deterministically: `__ready`, fonts awaited, seeded; no broken images, no page errors.
7. Opened, LOOKED at, and what you saw written down — full size AND at the shown width: nothing
   cropped, overlapping or wrapped; body text ≥ 22 px at the SHOWN width.
8. Headers keep what matters out of the platform's overlay.
9. Size limits met; externally hosted URLs pinned to a commit SHA.
10. No content that does not belong on this page; no third-party assets without provenance.
11. After publishing, open the PUBLIC page as a visitor sees it: count the images that loaded, look at
    a screenshot. An upload that went through is not a page that renders.
12. The page text describes each card in the same words the card uses.
