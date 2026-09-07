/**
 * What a run records, and when — the one place that decides.
 *
 * `shots.js` is the camera: it decides what a good frame looks like. This decides whether a frame
 * is taken at all, points it at the right page, and turns on video. The split matters because the
 * alternative is what it replaced in the repo this came from: tier logic in the camera, video
 * options in the session module, and the shutter reached for directly from the reporter — three
 * files each holding a piece of "should this run be recorded".
 *
 * ⚠ THE PROBLEM THIS SOLVES. A verifier only ever photographs moments someone thought, in advance,
 * to photograph. That is backwards. The frame is worth most exactly when a check has just said
 * something is wrong and the reader has to decide whether to believe it — and that is the one
 * moment nobody predicts. Every hour lost to this harness's ancestor began with a red line in a
 * terminal and no picture of the screen behind it.
 *
 * So: `report.check()` photographs its own failures, an uncaught throw photographs itself, and a
 * run can be watched end to end on video. None of it needs a verifier to remember anything.
 *
 *   const context = await browser.newContext({ ...recording.contextOptions() });
 *   const page = await context.newPage();
 *   recording.adopt(context, page);        // one line; everything else is automatic
 *
 * TIERS, via the `SHOTS` env var:
 *   off    nothing at all, including deliberate shots — for a timing check, where the shutter
 *          itself distorts what is being measured
 *   key    deliberate shots + a frame for every FAILED check
 *   all    (default) ...plus a video of the whole run
 *
 * ⚠ `all` RECORDS RATHER THAN SCREENSHOTTING, AND THAT IS THE WHOLE LESSON. The first version of
 * this put automatic frames inside the interaction helpers — after a form fill, around a submit.
 * It took a 28-assertion verifier to **5 of 6**. A frame costs a few hundred milliseconds, and
 * callers race those helpers against the network:
 *
 *     await submitDrawer(page);                              // click
 *     await page.waitForResponse(pred, { timeout: 15000 });  // armed AFTER it
 *
 * A frame before the click spends a window the caller already opened; a frame after it swallows
 * the response the caller is about to wait for. **There is no safe side.** You cannot inject
 * latency into a shared helper without changing the semantics of every caller that races it, and
 * an observability mode that changes the result is not observability. Video is passive: Playwright
 * records at the context level, touches nothing in the page, and is better at the actual job —
 * which was always "let me watch what happened", not "give me four hundred stills".
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const TIERS = { off: 0, key: 1, all: 2 };
const TIER = TIERS[String(process.env.SHOTS || 'all').toLowerCase()] ?? TIERS.all;

/** The running verifier's own name — the folder its video lands in. */
const runnerName = () =>
  path.basename(process.argv[1] || 'run', '.js').replace(/[^a-z0-9-_]/gi, '-');

let ambientPage = null;
let ambientShots = null;
const openContexts = new Set();
const pending = [];

/** May a frame be taken at all? Callers ask; they do not interpret the tier. */
const enabled = () => TIER > TIERS.off;

/**
 * What to merge into `browser.newContext()` so this run is recorded.
 *
 * ⚠ CLEARS THE PREVIOUS RUN'S VIDEO. Playwright holds the file open for the life of the context,
 * so this is the one moment that is both after the last run and before this one starts recording.
 */
const contextOptions = () => {
  if (TIER < TIERS.all) return {};
  const dir = path.join(paths.shots, 'video', runnerName());
  fs.rmSync(dir, { recursive: true, force: true });
  return { recordVideo: { dir } };
};

/**
 * Point the camera at this run, and remember the context so its video can be flushed.
 *
 * ⚠ PLAYWRIGHT WRITES THE VIDEO ON `context.close()` AND NOWHERE ELSE. Measured in the repo this
 * came from: a run that let `withBrowser` close the browser instead left a **0-byte .webm** — a
 * file that exists and will not play, which is worse than no file because it reads as success.
 * `withBrowser` now flushes tracked contexts before closing the browser, so a verifier that never
 * closes its own context still gets a watchable recording.
 *
 * ⚠ LAST PAGE WINS. A verifier that opens a second session re-points the camera, which is right
 * for a failure inside that section and wrong for one after it hands back. Pass `{ page }` to
 * `snap` where the distinction matters — this is a convenience, not a guarantee.
 */
