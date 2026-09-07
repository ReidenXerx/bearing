/**
 * A ledger of what a run created on the server, so litter is swept by record rather than by memory.
 *
 * ⚠ WHY A LEDGER AND NOT A NAMING CONVENTION. Leftover fixtures do not fail the run that made them.
 * They fail the NEXT one, and they fail it in a way that looks like a product defect: one abandoned
 * definition left a required field empty on every row, which correctly disabled a button, and the
 * check that met it reported a plausible bug in the app. The old defence was a filename prefix and
 * a tool that grepped for it — which reported **"0 leftovers" with live fixtures on the account,
 * twice**, because a convention only protects the cases somebody remembered.
 *
 * ⚠ WRITTEN SYNCHRONOUSLY AND ATOMICALLY. The leak that started this was a Ctrl-C, so a ledger that
 * batches its writes is empty in exactly the case it exists for. It is also written to a temp file
 * and renamed: a crash landing inside a `writeFileSync` truncates the JSON, and the next `read`
 * would silently start from `[]` and overwrite — reproducing the "0 leftovers with live fixtures"
 * failure inside the very module built to end it.
 *
 * ⚠ THE LEDGER STORES A DELETE URL, NOT AN ID, so the sweeper needs to know nothing about your API.
 *
 * ## What it refuses to track, and why each refusal is load-bearing
 *
 * This file decides what a destructive tool will later delete, so every default errs toward
 * under-tracking. A missed fixture is visible litter; an over-tracked one is an irreversible delete.
 *
 *  - **Only `201 Created`.** A `200` on a POST is routinely an idempotent create or an upsert —
 *    post a vendor that already exists, get `200 {id: <existing>}` — and deleting that destroys a
 *    record with a history the run did not make.
 *  - **Only the page's own origin.** `res.url()` is every host the page talked to. A payments app
 *    POSTs to Stripe (`{id: "cus_…"}`) and Sentry (`{id: "<event>"}`) on ordinary loads; both would
 *    enter the ledger, and `DELETE /v1/customers/{id}` is a real route.
 *  - **Nothing that was intercepted.** `route.fulfill()` produces a real `response` event, so a
 *    verifier using `blockWrites` — which this kit's own README recommends — would ledger a phantom
 *    `<url>/<respond.id>` for an object that was never created, and the sweeper would later delete a
 *    REAL object of that id. Measured: `res.serverAddr()` is `null` for a fulfilled response and an
 *    address for a served one, which is a structural tell rather than a shared registry to keep in
 *    sync.
 *  - **Nothing matching `NON_WRITE_POSTS`.** `http.js` already knows a token refresh is not a write.
 *
 * A clean run releases its own entries, so **what survives on disk IS the leak**.
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { NON_WRITE_POSTS } = require('./http');

const DIR = path.join(paths.ROOT, '.seeds');
const { runnerName } = paths;

const ledgerPath = () => path.join(DIR, `${runnerName()}-${process.pid}.json`);

/**
 * One spelling of a URL, used by every read and every write.
 *
 * ⚠ WITHOUT THIS, ENTRIES ARE NEVER RELEASED. The create path stripped a trailing slash and the
 * delete path did not, so an app on a router that appends slashes (`DELETE /things/42/`) never
 * matched its own ledger entry (`/things/42`) — and the file's headline promise, "what survives on
 * disk is the leak", degrades into noise the operator learns to ignore.
 */
const normalize = (url) => {
  try {
    const u = new URL(String(url));
    u.search = '';
    u.hash = '';
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return String(url).split('?')[0].replace(/\/+$/, '');
  }
};

/** `{entries, unreadable}` — an unparseable ledger must never read as "nothing outstanding". */
const read = (file) => {
  if (!fs.existsSync(file)) return { entries: [], unreadable: false };
  try {
    return { entries: JSON.parse(fs.readFileSync(file, 'utf8')), unreadable: false };
  } catch {
    return { entries: [], unreadable: true };
  }
};

