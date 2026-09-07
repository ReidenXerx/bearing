/**
 * A ledger of everything a run created on the server, written as it is created.
 *
 * ⚠ WHY A LEDGER AND NOT A NAMING CONVENTION. Leftover fixtures are the most expensive failure a
 * harness has, because they do not fail the run that made them — they fail the NEXT one, in a way
 * that looks like a product defect. In the repo this came from, one abandoned custom-field
 * definition made a required field empty on every row, which correctly disabled a Register button,
 * and the check that found it reported a real-looking bug in the app.
 *
 * The defence used to be a filename prefix and a tool that grepped for it. It reported **"0
 * leftovers" while live fixtures sat on the account, twice** — once because the prefix list was
 * missing an entry someone added later, once because a different tool used a different prefix. A
 * convention only protects you against the cases somebody remembered.
 *
 * So: record what was actually created, at the moment it is created, and sweep by that record.
 * There is nothing to remember and nothing to keep in sync.
 *
 * ⚠ WRITTEN SYNCHRONOUSLY, ON PURPOSE. The leak that started this was a Ctrl-C. A ledger that
 * batches its writes is empty in exactly the case it exists for, so every `track()` hits the disk
 * before the call returns.
 *
 * ⚠ THE LEDGER STORES THE DELETE URL, NOT AN ID. An earlier version stored `{kind, id}` and left
 * the sweeper to reassemble a path, which meant the sweeper had to know the API's shape — and a
 * harness module that knows your API is a module you have to edit before it works. A URL the
 * browser already used is a URL the browser can use again.
 *
 * Entries are released on a successful DELETE, so a clean run leaves nothing behind and the sweeper
 * has nothing to do. **What survives on disk IS the leak.**
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const DIR = path.join(paths.ROOT, '.seeds');

const runnerName = () =>
  path.basename(process.argv[1] || 'run', '.js').replace(/[^a-z0-9-_]/gi, '-');

const ledgerPath = () => path.join(DIR, `${runnerName()}-${process.pid}.json`);

const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const write = (file, entries) => {
  if (!entries.length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
};

/**
 * Record that this run created something the server will keep.
 *
 * @param {string} url    The URL that would DELETE it.
 * @param {string} [label] A human hint for the sweep report — a name, a title.
 */
const track = (url, label) => {
  if (!url) return;
  const file = ledgerPath();
  const entries = read(file) || [];
  if (entries.some((e) => e.url === url)) return;
  entries.push({ url, label: label || null, check: runnerName(), at: new Date().toISOString() });
  write(file, entries);
};

/** Record that it is gone, so a clean run leaves an empty folder. */
const release = (url) => {
  const file = ledgerPath();
  const entries = read(file);
  if (!entries) return;
  write(file, entries.filter((e) => e.url !== url));
};

/** Every outstanding entry across every ledger, including ones from runs that died. */
const outstanding = () => {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => (read(path.join(DIR, f)) || []).map((e) => ({ ...e, ledger: path.join(DIR, f) })));
};

/** Drop one entry from whichever ledger holds it — used by the sweeper after a successful delete. */
const forget = (entry) => {
  const entries = read(entry.ledger);
  if (!entries) return;
  write(entry.ledger, entries.filter((e) => e.url !== entry.url));
};

/**
 * Ledger everything the PAGE creates, however it was created.
 *
 * ⚠ WATCH THE NETWORK, NOT YOUR OWN HELPER. A first version hooked the harness's API caller, which
 * missed every fixture the APP created — a verifier that builds its fixtures by driving the UI
 * (fill the form, click Save) never touches that helper, so the ledger saw nothing and reported
 * "nothing outstanding" while three definitions sat on the account. Responses are where every
 * origin converges: whoever issued the call, the fixture was created by an HTTP request this
 * browser made.
 *
 * `isCreate` decides what counts, because only your app knows. The default treats a 2xx `POST` to a
 * collection that answers with an `id` as a creation, and derives the DELETE URL as `<url>/<id>` —
 * which is right for a REST API and wrong for plenty of others, so pass your own when it is.
 *
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {(res, body) => (string|null)} [opts.isCreate] Return the DELETE URL, or null to ignore.
 * @param {(res) => (string|null)} [opts.isDelete] Return the URL that was deleted, or null.
 */
const watchPage = (page, { isCreate = null, isDelete = null } = {}) => {
  const defaultCreate = (res, body) =>
    (res.request().method() === 'POST' && body?.id
      ? `${String(res.url()).split('?')[0].replace(/\/+$/, '')}/${body.id}`
      : null);
  const defaultDelete = (res) =>
    (res.request().method() === 'DELETE' ? String(res.url()).split('?')[0] : null);

  page.on('response', async (res) => {
    const method = res.request().method();
    if (method !== 'POST' && method !== 'DELETE') return;
    if (res.status() < 200 || res.status() >= 300) return;

    if (method === 'DELETE') {
      const gone = (isDelete || defaultDelete)(res);
      if (gone) release(gone);
      return;
    }
    // A body read races teardown; a failed read must not look like an empty response.
    const body = await res.json().catch(() => null);
    const url = (isCreate || defaultCreate)(res, body);
    if (url) track(url, body?.name || body?.title || null);
  });
};

module.exports = { track, release, outstanding, forget, watchPage, DIR };
