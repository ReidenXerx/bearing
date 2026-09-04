import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_ROOT, substituteRepoName, isTextCandidate } from './kit-shared.mjs';
import { SKILLS_STORE } from './constants.mjs';
import { skillLinkDirs } from './adapters/index.mjs';

/** @param {string} dir */
export function listSkillNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

/**
 * Copy canonical flat skills into the target store (substitute repo name in SKILL.md).
 * @param {string} absTarget
 * @param {string} repoName
 */
export function materializeSkillsStore(absTarget, repoName, keep = () => true) {
  const srcRoot = path.join(BUNDLE_ROOT, 'skills');
  const store = path.join(absTarget, SKILLS_STORE);
  if (!fs.existsSync(srcRoot)) {
    throw new Error('Missing bundle/skills/');
  }
  fs.rmSync(store, { recursive: true, force: true });
  fs.mkdirSync(store, { recursive: true });

  for (const name of listSkillNames(srcRoot)) {
    if (!keep(name)) continue; // feature axis — an intel-only install skips the graph task-skills
    copySkillTree(path.join(srcRoot, name), path.join(store, name), repoName);
  }
  return listSkillNames(store);
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string} repoName
 */
function copySkillTree(src, dest, repoName) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copySkillTree(s, d, repoName);
    else if (isTextCandidate(s)) {
      fs.writeFileSync(d, substituteRepoName(fs.readFileSync(s, 'utf8'), repoName));
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * @param {string} linkPath
 * @param {string} targetPath
 */
export function replaceWithSymlink(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink() || st.isDirectory()) fs.rmSync(linkPath, { recursive: true, force: true });
    else fs.unlinkSync(linkPath);
  } catch {
    /* absent */
  }
  let rel = path.relative(path.dirname(linkPath), targetPath);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  fs.symlinkSync(rel, linkPath, 'dir');
}

/**
 * @param {string} absTarget
 * @param {import('./constants.mjs').Runtime} runtime
 */
export function linkSkillsForRuntime(absTarget, runtime) {
  const store = path.join(absTarget, SKILLS_STORE);
  const names = listSkillNames(store);
  if (!names.length) return [];

  for (const dir of skillLinkDirs(runtime)) {
    const root = path.join(absTarget, dir);
    fs.mkdirSync(root, { recursive: true });
    for (const name of names) {
      replaceWithSymlink(path.join(root, name), path.join(store, name));
    }
  }

  return names;
}

/** @param {string} absTarget @param {import('./constants.mjs').Runtime} runtime */
export function unlinkSkillLinks(absTarget, runtime) {
  const store = path.join(absTarget, SKILLS_STORE);
  const names = listSkillNames(store);
  // RETIRED link dirs are swept too, whatever the recorded runtime says. `skillLinkDirs` answers
  // "where do I link skills for this runtime", and once Cursor stopped being a runtime it stopped
  // naming `.cursor/skills` — so uninstalling a Cursor-era install left ~23 symlinks pointing at
  // the `.bearing/skills` store that same uninstall had just deleted. 1.1.6 uninstalling its own
  // install left the repo pristine; this is a regression the removal introduced, and dangling
  // links are not inert — a recursive mkdir through one throws ENOENT (NS-1).
  for (const dir of [...skillLinkDirs(runtime), ".cursor/skills"]) {
    for (const name of names) {
      try {
        fs.rmSync(path.join(absTarget, dir, name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    // The link dir itself is ours — we created .claude/skills/ and .agents/skills/ purely to hold
    // these symlinks. Removing only the links left an empty directory in every uninstalled repo,
    // and uninstall's own pruning starts at .claude/ (still holding settings.json) so it never
    // descended this far. rmdir only succeeds when empty, so a user's own skill keeps it alive.
    try {
      fs.rmdirSync(path.join(absTarget, dir));
    } catch {
      /* non-empty (the user has skills of their own here) or already gone */
    }
  }
}