const adopt = (context, page, shots = null) => {
  if (context) {
    openContexts.add(context);
    context.on('close', () => openContexts.delete(context));
  }
  if (page) ambientPage = page;
  if (shots) ambientShots = shots;
  armCrashCamera();
};

/** Let a verifier's own `createShots(...)` own the catalogue, so automatic frames join it. */
const useShots = (shots) => { ambientShots = shots; };

/** Close anything still open, so every recording is flushed. Safe when there is nothing. */
const flush = async () => {
  for (const context of [...openContexts]) await context.close().catch(() => {});
  openContexts.clear();
};

/**
 * Capture without holding a shooter.
 *
 * ⚠ `require`d LAZILY. `shots.js` may adopt this module in turn, and a top-level require would be
 * a cycle. Deferring it also means a verifier that never takes a deliberate shot still gets a
 * catalogue the moment its first check fails.
 */
const snap = async (key, { page = ambientPage, note = '' } = {}) => {
  if (!enabled() || !page || page.isClosed?.()) return null;
  if (!ambientShots) {
    const { createShots } = require('./shots');
    ambientShots = createShots({ dir: paths.shots });
  }
  return ambientShots.take(page, key, { note }).catch(() => null);
};

/**
 * Photograph a failed check. Called by `report.check`.
 *
 * ⚠ FIRED, NOT AWAITED, and the promise is kept so `finish()` can drain it. `check` is synchronous
 * and called from everywhere; making it async to await a screenshot would rewrite every call site.
 * The cost is that the page can move on before the shutter — which is why the frame is worth
 * having anyway: a slightly late picture of the right screen beats no picture at all.
 */
const onFailure = (name, detail = '') => {
  const shot = snap(`failures/${name}`, { note: detail || 'a check failed here' });
  pending.push(shot);
  return shot;
};

/**
 * Wait for every queued frame to reach disk.
 *
 * ⚠ CALL THIS BEFORE `process.exit` AND BEFORE `browser.close()` — both kill an in-flight
 * screenshot, and the browser is the earlier deadline. Draining only before exit was measured to
 * still lose the frame, because the guard clause closed the browser first and the shot died with
 * the page. `report.finish()` and `withBrowser` both do this for you.
 */
const settle = async () => { await Promise.all(pending.splice(0)); };

/** Exit, but drain first. `process.exit` is immediate — nothing runs after it. */
const exit = async (code) => {
  await settle();
  process.exit(code);
};

/**
 * An array that photographs the page whenever something is pushed onto it.
 *
 * For the older shape of verifier that collects failure MESSAGES as it goes and prints them at the
 * end: `const failures = recording.failureLog()` is the whole change. It is a real array, so
 * `.length`, `.forEach` and any existing exit code behave exactly as before — only `push` gained a
 * side effect. The point is that the failure moment and the reporting moment are different, and by
 * the time such a verifier prints, the page may have navigated or closed.
 */
const failureLog = () => {
  const list = [];
  const push = Array.prototype.push.bind(list);
  list.push = (...items) => {
    for (const item of items) onFailure(String(item).replace(/\s+/g, ' ').slice(0, 70));
    return push(...items);
  };
  return list;
};

/**
 * Photograph the page when a run dies on an uncaught error.
 *
 * ⚠ THE LOUDEST FAILURE WAS THE ONE LEAVING NO EVIDENCE. A verifier that ends on an uncaught
 * timeout never reaches a check, never pushes a message, never calls exit — so every mechanism
 * above is bypassed and the folder stays empty. A crash is precisely the case where a human is
 * least able to guess what the screen looked like, which makes it the case where the frame is
 * worth most. Armed from `adopt`, so nothing has to remember it.
 */
let crashArmed = false;
const armCrashCamera = () => {
  if (crashArmed) return;
  crashArmed = true;
  const onCrash = async (err) => {
    const why = String(err?.message || err).split('\n')[0];
    await snap('crash', { note: why.slice(0, 120) });
    await settle();
    console.error(`\n  uncaught: ${why}\n  (a frame was saved — see ${paths.shots})\n`);
    process.exit(1);
  };
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
};

module.exports = {
  adopt,
  useShots,
  contextOptions,
  snap,
  onFailure,
  settle,
  exit,
  failureLog,
  armCrashCamera,
  flush,
  enabled,
  runnerName,
};
