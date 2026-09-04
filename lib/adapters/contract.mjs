/**
 * The Adapter contract — what an IDE integration must provide.
 *
 * This lived in `cursor.mjs` until Cursor support was removed, purely because that adapter happened
 * to be written first. A shared contract owned by one of its own implementations is a dependency
 * waiting to break: deleting that implementation took the definition with it and left three
 * siblings importing a type from a file that no longer existed.
 *
 * @typedef {Object} Adapter
 * @property {string} id
 *
 * There is deliberately NO `wants(runtime)` here. Each adapter used to carry its own, and all three
 * had drifted from `runtimeIds` — zed's understood neither `all` nor a comma-list, claude's and
 * codex's did not know `both`. Nothing called them (verified), so the damage was latent: a fourth
 * hand-written copy of the one table this project has already been bitten by twice, sitting in the
 * file a new adapter author reads first. `activeAdapters` asks `runtimeIds`, which is the only
 * expansion that exists now.
 * @property {{ key: string, value: string, label: string }} choice  Interactive picker entry.
 * @property {string|null} skillLinkDir  Repo-relative dir to symlink the skill store into.
 * @property {string[]} gitignoreLines   IDE-specific .gitignore entries.
 * @property {{ rel: string, bak: string }[]} backups  Files to back up before bundle copy.
 * @property {(absTarget: string, ctx: { repoName: string }) => void} wire
 * @property {(absTarget: string, manifest: Record<string, any>) => void} unwire
 * @property {(ctx: { repoName: string }) => { pre: string[], post: string[] }} nextSteps
 * @property {(manifest: Record<string, any>) => Record<string, any>} manifestFlags
 */
export {};
