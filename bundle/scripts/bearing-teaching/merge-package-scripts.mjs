#!/usr/bin/env node
/**
 * Single source of truth for GitNexus npm scripts (re-exports script-gates).
 * Usage:
 *   node scripts/bearing-teaching/merge-package-scripts.mjs --write
 *   node scripts/bearing-teaching/merge-package-scripts.mjs --snippet
 */
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

function main() {
  const args = new Set(process.argv.slice(2));
  const pkgPath = path.join(ROOT, 'package.json');

  if (args.has('--snippet')) {
    process.stdout.write(JSON.stringify({ scripts: buildGatedScripts() }, null, 2) + '\n');
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
    });
    console.log(
      `GitNexus npm scripts: ${stats.added} added, ${stats.updated} updated, ${stats.unchanged} unchanged (${stats.total} total incl. gate hints)`
    );
    return;
  }

  console.error('Usage: merge-package-scripts.mjs --write | --snippet');
  process.exit(2);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main();
}
