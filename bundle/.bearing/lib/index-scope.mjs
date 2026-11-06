/**
 * Is this session — and is this path — inside the tree the GitNexus index covers? (NS-26)
 *
 * "The index" is one checkout at one commit, not the repository. Half of every fallback ever logged
 * across the fleet (87 of 169) was an agent pointed at the graph for code the graph had never seen:
 * a linked git worktree, a PR ref, another repo, `node_modules`, `.e2e/`, `.bearing/`. A lookup there
 * answers "not found", which reads exactly like absence. One repo's worktree workflow produced 55 of
 * them on its own — every search redirected to an index of the main checkout on an older branch.
 *
 * So before anything points an agent at the graph, it asks this module. Two rules shape the answer:
 *
 *   - **Unknown is OUT.** If git cannot say, or meta.json is unreadable, the answer is "not in scope"
 *     and the caller stays silent. Silence costs one missed hint; a wrong "the graph covers this"
 *     costs a confident wrong answer (NS-5).
 *   - **Another branch's index is out of scope, not merely stale.** If the indexed commit is not in
 *     HEAD's history, the graph describes code this checkout may not have. "N commits behind" is a
 *     claim about THIS branch only.
 *
 * Bounded (NS-7): every git call has a timeout, the session answer is cached per HEAD, and nothing
 * here reads a source file.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Path segments the index never contains, whatever the ignore files say. */
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".git", ".gitnexus", ".bearing", ".e2e"]);
const CACHE_REL = ".bearing/.gitnexus-scope.json";
const GIT_TIMEOUT_MS = 1500;

/** @param {string} cwd @param {string[]} args @returns {string} trimmed stdout; throws on failure */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}

/** @param {string} p @returns {string} */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * meta.json is not small: 618 KB was measured on a real repo, because it carries the embedding
 * checkpoint. Parse it only when computing; the cache check uses {@link metaMtime} instead.
 * @param {string} dir @returns {{ meta: any, mtimeMs: number } | null}
 */
function readMeta(dir) {
  const p = path.join(dir, ".gitnexus", "meta.json");
  try {
    return { meta: JSON.parse(fs.readFileSync(p, "utf8")), mtimeMs: fs.statSync(p).mtimeMs };
  } catch {
    return null;
  }
}

