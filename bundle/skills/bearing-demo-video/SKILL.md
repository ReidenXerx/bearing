---
name: bearing-demo-video
description: "Record a narrated demo video of a feature from the e2e harness — voice, captions, a visible cursor, a sample-data badge, nothing written to the backend — and review it before anyone sees it. Use when someone asks to SEE a feature (a stakeholder, a client, a reviewer), for a walkthrough, a product demo or a release video. Examples: \"record a demo of the new page\", \"make a video showing how this works\", \"send the client a walkthrough\", \"can you make a narrated demo?\"."
---

# Narrated demo videos — from the e2e harness

A demo is the product speaking to someone outside the team, with the authority of a screen
recording. It needs the same honesty as a verifier and the polish of a presentation. The tools are in
`.e2e/tools/demo/`; the order below is the order that worked on a real two-minute stakeholder demo.

## 1. Before anything is recorded — what may be shown

- **Never production data, and never real people's data**, in something shareable. Run against a
  sandbox build, and answer the read endpoints the page needs with **sample data** (`page.route`).
- **Answer EVERY write locally** — saves, activations, sends, tests — with `blockWrites` from
  `core/http.js`, so nothing persists. A demo that saved something is a demo that changed a system.
- **Say it on screen for the whole video:** `installDemoChrome(context, { badge: 'Sample data' })`.
- **The narration must not describe what the product does not do.** Write each sentence against the
  page, not against the plan. (The kit's own test demo said "the results narrow as you type" over a
  page with no results list — caught only by watching it.)

## 2. Write the story as steps, and make the voice FIRST

`steps.json`: one sentence per step, each tied to ONE visible action.

```bash
node .e2e/tools/demo/narrate.js demo/steps.json demo/narration      # macOS `say`, else espeak-ng
```

Every clip is generated and measured before recording, so the recording paces itself to the voice
instead of guessing how long a sentence takes.

## 3. Record, driven like a person

```js
const { installDemoChrome } = require('../tools/demo/chrome');
const { createDirector } = require('../tools/demo/record');
const context = await browser.newContext({ recordVideo: { dir: 'demo/raw', size: { width: 1600, height: 1000 } }, viewport: { width: 1600, height: 1000 } });
await installDemoChrome(context, { badge: 'Sample data' });     // cursor, captions, badge, [title] tooltips
const page = await context.newPage();
const d = createDirector(page, require('../demo/narration/narration.json'));   // right after newPage: video time zero
await page.goto(BASE);
await d.narrate('intro', async () => { await d.moveTo(page.getByRole('heading', { name: 'Invoices' })); });
await d.narrate('search', async () => { await d.typeSlowly(page.getByRole('searchbox'), 'acme'); });
d.save('demo/timeline.json');
const video = page.video();            // BEFORE closing — its path resolves only after the context closes
await context.close();
```

- A headless video has **no cursor and no native tooltips** — the chrome draws both.
- **Scope locators by role or attribute.** A text-only locator collided: an "All" tab and an "All"
  range button, and the click went to the tab.
- **Use the kit's session** (`core/session.js`) so the demo is signed in like any verifier.
- **One heavy job at a time on a small machine** — dev server, recording and encode together can push
  a 16 GB laptop into swap, and a low-memory guard stops background jobs. Start the dev server in the
  user's own terminal when swap is nearly full.

## 4. Mux, then REVIEW before sending

```bash
node .e2e/tools/demo/mux.js "$(ls demo/raw/*.webm)" demo/timeline.json demo/demo.mp4
node .e2e/tools/demo/review.js demo/demo.mp4 demo/timeline.json demo/review
```

`mux.js` trims the sign-in dead air and lays each clip at its step (H.264 + AAC, faststart — it plays
everywhere). `review.js` is the gate:

- **Voice against picture:** silence just before each clip, speech inside it. It exits 1 on an
  overlap or a silent step.
- **One frame per step on contact sheets** — open every sheet and LOOK. A frame that looks wrong may
  have missed the moment: pull denser frames inside that step before calling it broken.

Only then send it — with what it shows, and that the data is sample data.
