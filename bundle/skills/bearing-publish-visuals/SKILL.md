---
name: bearing-publish-visuals
description: "Design the visuals that publish what you built — feature cards, a README hero, a social preview, a release or mod-page header, a before/after or a chart — so each one makes ONE claim that is true, readable at the size it is shown, and rendered whole. Use when asked to make a card, banner, infographic, hero image, social preview, release graphic or store/mod page visuals, or before publishing any image that states a number or a capability. Examples: \"make a card for this feature\", \"design a README hero\", \"we need a social preview\", \"make release visuals\", \"turn these numbers into an infographic\", \"is this banner OK to publish?\"."
---

# Publishing visuals — one true claim per image

An image on a release page is a claim with the authority of a screenshot. Readers believe it more
than the text under it, and they see it at a fraction of the size you designed it. So the craft is
mostly discipline: what the image may claim, whether it shows THIS feature, and whether it survives
the size it is read at. Every rule below was learned on a real publish (mod pages, product pages,
READMEs) — the traps in §5 each went out wrong once.

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
5. **Never bake a number that changes between releases** into an image (counts of things, versions,
   test totals). It is wrong one release later and an image is expensive to change. Put it in the
   page text, or use a generated badge (§4). A measured number about a fixed mechanism is fine.

## 2. What to show — in this order of preference

1. **The real thing.** A real screenshot or clip; real geometry or data exported from the project and
   drawn (a mesh coloured by a measured quantity, the actual output). The card is its own proof.
2. **The real mechanism, rebuilt**, when the thing cannot be shown — animate what the code does.
3. **Numbers computed from the code's own constants**, when neither is possible — the chart IS the
   mechanism, not an illustration of it.

**It must show OUR feature.** A banner of the game's own animation, or the framework's default
behaviour, sold as the feature is the most damaging card there is. When unsure, get an A/B (feature
off vs on) or a log line proving the feature ran in that clip. Film or capture it the way it actually
runs (a first-person feature filmed in third person shows the default).

## 3. Layout — readable at the size it is SHOWN

A card is designed large and shown small: a 1600-px card in a ~940-px page column, a social preview
as a ~400-px thumbnail, a README image at the reader's window width. Design for the shown size.

- **Top to bottom:** kicker (project · area, small mono, accent colour) → headline (the one claim,
  one word in the accent) → subtitle (what the user gets, ≤ 2 lines) → the visual → stat tiles
  ("from → to" in big type, each with one plain line saying what it means) → footer (small mono:
  the source — files, decision ids, the tool that measured it).
- **Body text ≥ 22 px at 1600 px wide**; a tile holds ≤ 2 lines; one idea per card.
- **Before/after:** same framing and scale in both panes, plain labels ("WITHOUT" / "WITH <name>").
  Before is plain and muted; after carries the accent and the big number. A bottom strip may state
  the single rule.
- **Non-breaking hyphens** (`&#8209;`) in hyphenated names, so they never wrap mid-name.
- **Colour:** dark usually beats white (and stops a white feed's scroll). Take the palette from the
  subject; a product's own visuals use its own design tokens and fonts; a wordmark is cropped from
  the brand art, never retyped.
- **Match the weight of the project.** A flagship gets drama; a small utility gets clean, plain type.
  Grand styling on a small thing reads as a joke.
- **Headers are overlaid by the platform.** Find out where its title, stats and buttons sit (often the
  bottom ~40% and a corner) and keep everything that matters out of it. Preview by swapping the image
  in your own browser tab before uploading.
- **A page is a storefront:** a column of cards, one plain line under each, a link to the long
  article. Deep dives go in articles, one per theme.

## 4. Build and render — deterministic, then LOOK

Cards are HTML/CSS (canvas, SVG or three.js inside when needed), rendered to an image. One folder per
project: one HTML page per card, a shared stylesheet, and `data/*.json` exported from the real assets.

```bash
node .bearing/skills/bearing-publish-visuals/render.mjs cards/feature.html out/feature.jpg 1600 900 90
```

The page sets `window.__ready = true` when it is finished; the renderer waits for exactly that,
serves the folder over http, and **exits 1** on a missing `__ready`, a broken image, a failed request
or a page error. Make renders reproducible:

- `await document.fonts.load('700 64px "Your Font"')` before drawing canvas text — otherwise it is
  drawn in the fallback font that happened to be loaded.
- Seeded randomness and pinned assets, so a re-render changes only what you changed.
- Data via `fetch('data/x.json')` works only over http — never open the card as file://.
- **Then open the output and look at it** — at full size AND at the width it will be shown. Crops,
  overlaps, a label on the subject, a wrapped name: fix, re-render, look again.

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
| Feed post (square) | 1200×1200 | PNG/JPG |
| Section divider | 1600×64 | transparent PNG |
| Nexus Mods header | 2600×744 (2× of 1300×372) | JPG q90 — content in the 5–60% vertical band, clear of the top-right corner |
| Animated banner from footage | ~1000 px wide, 3.5:1, 12–15 fps, 3–8 s | GIF + animated WebP, ≤ 8 MB each |

For footage: ffmpeg `palettegen`, then step fps and width DOWN until under the cap before you drop
quality; foliage and particles cost the most bytes. Pass `-nostdin` to ffmpeg in scripts.

## 5. Traps — each one went out wrong once

- **It showed the default, not the feature** (a vanilla animation sold as the mod's). → A/B or log proof.
- **A true value, a false meaning**: "72% → 27%" was a fixed measuring tool, not a user gain.
- **A count went stale one release later** ("699" became 706). → Counts live in text or badges.
- **Half-rendered frames**: fallback font on canvas, chart before its data, file:// fetches failing
  silently, a different random layout on every render. → `__ready`, fonts, http, seeds.
- **Mojibake**: `·` became `Â·` and `→` became `â†'` — a page without `<meta charset="utf-8">`
  served without a charset is decoded as Windows-1252. Every automated check passed; looking at the
  render caught it. → Declare the charset in every card.
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

## 6. Before you publish — the checklist

1. One claim per image, written down, traceable to code, a log, a changelog or a measurement — and
   the owner agreed it may be claimed.
2. Every number's meaning checked at its source, printed with its context, and not a count that
   changes between releases.
3. Nothing unconfirmed shown; no "tested"/"untested" wording.
4. It shows OUR feature — A/B or log proof when unsure.
5. Rendered deterministically: `__ready`, fonts awaited, seeded; no broken images, no page errors.
6. Opened and looked at — full size AND at the shown width: nothing cropped, overlapping or wrapped;
   body text ≥ 22 px at 1600 wide.
7. Headers keep what matters out of the platform's overlay.
8. Size limits met; externally hosted URLs pinned to a commit SHA.
9. No content that does not belong on this page; no third-party assets without provenance.
10. After publishing, open the public page as a visitor: count the images that loaded, look at a
    screenshot.
11. The page text describes each card in the same words the card uses.
