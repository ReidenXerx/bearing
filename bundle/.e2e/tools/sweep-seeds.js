/**
 * Delete everything a dead run left on the server.
 *
 *   node .e2e/tools/sweep-seeds.js          # list what is outstanding, then delete it
 *   node .e2e/tools/sweep-seeds.js --dry    # list only, touch nothing
 *
 * A clean run releases its own entries, so a quiet sweep ("nothing outstanding") is the normal
 * result. Anything listed here is litter from a run that was killed, crashed, or whose DELETE came
 * back non-2xx and was never noticed.
 *
 * ⚠ IT DELETES BY RECORDED URL, NEVER BY NAME. The predecessor matched a filename prefix and twice
 * reported "0 leftovers" with live fixtures on the account — a name-based sweeper is only as good
 * as the operator's memory of every prefix ever written. Deleting by recorded URL also means the
 * sweeper can never touch something the harness did not create: a URL it never recorded is a URL
 * it will not call.
 *
 * ⚠ IT NEEDS YOUR SESSION, WHICH IS THE ONE THING THIS FILE CANNOT KNOW. The DELETEs are issued
 * from inside the page so they carry exactly the credentials the app is using — which means
 * `applySession` in `core/session.js` has to be filled in first, like everything else that talks to
 * your API. Until then this prints what it would delete and says so, rather than failing obscurely.
 */
// ⚠ THE BROWSER IS REQUIRED LAZILY. Reading the ledger needs no browser, and the common answer is
// "nothing outstanding" — but a top-level `require('../core/browser')` pulls in Playwright, so on a
// fresh install this exited with a module-not-found stack trace instead of the one line it had to
// say. A tool whose commonest path is a no-op should not need the heaviest dependency to say so.
const seeds = require('../core/seeds');

const dry = process.argv.includes('--dry');

const run = async () => {
  const entries = seeds.outstanding();
  if (!entries.length) {
    console.log('\n  nothing outstanding — every run released what it created\n');
    return 0;
  }

  console.log(`\n  ${entries.length} object(s) outstanding from ${new Set(entries.map((e) => e.check)).size} run(s):\n`);
  entries.forEach((e) => console.log(`    ${String(e.check).padEnd(24)} ${e.url}${e.label ? `  "${e.label}"` : ''}   ${e.at}`));

  if (dry) {
    console.log('\n  --dry: nothing deleted\n');
    return 0;
  }

  const { withBrowser } = require('../core/browser');
  const { BASE, loadStorage, applySession } = require('../core/session');

  let failures = 0;
  await withBrowser(async (browser) => {
    const context = await browser.newContext();
    try {
      applySession(context, { storage: loadStorage() });
    } catch (err) {
      // Either the session export is missing or `applySession` is still a stub. Both are ordinary
      // states for a harness that has not been finished yet, and neither should lose the ledger.
      console.log(`\n  cannot sweep: ${err.message.split('\n')[0]}`);
      console.log('  The ledger is kept — nothing was forgotten. Re-run once a session is available.\n');
      failures = entries.length;
      await context.close().catch(() => {});
      return;
    }
    const page = await context.newPage();
    try {
      // The page must be ON the app before its stored credentials are usable.
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      console.log('');
      for (const entry of entries) {
        const status = await page
          .evaluate(async (url) => {
            const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
            return res.status;
          }, entry.url)
          .catch(() => 0);
        // ⚠ A 404 IS SUCCESS. The object is not there, which is the whole point — treating it as a
        // failure keeps the entry forever and every later sweep re-reports the same dead URL.
        if ((status >= 200 && status < 300) || status === 404) {
          seeds.forget(entry);
          console.log(`    removed  ${entry.url}${status === 404 ? '  (was already gone)' : ''}`);
        } else {
          failures += 1;
          console.log(`    FAILED   ${entry.url} — HTTP ${status}, still on the server`);
        }
      }
    } finally {
      await context.close().catch(() => {});
    }
  });

  console.log(failures ? `\n  ${failures} could not be deleted — remove by hand\n` : '\n  swept clean\n');
  return failures ? 1 : 0;
};

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n  sweep failed: ${err.message.split('\n')[0]}\n`);
    process.exit(1);
  });