/** @param {string|null} dir @returns {number|null} */
function metaMtime(dir) {
  if (!dir) return null;
  try {
    return fs.statSync(path.join(dir, ".gitnexus", "meta.json")).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * An index whose build never finished: `analyze` writes meta.json with `lastCommit: ""` up front
 * and fills it in at the end. Seen on two real worktrees, next to a leftover analyze.lock and a
 * half-written staging database. It LOOKS like this tree has an index, and it has none it can use.
 * @param {any} meta
 */
const unfinished = (meta) => !(typeof meta?.lastCommit === "string" && meta.lastCommit);

/**
 * @typedef {object} SessionScope
 * @property {"in"|"out"} status
 * @property {null|"no-git"|"no-index"|"invalid-meta"|"linked-worktree"|"other-tree"|"other-branch"} reason
 * @property {string|null} toplevel       this session's git toplevel (realpath)
 * @property {string|null} indexRoot      the tree the index was built from (realpath)
 * @property {string|null} indexedCommit
 * @property {string|null} headCommit
 * @property {number|null} behind         commits from indexedCommit to HEAD, when in scope
 * @property {number|null} metaMtimeMs    cache key half: a rebuilt index invalidates the answer
 * @property {boolean} [ownIndexUnfinished] linked worktree whose OWN index build never finished
 */

/**
 * Compute the session's scope from scratch. Prefer {@link cachedSessionScope} on a hook path.
 * @param {string} root the session's project dir
 * @returns {SessionScope}
 */
export function sessionScope(root) {
  /** @type {SessionScope} */
  const out = {
    status: "out",
    reason: null,
    toplevel: null,
    indexRoot: null,
    indexedCommit: null,
    headCommit: null,
    behind: null,
    metaMtimeMs: null,
  };
  try {
    out.toplevel = real(git(root, ["rev-parse", "--show-toplevel"]));
    out.headCommit = git(root, ["rev-parse", "HEAD"]);
  } catch {
    out.reason = "no-git"; // not a repository, no commits yet, or git missing
    return out;
  }

  const own = readMeta(out.toplevel);
  if (own && !unfinished(own.meta)) {
    // An index copied in from elsewhere describes that elsewhere.
    out.indexRoot = real(own.meta?.repoPath || out.toplevel);
    out.indexedCommit = own.meta.lastCommit;
    out.metaMtimeMs = own.mtimeMs;
    if (out.indexRoot !== out.toplevel) {
      out.reason = "other-tree";
      return out;
    }
  } else {
    // No usable index in this toplevel — none at all, or one whose build never finished. If the MAIN
    // checkout has one, this session is a linked worktree, and the graph tools — which resolve a repo
    // by its registered path — answer for that tree.
    let mainRoot = null;
    try {
      const common = git(out.toplevel, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (path.basename(common) === ".git") mainRoot = real(path.dirname(common));
    } catch {
      /* older git, or a bare common dir: no main checkout to compare against */
    }
    const main = mainRoot && mainRoot !== out.toplevel ? readMeta(mainRoot) : null;
    if (main && !unfinished(main.meta)) {
      out.indexRoot = mainRoot;
      out.indexedCommit = main.meta.lastCommit;
      out.metaMtimeMs = main.mtimeMs;
      out.ownIndexUnfinished = Boolean(own);
      out.reason = "linked-worktree";
      return out;
    }
    // The staleness line already reports a missing or broken index for this checkout.
    out.metaMtimeMs = own?.mtimeMs ?? null;
    out.reason = own ? "invalid-meta" : "no-index";
    return out;
  }

  if (out.indexedCommit === out.headCommit) {
    out.status = "in";
    out.behind = 0;
    return out;
  }
  try {
    git(out.toplevel, ["merge-base", "--is-ancestor", out.indexedCommit, out.headCommit]);
  } catch {
    // Exit 1 (not an ancestor) and "unknown commit" (built on a branch since deleted) mean the same
    // thing here: the index describes history this checkout is not on.
    out.reason = "other-branch";
    return out;
  }
  out.status = "in";
  try {
    out.behind = parseInt(git(out.toplevel, ["rev-list", "--count", `${out.indexedCommit}..${out.headCommit}`]), 10);
    if (!Number.isFinite(out.behind)) out.behind = null;
  } catch {
    out.behind = null;
  }
  return out;
}

/**
 * {@link sessionScope}, cached in `.bearing/.gitnexus-scope.json` and reused while HEAD and the
 * index are unchanged — the hot-path form (NS-7). A cache that cannot be read or written is simply
 * not used; it never changes the answer.
 * @param {string} root
 * @returns {SessionScope}
 */
export function cachedSessionScope(root) {
  const cacheFile = path.join(root, CACHE_REL);
  let head = null;
  try {
    head = git(root, ["rev-parse", "HEAD"]);
  } catch {
    return sessionScope(root);
  }
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    // stat, never parse (NS-7). For an unfinished own index the main checkout's meta is the key,
    // and the own one is checked too, so finishing that build invalidates the answer.
    const keyOk =
      c.metaMtimeMs === metaMtime(c.indexRoot || c.toplevel) &&
      (!c.ownIndexUnfinished || metaMtime(c.toplevel) !== null);
    if (c.headCommit === head && keyOk && real(root).startsWith(c.toplevel ?? "\0")) {
      return c;
    }
  } catch {
    /* no cache, or unreadable: compute */
  }
  const fresh = sessionScope(root);
  try {
    // Atomic: a hook killed mid-write must not leave half a JSON for the next one to trust.
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(fresh));
    fs.renameSync(tmp, cacheFile);
  } catch {
    /* .bearing/ missing or read-only: the answer stands without a cache */
  }
  return fresh;
}

/**
 * Is `file` code the index could hold? False whenever the session is out of scope.
 *
 * Ignore rules are git's own, with `.gitnexusignore` as the excludes file — the same files the
 * indexer reads — so the answer cannot drift from what was actually indexed. One spawn per call:
 * meant for the rare moment a hint is about to be given, not for every tool call.
 *
 * @param {SessionScope} scope
 * @param {string} file absolute, or relative to the session toplevel
 * @returns {boolean}
 */
export function pathInScope(scope, file) {
  if (!scope || scope.status !== "in" || !scope.toplevel) return false;
  const abs = path.isAbsolute(file) ? file : path.join(scope.toplevel, file);
  // realpath the deepest existing ancestor, so a new file under a symlinked dir still resolves.
  let probe = abs;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const resolved = path.join(real(probe), path.relative(probe, abs));
  const rel = path.relative(scope.toplevel, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (rel.split(path.sep).some((seg) => EXCLUDED_SEGMENTS.has(seg))) return false;
  const args = ["check-ignore", "-q", "--no-index", "--", rel];
  const gnIgnore = path.join(scope.toplevel, ".gitnexusignore");
  if (fs.existsSync(gnIgnore)) args.unshift("-c", `core.excludesFile=${gnIgnore}`);
  try {
    git(scope.toplevel, args);
    return false; // exit 0: ignored
  } catch (e) {
    // exit 1: not ignored → in scope. Anything else (timeout, git error) is unknown → out.
    return /** @type {any} */ (e)?.status === 1;
  }
}

/**
 * The one line the session brief carries about scope — the fact agents most often lacked.
 * Empty when there is nothing true and useful to say (no index, no git): the staleness line
 * already covers a missing index, and an unknown is silence.
 * @param {SessionScope} s
 * @returns {string}
 */
export function scopeLine(s) {
  const short = (sha) => (sha ? sha.slice(0, 7) : "?");
  if (s.status === "in") {
    const lag = s.behind ? `${s.behind} commit(s) behind HEAD` : "at HEAD";
    return `Index scope: THIS checkout @ ${short(s.indexedCommit)} (${lag}). Graph answers cover tracked source here — never node_modules, .e2e/, .bearing/, other branches, worktrees or other repos; there a "not found" means "not indexed", not "absent".`;
  }
  if (s.reason === "linked-worktree") {
    const own = s.ownIndexUnfinished
      ? " This worktree's own index build never finished (meta.json has no commit), so it does not count."
      : "";
    return `⚠ OUT OF INDEX SCOPE — this session is a linked git worktree (${s.toplevel}). The GitNexus index covers the main checkout ${s.indexRoot} @ ${short(s.indexedCommit)}, so graph tools answer for THAT tree: a "not found" or a missing caller here means "not indexed", not "absent". Use Grep/Read for code in this worktree.${own}`;
  }
  if (s.reason === "other-branch") {
    return `⚠ OUT OF INDEX SCOPE — the index was built at ${short(s.indexedCommit)}, which is not in this branch's history (HEAD ${short(s.headCommit)}). It describes code this checkout may not have; treat every graph answer as about another branch, and use Grep/Read here until the index is rebuilt on this branch.`;
  }
  if (s.reason === "other-tree") {
    return `⚠ OUT OF INDEX SCOPE — .gitnexus/meta.json here was built from ${s.indexRoot}, not this checkout (${s.toplevel}). Graph answers describe that tree.`;
  }
  return "";
}

// CLI: `node .bearing/lib/index-scope.mjs [root]` — what the bearing-gitnexus skill runs FIRST.
// Prints the one scope line, or says plainly that there is no usable index here. Exit 0 either way:
// it informs a decision, it does not make one.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const s = sessionScope(process.argv[2] || process.cwd());
  const line = scopeLine(s);
  if (line) console.log(line);
  else if (s.reason === "no-index") console.log("No GitNexus index for this checkout — graph tools have nothing to answer from here. Use Grep/Read, or build one: node scripts/bearing-agent.mjs refresh");
  else if (s.reason === "invalid-meta") console.log("The GitNexus index here is incomplete (an analyze did not finish). Rebuild it before trusting graph answers: node scripts/bearing-agent.mjs refresh");
  else console.log("Not a git repository — there is no index scope to report.");
}