const write = (file, entries) => {
  if (!entries.length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`);
  fs.renameSync(tmp, file); // atomic: a crash leaves either the old file or the new one
};

/**
 * Record that this run created something the server will keep.
 *
 * @param {string} url     The URL that would DELETE it.
 * @param {string} [label] A hint for the sweep report. TRUNCATED, and response-derived — a `name`
 *   from a card or supplier response is exactly the sort of string that should not grow unbounded
 *   in a file, or in the CI log that echoes it.
 */
const track = (url, label) => {
  if (!url) return;
  const key = normalize(url);
  const file = ledgerPath();
  const { entries } = read(file);
  if (entries.some((e) => e.url === key)) return;
  entries.push({
    url: key,
    label: label ? String(label).slice(0, 60) : null,
    check: runnerName(),
    at: new Date().toISOString(),
  });
  write(file, entries);
};

/** Record that it is gone, so a clean run leaves an empty folder. */
const release = (url) => {
  const key = normalize(url);
  const file = ledgerPath();
  const { entries } = read(file);
  if (!entries.length) return;
  write(file, entries.filter((e) => e.url !== key));
};

/** Every outstanding entry, with the ledger that holds it and the pid that wrote it. */
const outstanding = () => {
  if (!fs.existsSync(DIR)) return { entries: [], unreadable: [] };
  const unreadable = [];
  const entries = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const ledger = path.join(DIR, f);
      const got = read(ledger);
      if (got.unreadable) {
        unreadable.push(ledger);
        return [];
      }
      const pid = Number(/-(\d+)\.json$/.exec(f)?.[1]) || null;
      return got.entries.map((e) => ({ ...e, ledger, pid }));
    });
  return { entries, unreadable };
};

/** Drop one entry from whichever ledger holds it. */
const forget = (entry) => {
  const { entries } = read(entry.ledger);
  if (!entries.length) return;
  write(entry.ledger, entries.filter((e) => e.url !== entry.url));
};

const inFlight = new Set();

/**
 * Ledger everything the PAGE creates, however it was created.
 *
 * ⚠ WATCH THE NETWORK, NOT YOUR OWN HELPER. A first version hooked the harness's API caller and
 * missed every fixture the APP created — a verifier that builds its fixtures by driving the UI
 * never touches that helper, so the ledger saw nothing while three definitions sat on the account.
 * Responses are where every origin converges.
 *
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {(res, body) => (string|null)} [opts.isCreate] Return the DELETE URL, or null to ignore.
 *   Override this the moment your API creates with a `200`, nests the id, or deletes via a
 *   different shape — the default is deliberately narrow.
 * @param {(res) => (string|null)} [opts.isDelete] Return the URL that was deleted, or null.
 * @param {string[]} [opts.origins] Origins allowed into the ledger. Defaults to the page's own
 *   origin at the time each response arrives.
 */
const watchPage = (page, { isCreate = null, isDelete = null, origins = null } = {}) => {
  const allowed = (url) => {
    try {
      const origin = new URL(url).origin;
      if (origins) return origins.includes(origin);
      const here = new URL(page.url()).origin;
      return origin === here;
    } catch {
      return false;
    }
  };

  const defaultCreate = (res, body) =>
    (res.status() === 201 && body?.id != null
      ? `${normalize(res.url())}/${body.id}`
      : null);
  const defaultDelete = (res) => (res.request().method() === 'DELETE' ? res.url() : null);

  page.on('response', (res) => {
    // ⚠ THE HANDLER'S OWN PROMISE IS TRACKED, so `settle()` can wait for it. `page.on` discards the
    // return value of an async listener, so the work is wrapped and the wrapper is what is held.
    const work = (async () => {
      const method = res.request().method();
      if (method !== 'POST' && method !== 'DELETE') return;
      if (res.status() < 200 || res.status() >= 300) return;
      if (!allowed(res.url())) return;

      if (method === 'DELETE') {
        const gone = (isDelete || defaultDelete)(res);
        if (gone) release(gone);
        return;
      }

      if (NON_WRITE_POSTS.test(res.url())) return;
      // An intercepted response never reached a server, so nothing was created to delete.
      const served = await res.serverAddr().catch(() => null);
      if (!served) return;

      const body = await res.json().catch(() => null);
      const url = (isCreate || defaultCreate)(res, body);
      if (url) track(url, body?.name || body?.title || null);
    })().catch((err) => {
      // ⚠ CAUGHT, ALWAYS. `track` does synchronous filesystem I/O, and on a read-only or full CI
      // filesystem a throw inside an async listener becomes an unhandled rejection that kills the
      // run — a bookkeeping failure taking down the verifier it exists to serve.
      console.warn(`  ! seeds: could not ledger a response — ${String(err?.message || err).slice(0, 80)}`);
    });
    inFlight.add(work);
    work.finally(() => inFlight.delete(work));
  });
};

/**
 * Wait for the response handlers still running.
 *
 * A create landing near teardown is ledgered by an async handler; without this the browser closes
 * first and the very fixture most likely to leak is the one least likely to be recorded.
 */
const settle = async () => {
  await Promise.allSettled([...inFlight]);
};

module.exports = { track, release, outstanding, forget, watchPage, settle, normalize, DIR };
