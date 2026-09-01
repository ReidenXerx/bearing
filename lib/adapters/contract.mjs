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
 * @property {(runtime: import('../constants.mjs').Runtime) => boolean} wants
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
