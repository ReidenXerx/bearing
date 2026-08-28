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

module.exports = { ROOT, REPO, storageFile, shots: path.join(ROOT, 'shots') };
