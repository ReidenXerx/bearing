#!/usr/bin/env node
/**
 * Single source of truth for GitNexus npm scripts (re-exports script-gates).
 * Usage:
 *   node scripts/bearing-teaching/merge-package-scripts.mjs --write
 *   node scripts/bearing-teaching/merge-package-scripts.mjs --snippet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildGatedScripts,
  mergeIntoPackageJson,
} from './script-gates.mjs';

export {
  GITNEXUS_SCRIPT_GATES,
  GITNEXUS_NPM_SCRIPTS,
  buildGatedScripts,
  flatGitnexusScripts,
  allManagedScriptKeys,
  mergeGitnexusScripts,
  mergeIntoPackageJson,
  findGate,
  gateCommentKey,
} from './script-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/**
 * WHICH gitnexus the generated scripts should call.
 *
 * This helper runs from `bearing-setup.sh`, which is step 7 of an install — AFTER kit.mjs has
 * already written these scripts with the operator's chosen binary at step 5. Rebuilding them from
 * the bare default therefore UNDID that choice on every single install: the manifest recorded
 * `gitnexus` while all 16 commands went back to `npx gitnexus@latest`, so `bearing:refresh`
 * rebuilt the index with the published analyzer instead of the installed one.
 *
 * `.bearing/lib/gitnexus-cmd.mjs` already resolves this correctly (recorded → installed → npx);
 * the bug was simply not asking it. Falling back to `undefined` keeps the stock default when the
 * lib is absent, so this can never be the thing that breaks an install.
 */
async function resolveGitnexusCmd() {
  try {
    const mod = await import(
      pathToFileURL(path.join(ROOT, '.bearing/lib/gitnexus-cmd.mjs')).href
    );
    return mod.gitnexusCmd(ROOT);
  } catch {
    return undefined;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const pkgPath = path.join(ROOT, 'package.json');

  const gitnexusCmd = await resolveGitnexusCmd();

  if (args.has('--snippet')) {
    // The snippet is what a user copies into their own package.json, so it has to name the same
    // binary the real install would have used.
    process.stdout.write(
      JSON.stringify({ scripts: buildGatedScripts({ gitnexusCmd }) }, null, 2) + '\n',
    );
    return;
  }

  if (args.has('--write')) {
    const repoNameIdx = process.argv.indexOf('--repo-name');
    const repoName =
      process.env.GITNEXUS_REPO_NAME ||
      (repoNameIdx >= 0 ? process.argv[repoNameIdx + 1] : undefined);
    const stats = mergeIntoPackageJson(pkgPath, {
      createIfMissing: true,
      repoName: repoName || undefined,
      gitnexusCmd,
    });
    console.log(
      `GitNexus npm scripts: ${stats.added} added, ${stats.updated} updated, ${stats.unchanged} unchanged (${stats.total} total incl. gate hints)` +
        (gitnexusCmd ? ` — via \`${gitnexusCmd}\`` : '')
    );
    return;
  }

  console.error('Usage: merge-package-scripts.mjs --write | --snippet');
  process.exit(2);
}

// realpath both sides: comparing unresolved paths makes this a silent no-op whenever the repo is
// reached through a symlink (on macOS /tmp alone is enough), and a script that exits 0 having done
// nothing is the hardest kind of failure to notice. Same fix as lib/kit.mjs.
const isMain = (() => {
  if (!process.argv[1]) return false;
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(fileURLToPath(import.meta.url)) === real(process.argv[1]);
})();
if (isMain) {
  main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
