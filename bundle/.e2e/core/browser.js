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
  } finally {
    // ⚠ FLUSH BEFORE CLOSING. Playwright writes a recorded video only when the CONTEXT closes;
    // closing the browser out from under an open one leaves a 0-byte .webm — a file that exists
    // and will not play. Most verifiers close their own context and this is a no-op for them.
    await recording.settle();
    await recording.flush();
    await browser.close().catch(() => {});
  }
};

module.exports = { withBrowser };
