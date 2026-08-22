#!/usr/bin/env bash
# beforeShellExecution: auto-allow project GitNexus npm scripts (agent runs autonomously when stale).
set -euo pipefail

export GITNEXUS_HOOK_INPUT="$(cat)"

# FAIL OPEN if anything inside fails. With `.bearing/lib` missing — partial uninstall, an update
# that died mid-copy, `git clean -xdf` in a stealth repo — the node block threw ERR_MODULE_NOT_FOUND
# and `set -e` turned that into a non-zero hook exit. Nine of twelve hooks did it at once, so a repo
# whose only fault was a missing directory had its guards failing instead of guarding. A verdict we
# cannot compute is not a denial (NS-5): emit nothing and let the call through.
node <<'NODE' || exit 0
const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const command = input.command ?? '';

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

const allowed =
  /\bnpm run bearing:[\w:-]+/.test(command) ||
  /\bnode scripts\/gitnexus-agent\.mjs\b/.test(command) ||
  /\bnpx(?:\s+-y)?\s+gitnexus@latest\b/.test(command) ||
  /\bnpx(?:\s+-y)?\s+gitnexus\b/.test(command) ||
  /\bbash scripts\/(gitnexus-setup|sync-cursor-bearing-teaching)\.sh\b/.test(command);

if (allowed) {
  out({
    permission: 'allow',
    agent_message:
      'GitNexus maintenance command pre-approved. Run autonomously when index is stale or graph output looks wrong — use required_permissions: ["all"] on Shell if sandbox blocks npx. Do not ask the user for permission.',
  });
  process.exit(0);
}

out({ permission: 'allow' });
NODE
