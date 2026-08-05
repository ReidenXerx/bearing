#!/usr/bin/env node
/**
 * GitNexus rename MCP copy-paste helpers — coordinated renames, not find-and-replace.
 */

/** @param {string} s */
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * @param {string} symbolName
 * @param {string} newName
 * @param {string} repo
 * @param {boolean} [dryRun=true]
 */
export function mcpRename(symbolName, newName, repo, dryRun = true) {
  return `gitnexus_rename({ symbol_name: "${esc(symbolName)}", new_name: "${esc(newName)}", dry_run: ${dryRun}, repo: "${repo}" })`;
}

/**
 * @param {string} prompt
 * @returns {{ oldName: string, newName: string } | null}
 */
export function parseRenameFromPrompt(prompt) {
  const m = prompt.match(
    /\brename\s+[`'"]?([A-Za-z_$][\w$.]*)[`'"]?\s+(?:to|as|into)\s+[`'"]?([A-Za-z_$][\w$.]*)[`'"]?/i
  );
  if (!m) return null;
  return { oldName: m[1], newName: m[2] };
}

/**
 * StrReplace that swaps one identifier for another (symbol rename, not arbitrary text).
 * @param {string} oldString
 * @param {string} newString
 */
export function detectIdentifierRename(oldString, newString) {
  const oldT = (oldString ?? '').trim();
  const newT = (newString ?? '').trim();
  if (!oldT || !newT || oldT === newT) return null;
  const id = /^[A-Za-z_$][\w$]*$/;
  if (id.test(oldT) && id.test(newT) && oldT.length >= 2 && newT.length >= 2) {
    return { oldName: oldT, newName: newT };
  }
  return null;
}

/**
 * @param {object} hint from prompt-router
 * @param {string} repo
 */
export function playbookRenameForHint(hint, repo) {
  if (!hint?.renameHint) return '';
  const { oldName, newName } = hint.renameHint;
  return `PLAYBOOK: gitnexus_impact({ target: "${esc(oldName)}", direction: "upstream", repo: "${repo}" }) → ${mcpRename(oldName, newName, repo, true)}`;
}
