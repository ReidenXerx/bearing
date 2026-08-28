#!/usr/bin/env node
/**
 * The worked example. Copy this shape for every verifier you write.
 *
 *   node .e2e/verify/smoke.js                      # against BASE, default localhost:3000
 *   BASE=https://staging.example.com node .e2e/verify/smoke.js
 *   HEADED=1 SLOWMO=250 node .e2e/verify/smoke.js  # watch it
 *
 * It deliberately needs NO session, so it runs the moment the harness is installed and proves the
 * wiring end to end before you have written anything app-specific.
 *
 * The shape that matters:
 *   - one `createReport`, one `finish()` — the exit code is the whole point
 *   - `check` for something that ran, `skip` for something that could not, and never a `check`
 *     that is really a skip in disguise
 *   - poll with `until`, never `waitForTimeout`
 *   - a shot per view, keyed by what it IS
 */
const { withBrowser } = require('../core/browser');
const { createReport } = require('../core/report');
const { createShots } = require('../core/shots');
const { until } = require('../core/wait');
const paths = require('../core/paths');

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');

withBrowser(async (browser) => {
  const report = createReport(`smoke — ${BASE}`);
  const shots = createShots({ dir: paths.shots });

  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url()}`));

  let response;
  try {
    response = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (err) {
    // A verifier that cannot reach the app has not found a bug — it has failed to run. Say which.
    report.check('the app is reachable', false, `${err.message.split('\n')[0]} — is it running?`);
    report.finish();
    return;
  }

  report.check('the app is reachable', Boolean(response), `HTTP ${response?.status()}`);
  report.check('it did not serve an error page', (response?.status() ?? 500) < 400, `HTTP ${response?.status()}`);

  // Poll for the thing, do not sleep and hope.
  const painted = await until(
    () => page.evaluate(() => document.body?.innerText?.trim().length ?? 0),
    (n) => n > 0,
    { timeout: 15000 },
  );
  report.check('something rendered', painted.ok, `${painted.value} chars after ${painted.ms}ms`);

  const title = await page.title();
  report.check('the page has a title', Boolean(title.trim()), JSON.stringify(title));

  report.check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  report.check('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  const shot = await shots.take(page, 'smoke/landing', { note: 'the first screen, unauthenticated' });
  report.check('a shot was captured', Boolean(shot.path), shot.path);
  if (shot.warning) console.log(`\n  ! ${shot.warning}`);

  report.finish();
}).catch((err) => {
  console.error(`\nsmoke: the harness itself failed — ${err.message}`);
  process.exit(1);
});
