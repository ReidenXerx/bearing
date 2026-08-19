/**
 * Choose the CHEAPEST refresh that actually fixes what is wrong.
 *
 * Every automatic refresh path used to run `analyze --force --embeddings 0 --skills --pdg` — a full
 * rebuild — on every commit and on any staleness at all, including two files behind. Measured on a
 * 220-file repository: 2s for a no-op, 21s incremental, 43s forced. On a 3,000-file product repo the
 * same full build takes just under ten minutes, and it ran at every commit.
 *
 * `analyze` is already incremental; `--force` is the opt-in. So the fix is not a new indexer, it is
 * to stop asking for a full rebuild when nothing needs one.
 *
 * THE ONE PLACE `--force` IS GENUINELY REQUIRED. `analyze` short-circuits on "Already up to date"
 * BEFORE it reaches the embeddings and PDG steps, so on a current graph `--embeddings` and `--pdg`
 * are silently ignored. A graph built without embeddings therefore cannot gain them from an ordinary
 * refresh — verified: two `--embeddings 0` runs left it at 0, and only `--force` produced them.
 * Every deny message says "resync with bearing:refresh", which for that repo could never work.
 */

/**
 * @typedef {object} RefreshPlan
 * @property {'none'|'incremental'|'embeddings'|'pdg'|'full'} tier
 * @property {string[]} args arguments to `gitnexus analyze`
 * @property {string} why one line, shown to whoever triggered it
 */

/** Node types the embedder covers; a repo can legitimately have fewer embeddings than nodes. */
const EMBED_CAP = "0"; // no cap — the 50k default silently truncates large repos

/**
 * @param {object} stale output of check-staleness
 * @param {{ wantPdg?: boolean, force?: boolean, stealth?: boolean }} [opts]
 * @returns {RefreshPlan}
 */
export function planRefresh(stale, opts = {}) {
  const skills = "--skills";

  // STEALTH: tell the indexer not to write into AGENTS.md / CLAUDE.md at all.
  //
  // Without this, `analyze` appends its stats block to those tracked files and we strip it afterwards
  // — so between the two the repo IS dirty, and anything that reads `git status` in that window (a
  // teammate's script, a watcher, the user glancing at it) sees bearing having modified their files.
  // Not writing it is strictly better than writing and reverting; the stabilizer stays as the net for
  // an indexer run we did not launch. Spotted because a real agent added this flag by hand.
  const quiet = opts.stealth ? ["--skip-agents-md"] : [];

  if (opts.force) {
    return {
      tier: "full",
      args: ["analyze", "--force", "--embeddings", EMBED_CAP, skills, ...quiet],
      why: "full rebuild requested",
    };
  }

  // A graph with symbols but no embeddings cannot be repaired incrementally — the up-to-date check
  // returns before the embedder runs. This is the case that must NOT be downgraded.
  if (stale?.nodeCount > 0 && stale?.embeddingsReady === false) {
    return {
      tier: "embeddings",
      args: ["analyze", "--force", "--embeddings", EMBED_CAP, skills, ...quiet],
      why: `graph has ${stale.nodeCount} symbols and no embeddings — semantic search is unavailable, and an incremental analyze cannot add them`,
    };
  }

  // Nothing to index against, or nothing worth indexing. `not_git` is separated out because running
  // the analyzer there fails rather than helps, and reporting "building one" would be a claim the
  // next step disproves.
  if (stale?.reason === "not_git") {
    return { tier: "none", args: [], why: "not a git worktree — nothing to index" };
  }

  // A gap git could not measure. The counter returns -1 there, and an earlier version let that fall
  // through to the incremental branch because -1 < threshold is true — so an UNKNOWN gap got the
  // cheapest treatment, which is the one case that must not happen.
  if (stale?.reason === "behind_unmeasured" || stale?.behindFiles < 0) {
    return {
      tier: "full",
      args: ["analyze", "--force", "--embeddings", EMBED_CAP, skills, ...quiet],
      why: "git could not measure the gap — rebuilding rather than assuming it is small",
    };
  }

  // No index at all, or one the checker could not read. `invalid_meta` is the name the checker
  // actually emits; `unreadable` was never one of them and matched nothing.
  if (stale?.reason === "missing" || stale?.reason === "invalid_meta" || !(stale?.nodeCount > 0)) {
    return {
      tier: "full",
      args: ["analyze", "--embeddings", EMBED_CAP, skills, ...quiet],
      why: "no usable index — building one",
    };
  }

  // History that is not a fast-forward: symbol identity across the divergence is not something an
  // incremental pass can reconcile, so this is a real full rebuild.
  if (stale?.reason === "diverged") {
    return {
      tier: "full",
      args: ["analyze", "--force", "--embeddings", EMBED_CAP, skills, ...quiet],
      why: "history diverged from the indexed commit — incremental cannot reconcile it",
    };
  }

  // Nothing the graph indexes has moved. TWO signals, and both have to be quiet: `behindFiles`
  // counts source files in commits since the index, `driftingFiles` counts them in the working tree.
  //
  // Checking only the committed side was wrong in exactly the place this runs most — a pre-commit
  // hook fires while the change is STAGED, so HEAD has not moved, `behindFiles` is 0, and the plan
  // cheerfully reported "nothing to do" for a commit full of edited source. Found by running the
  // real hook; no unit test caught it, because every fixture I wrote described the committed side.
  const drifting = Number(stale?.driftingFiles) || 0;
  if ((stale?.fresh === true || stale?.behindFiles === 0) && drifting === 0) {
    if (opts.wantPdg) {
      return {
        tier: "pdg",
        args: ["analyze", "--force", "--embeddings", EMBED_CAP, skills, "--pdg", ...quiet],
        // Same short-circuit as embeddings: on a current graph, --pdg alone is ignored.
        why: "graph is current but the PDG substrate was asked for",
      };
    }
    return { tier: "none", args: [], why: "no source file changed since the index — nothing to do" };
  }

  const n = Number(stale?.behindFiles) || Number(stale?.driftingFiles) || 0;
  return {
    tier: opts.wantPdg ? "pdg" : "incremental",
    args: opts.wantPdg
      ? ["analyze", "--embeddings", EMBED_CAP, skills, "--pdg", ...quiet]
      : ["analyze", "--embeddings", EMBED_CAP, skills, ...quiet],
    why: `${n || "some"} source file(s) behind — incremental analyze`,
  };
}
