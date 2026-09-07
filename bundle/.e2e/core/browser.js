/**
 * Browser lifecycle — owns teardown so a verifier only writes its own part.
 * A throw halfway through used to leave a headless chromium alive.
 *
 *   await withBrowser(async (browser) => { ... });
 *
 * `HEADED=1` shows the browser. `SLOWMO=250` slows every action to 250ms so a human can
 * actually follow what it is doing — headed alone runs at machine speed and a whole verifier
 * flashes past in a couple of seconds, which is no better than reading the log.
 */
const { chromium } = require('playwright');
const recording = require('./recording');

const withBrowser = async (fn, { headless = process.env.HEADED !== '1' } = {}) => {
  const slowMo = Number(process.env.SLOWMO || 0) || 0;
  const browser = await chromium.launch({ headless, slowMo });
  try {
    return await fn(browser);
  } catch (err) {
    // ⚠ HERE, NOT IN A `process.on('uncaughtException')`. A verifier that ends with its own
    // `.catch(...)` handles the error, so the uncaught handler never runs — and by the time that
    // catch executes, the `finally` below has closed the browser and there is no page left to
    // photograph. This is the only place that sees the throw while the screen still exists.
    // `.catch` on the capture itself: a camera that throws must never replace the error it was
    // called to photograph. Losing the real stack to a screenshot failure would be a cure worse
    // than the disease.
    await recording.captureThrow(err).catch(() => {});
    throw err;
  } finally {
    // ⚠ FLUSH BEFORE CLOSING. Playwright writes a recorded video only when the CONTEXT closes;
    // closing the browser out from under an open one leaves a 0-byte .webm — a file that exists
    // and will not play. Most verifiers close their own context and this is a no-op for them.
    await recording.drain().catch(() => {});
    await browser.close().catch(() => {});
  }
};

module.exports = { withBrowser };
