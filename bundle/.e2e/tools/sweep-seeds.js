/**
 * Show — and only on request, delete — what a dead run left on the server.
 *
 *   node .e2e/tools/sweep-seeds.js              # list what is outstanding. Deletes NOTHING.
 *   node .e2e/tools/sweep-seeds.js --delete     # actually delete it
 *   node .e2e/tools/sweep-seeds.js --delete --all   # ...including ledgers whose run is still alive
 *   node .e2e/tools/sweep-seeds.js --forget <url>   # drop an entry that can never be deleted
 *
 * A clean run releases its own entries, so "nothing outstanding" is the normal answer. Anything
 * listed here is litter from a run that was killed, crashed, or whose DELETE came back non-2xx.
 *
 * ⚠ LISTING IS THE DEFAULT AND DELETING IS OPT-IN. For a tool whose job is issuing DELETEs against
 * a real server with a real session, the reverse is not a convenience — it is a loaded gun with the
 * safety off. An earlier version deleted on the bare command and made `--dry` the opt-in.
 *
 * ⚠ IT REFUSES TO RUN AGAINST PRODUCTION unless `ALLOW_PROD=1`. `core/env.js` exists for exactly
 * this and the first version of this file did not call it — so the one tool in the kit that
 * destroys data was the only one skipping the guard every read-only verifier honours.
 *
 * ⚠ IT DELETES BY RECORDED URL AND ONLY WITHIN ALLOWED ORIGINS. A URL it never recorded is a URL it
 * will not call, and a host outside the app's own origin is refused even if something managed to
 * record it — the ledger already filters, and this is the second lock on the same door.
 */
const seeds = require('../core/seeds');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);

/** Is the process that wrote this ledger still running? */
const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const run = async () => {
  const forgetUrl = valueOf('--forget');
  if (forgetUrl) {
    const { entries } = seeds.outstanding();
    const hit = entries.find((e) => e.url === seeds.normalize(forgetUrl));
    if (!hit) {
      console.log(`\n  no ledger entry for ${forgetUrl}\n`);
      return 1;
    }
    seeds.forget(hit);
    console.log(`\n  forgotten (the object, if any, is still on the server): ${hit.url}\n`);
    return 0;
  }

  const { entries, unreadable } = seeds.outstanding();
  // ⚠ AN UNPARSEABLE LEDGER IS LOUD. Reading it as zero is the "0 leftovers with live fixtures"
  // failure the ledger was built to end, reproduced one level up.
  unreadable.forEach((f) => console.log(`  ! ${f} could not be parsed — entries in it are NOT listed`));

  if (!entries.length) {
    console.log(unreadable.length ? '' : '\n  nothing outstanding — every run released what it created\n');
    return unreadable.length ? 1 : 0;
  }

  const live = entries.filter((e) => alive(e.pid));
  const sweepable = has('--all') ? entries : entries.filter((e) => !alive(e.pid));

  console.log(`\n  ${entries.length} object(s) outstanding:\n`);
  entries.forEach((e) => {
    const flag = alive(e.pid) ? '  [run still alive]' : '';
    console.log(`    ${String(e.check).padEnd(22)} ${e.url}${e.label ? `  "${e.label}"` : ''}${flag}`);
    console.log(`      ${e.at}   ledger: ${e.ledger}`);
  });

  if (live.length && !has('--all')) {
    // Sweeping a running verifier's fixtures makes it report plausible product defects — precisely
    // the failure this module exists to end.
    console.log(`\n  ${live.length} belong(s) to a process that is still running and will be skipped (--all overrides).`);
  }

  if (!has('--delete')) {
    console.log('\n  listing only — pass --delete to remove these.\n');
    // ⚠ An unreadable ledger is a non-zero exit even here. "I cannot account for what is out there"
    // is not the same answer as "nothing is out there", and only one of them is green.
    return unreadable.length ? 1 : 0;
  }
  if (!sweepable.length) {
    console.log('\n  nothing to delete.\n');
    return 0;
  }

  const { withBrowser } = require('../core/browser');
  const { BASE, loadStorage, applySession, authHeaders } = require('../core/session');
  const { watchApiEnv, guardEnv } = require('../core/env');

  let failures = 0;
  await withBrowser(async (browser) => {
    const context = await browser.newContext();
    let page;
    try {
      applySession(context, { storage: loadStorage() });
      page = await context.newPage();
    } catch (err) {
      console.log(`\n  cannot sweep: ${String(err.message).split('\n')[0]}`);
      console.log('  The ledger is kept — nothing was forgotten.\n');
      failures = sweepable.length;
      await context.close().catch(() => {});
      return;
    }

    const seen = watchApiEnv(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const verdict = await guardEnv(seen, {});
    if (!verdict.ok) {
      console.log(`\n  REFUSING TO DELETE — ${verdict.reason}\n`);
      failures = sweepable.length;
      await context.close().catch(() => {});
      return;
    }
    console.log(`\n  environment: ${verdict.env}${verdict.reason ? ` (${verdict.reason})` : ''}`);

    const allowed = new URL(BASE).origin;
    const headers = typeof authHeaders === 'function' ? (authHeaders(loadStorage()) || {}) : {};

    for (const entry of sweepable) {
      if (new URL(entry.url).origin !== allowed) {
        failures += 1;
        console.log(`    REFUSED  ${entry.url} — outside ${allowed}; delete it by hand if you meant it`);
        continue;
      }
      const outcome = await page
        .evaluate(async ({ url, headers: h }) => {
          try {
            const res = await fetch(url, { method: 'DELETE', credentials: 'include', headers: h, redirect: 'manual' });
            return { status: res.status };
          } catch (err) {
            return { status: 0, error: String(err && err.message) };
          }
        }, { url: entry.url, headers })
        .catch((err) => ({ status: 0, error: String(err.message).split('\n')[0] }));

      // ⚠ A 404 IS SUCCESS. The object is not there, which is the point — treating it as a failure
      // keeps the entry forever and every later sweep re-reports the same dead URL.
      if ((outcome.status >= 200 && outcome.status < 300) || outcome.status === 404) {
        seeds.forget(entry);
        console.log(`    removed  ${entry.url}${outcome.status === 404 ? '  (was already gone)' : ''}`);
      } else {
        failures += 1;
        const why = outcome.status ? `HTTP ${outcome.status}` : `no response — ${outcome.error}`;
        console.log(`    FAILED   ${entry.url} — ${why}`);
      }
    }
    await context.close().catch(() => {});
  });

  failures += unreadable.length;
  if (failures) {
    console.log(`\n  ${failures} could not be deleted. Remove by hand, or drop the record with`);
    console.log('  node .e2e/tools/sweep-seeds.js --forget <url>\n');
  } else {
    console.log('\n  swept clean\n');
  }
  return failures ? 1 : 0;
};

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n  sweep failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
