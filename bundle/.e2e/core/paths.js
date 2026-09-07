/**
 * Where things live, resolved once.
 *
 * Every script used to build its own `path.join(__dirname, 'shots')`, which quietly encoded how
 * deep in the tree that script happened to sit. Moving a file then broke it in a way that only
 * showed up at write time. The kit root is resolved here and nowhere else, so a script can move
 * between folders without touching a path.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');

/** A session export by file name, or an explicit path passed straight through. */
const storageFile = (name = 'storage.json') =>
  path.isAbsolute(name)
    ? name
    : name.includes('/')
      ? path.resolve(process.cwd(), name)
      : path.join(ROOT, name);

/**
 * The running verifier's own name — the folder its artefacts land in.
 *
 * ⚠ ONE DEFINITION. `recording.js` and `seeds.js` each grew an identical private copy, differing
 * only in a fallback string, which means a run's video could land in one folder and its seed ledger
 * in another. Both already import from here.
 */
const runnerName = () =>
  path.basename(process.argv[1] || 'run', '.js').replace(/[^a-z0-9-_]/gi, '-');

module.exports = { ROOT, REPO, runnerName, storageFile, shots: path.join(ROOT, 'shots') };
