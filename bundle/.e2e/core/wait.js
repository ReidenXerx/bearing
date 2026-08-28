/**
 * Waiting for the THING, never for a timer.
 *
 * ## The failure this exists to stop
 *
 * A lookup probe slept 1200ms after typing, counted the dropdown, got 0, and reported "0 options"
 * for every query — on a lookup that renders results perfectly a moment later. It then "proved"
 * that scrolling loads more results, because by the time it scrolled, the FIRST load had finally
 * landed and 10 options appeared. Both readings were wrong, both looked like data, and the run
 * exited green.
 *
 * A fixed sleep encodes a guess about latency. When the guess is short you get a false negative
 * that reads as a broken feature; when it is long you pay it on every run forever. Poll for the
 * condition and report how long it took, so slow is visible as slow rather than as broken.
 */

/**
 * Poll `read()` until `done(value)` is true.
 *
 * Returns `{ ok, value, ms, polls }` — `ok:false` means it never settled, and
 * `value` is then the LAST reading, which is the useful diagnostic.
 */
const until = async (read, done, { timeout = 30000, interval = 150 } = {}) => {
  const started = Date.now();
  let value;
  let polls = 0;
  while (Date.now() - started < timeout) {
    value = await read();
    polls++;
    if (done(value)) return { ok: true, value, ms: Date.now() - started, polls };
    await new Promise(r => setTimeout(r, interval));
  }
  return { ok: false, value, ms: Date.now() - started, polls };
};

/** Wait for a locator's count to satisfy `done`. */
const untilCount = (locator, done, opts) => until(() => locator.count(), done, opts);

/** Wait for at least `n` matches. */
const untilAtLeast = (locator, n = 1, opts) => untilCount(locator, c => c >= n, opts);

/**
 * Wait for a count to STOP changing — the honest way to measure "how many
 * results are there", when results stream in.
 *
 * `stableFor` is how long the value must hold. Returns the settled count.
 */
const untilStable = async (locator, { stableFor = 900, timeout = 30000, interval = 150 } = {}) => {
  const started = Date.now();
  let last = -1;
  let lastChanged = Date.now();
  let polls = 0;
  while (Date.now() - started < timeout) {
    const c = await locator.count();
    polls++;
    if (c !== last) {
      last = c;
      lastChanged = Date.now();
    } else if (Date.now() - lastChanged >= stableFor) {
      return { ok: true, value: c, ms: Date.now() - started, polls };
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return { ok: false, value: last, ms: Date.now() - started, polls };
};

module.exports = { until, untilCount, untilAtLeast, untilStable };
