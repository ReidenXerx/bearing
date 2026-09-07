/**
 * What a run records, and when — the one place that decides.
 *
 * `shots.js` is the camera: it decides what a good frame looks like. This decides whether a frame is
 * taken at all, points it at the right page, and turns on video.
 *
 * ⚠ THE PROBLEM THIS SOLVES. A verifier only ever photographs moments someone thought, in advance,
 * to photograph. That is backwards. The frame is worth most exactly when a check has just said
 * something is wrong and a reader has to decide whether to believe it — and that is the one moment
 * nobody predicts.
 *
 *   const { context, page } = await recording.open(browser, shots);
 *
 * After that a failed `check` photographs the page it failed on, a throw photographs itself, and —
 * with `SHOTS=all` — the run is on video.
 *
 * TIERS, via the `SHOTS` env var:
 *   off    nothing at all, deliberate shots included — for a check that MEASURES timing, where the
 *          shutter itself moves the number being reported
 *   key    (default) deliberate shots + a frame for every FAILED check and every throw
 *   all    ...plus a video of the whole run
 *
 * ⚠ `all` RECORDS RATHER THAN SCREENSHOTTING, AND THAT IS THE WHOLE LESSON. The first version of
 * this put automatic frames inside the interaction helpers — after a form fill, around a submit. It
 * took a 28-assertion verifier to **5 of 6**. A frame costs a few hundred milliseconds, and callers
 * race those helpers against the network:
 *
 *     await submitDrawer(page);                              // click
 *     await page.waitForResponse(pred, { timeout: 15000 });  // armed AFTER it
 *
 * A frame before the click spends a window the caller already opened; a frame after it swallows the
 * response the caller is about to wait for. **There is no safe side.** You cannot inject latency
 * into a shared helper without changing the semantics of every caller that races it, and an
 * observability mode that changes the result is not observability. Video is passive.
 *
 * ⚠ AND THE VIDEO ONLY EXISTS IF THE CONTEXT IS CLOSED. Playwright writes the file on
 * `context.close()` and nowhere else, so every path that ends a run has to close it first. The
 * first version of this module got that wrong in three places at once — `finish()`, `exit()` and
 * the crash handler each drained the SCREENSHOT queue and exited, and none of them closed the
 * context. The result was a **0-byte .webm on every passing run**: a file that exists, cannot be
 * played, and reads as success. That is why there is exactly one `drain()` below and why
 * everything funnels through it.
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const { runnerName } = paths;

const TIERS = { off: 0, key: 1, all: 2 };

/**
 * ⚠ AN UNKNOWN TIER IS ANNOUNCED, NOT SILENTLY IGNORED. `SHOTS=none`, `SHOTS=false` and a trailing
 * space from a CI YAML value all used to resolve to the maximum tier — so a typo in the flag set to
 * PROTECT a timing measurement silently invalidated it instead. `Object.hasOwn` also stops
 * `SHOTS=constructor` reaching `Object.prototype`.
 */
const readTier = () => {
  const raw = String(process.env.SHOTS ?? '').trim().toLowerCase();
  if (!raw) return TIERS.key;
  if (!Object.hasOwn(TIERS, raw)) {
    console.warn(`  ! SHOTS="${raw}" is not a tier (off | key | all) — using "key"`);
    return TIERS.key;
  }
  return TIERS[raw];
};
const TIER = readTier();

/** May a frame be taken at all? Callers ask; they do not interpret the tier. */
const enabled = () => TIER > TIERS.off;

const VIDEO_ROOT = path.join(paths.shots, 'video');

let ambientPage = null;
let ambientShots = null;
let contextSeq = 0;
const openContexts = new Set();
const pending = [];

// Cleared ONCE per process, not per context. Clearing inside `contextOptions()` deleted the first
// context's still-open recording the moment a verifier opened a second one — and on Windows,
// removing a directory holding an open handle throws rather than quietly losing the file.
if (fs.existsSync(VIDEO_ROOT)) fs.rmSync(VIDEO_ROOT, { recursive: true, force: true });

/** What to merge into `browser.newContext()` so this run is recorded. */
const contextOptions = () => {
  if (TIER < TIERS.all) return {};
  contextSeq += 1;
  // Per process AND per context: two runs of one verifier in a CI matrix share a name, and a single
  // verifier can open several contexts.
  return {
    recordVideo: { dir: path.join(VIDEO_ROOT, `${runnerName()}-${process.pid}-${contextSeq}`) },
  };
};

/**
 * Point the camera at a context and page.
 *
 * ⚠ `shots` IS REQUIRED, because the alternative is a silent privacy hole. `createShots({ mask })`
 * is where a project declares its sensitive regions, and a fallback that built its own instance
 * produced UNMASKED automatic frames — of a logged-in session, on whatever screen the run died on —
 * while every deliberate shot in the same run was masked. Those frames are the ones most likely to
 * end up in a ticket.
 */
const adopt = (context, page, shots) => {
  if (!shots || typeof shots.take !== 'function') {
    throw new Error(
      'recording.adopt(context, page, shots): `shots` is required.\n'
        + '  Pass the createShots({ dir, mask }) instance this run is using, so automatic failure\n'
        + '  frames inherit the same mask as your deliberate ones.',
    );
  }
  if (context && !openContexts.has(context)) {
    openContexts.add(context);
    context.on('close', () => openContexts.delete(context));
  }
  if (page) ambientPage = page;
  ambientShots = shots;
  armCrashCamera();
};

/**
 * Open a recorded context and adopt it — the whole wiring, in one call.
 *
 * Preferred over calling `contextOptions` and `adopt` separately: forgetting `adopt` fails SILENTLY
 * (every automatic frame becomes a no-op while the docs promise otherwise), and a wrapper the
 * verifier already calls cannot be forgotten.
 */
const open = async (browser, shots, contextOpts = {}) => {
  const context = await browser.newContext({ ...contextOptions(), ...contextOpts });
  const page = await context.newPage();
  adopt(context, page, shots);
  return { context, page };
};

/** Capture without holding a shooter. Returns null when there is nothing to photograph. */
const snap = async (key, { page = ambientPage, note = '' } = {}) => {
  if (!enabled() || !ambientShots || !page || page.isClosed?.()) return null;
  return ambientShots.take(page, key, { note }).catch(() => null);
};

/**
 * Photograph a failed check. Called by `report.check`.
 *
 * Fired, not awaited — `check` is synchronous and called from everywhere — with the promise kept so
 * `drain()` can wait for it. A slash in a check name would otherwise become a directory, so
 * `failures/` stays the one browsable folder its name promises.
 */
const onFailure = (name, detail = '') => {
  const key = `failures/${String(name).replace(/\//g, ' ')}`;
  const shot = snap(key, { note: detail || 'a check failed here' });
  pending.push(shot);
  return shot;
};

/** Photograph a throw. Awaited, because the caller still has a live page and will not for long. */
const captureThrow = async (err) => {
  await snap('crash', { note: String(err?.message || err).split('\n')[0].slice(0, 120) });
};

/**
 * Wait for every queued frame, then close every context so the videos are written.
 *
 * ⚠ RE-ENTRANT AND IDEMPOTENT ON PURPOSE. An earlier version was `Promise.all(pending.splice(0))` —
 * a one-SHOT queue transfer. `finish()` spliced the queue, `withBrowser`'s own drain then found it
 * empty and returned immediately, and the context was closed out from under a screenshot the first
 * drain was still waiting on. Two callers, one queue, and only the first of them worked.
 *
 * ⚠ `allSettled`, not `all`. This runs inside `finally` blocks; one rejected capture must never
 * skip the `browser.close()` below it and leak a chromium process.
 */
let draining = null;
const drain = async () => {
  // ⚠ A SECOND CALLER JOINS THE FIRST DRAIN — it does not start an empty one. Without this, the
  // exit path took the contexts, cleared the set, and began closing them; `withBrowser`'s own drain
  // then found nothing to do, returned immediately, and `browser.close()` killed the context in the
  // middle of writing its video. Intermittently: one run in three produced a real file and the rest
  // were 0 bytes, which is the worst possible signal because the feature looks like it works.
  if (draining) return draining;
  draining = (async () => {
    while (pending.length) {
      const batch = pending.slice();
      await Promise.allSettled(batch);
      pending.splice(0, batch.length);
    }
    const contexts = [...openContexts];
    openContexts.clear();
    await Promise.allSettled(
      // A wedged renderer must not turn a `finally` into a permanent hang.
      contexts.map((c) => Promise.race([
        c.close().catch(() => {}),
        new Promise((r) => { setTimeout(r, 5000); }),
      ])),
    );
  })();
  try {
    await draining;
  } finally {
    draining = null;
  }
};

/** Drain, then exit. `process.exit` is immediate — nothing runs after it. */
const exit = async (code) => {
  await drain().catch(() => {});
  process.exit(code);
};

/**
 * Photograph the page when a run dies on an uncaught error.
 *
 * ⚠ THE STACK IS PRINTED, NOT SWALLOWED. Registering an `uncaughtException` listener suppresses
 * node's default report, so an earlier version replaced a full stack trace with a one-line message
 * and a screenshot. A picture of the screen does not tell you which line threw; you need both.
 *
 * ⚠ RE-ENTRANCY GUARD. This handler is async and also registered for `unhandledRejection`, so a
 * rejection raised inside it re-entered itself forever and the process never exited at all — a CI
 * job burning to its timeout having already printed its tally.
 */
let crashArmed = false;
let crashing = false;
const armCrashCamera = () => {
  if (crashArmed) return;
  crashArmed = true;
  const onCrash = async (err) => {
    if (crashing) return;
    crashing = true;
    try {
      await captureThrow(err);
      await drain();
      console.error(`\n${err?.stack || String(err)}\n  (a frame was saved — see ${paths.shots})\n`);
    } finally {
      process.exit(1);
    }
  };
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
};

module.exports = { open, adopt, contextOptions, snap, onFailure, captureThrow, drain, exit, enabled };
