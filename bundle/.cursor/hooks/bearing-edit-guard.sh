#!/usr/bin/env bash
# preToolUse Write|StrReplace: staleness gate + tiered impact reminders.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_STALENESS="$(node "$ROOT/.bearing/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.bearing/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"
export GITNEXUS_STALENESS_MODE="${GITNEXUS_STALENESS_MODE:-block}"
export GITNEXUS_ROOT="$ROOT"

# FAIL OPEN if anything inside fails. With `.bearing/lib` missing — partial uninstall, an update
# that died mid-copy, `git clean -xdf` in a stealth repo — the node block threw ERR_MODULE_NOT_FOUND
# and `set -e` turned that into a non-zero hook exit. Nine of twelve hooks did it at once, so a repo
# whose only fault was a missing directory had its guards failing instead of guarding. A verdict we
# cannot compute is not a denial (NS-5): emit nothing and let the call through.
node <<'NODE' || exit 0
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const imp = (rel) => import(pathToFileURL(path.join(root, '.bearing/lib', rel)).href);
const helpers = await imp('hook-helpers.mjs');
const { isImpactUsed } = await imp('session-primer.mjs');
const { evaluateStalePolicy } = await imp('stale-policy.mjs');
const { classifyEdit } = await imp('classify.mjs');
const { emitVerdict } = await imp('cursor-emit.mjs');

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const config = helpers.loadHookConfig(root);
const policy = evaluateStalePolicy(stale, root);

const verdict = classifyEdit(
  { tool: input.tool_name ?? '', toolInput: input.tool_input ?? {} },
  {
    phase: policy.phase,
    config,
    repo: helpers.repoName(root),
    root,
    impactUsed: isImpactUsed(root),
    staleDetail: stale.detail,
  },
);

emitVerdict(verdict, { root, mode: config.mode, nudge: process.env.GITNEXUS_FIRST_NUDGE || '' });
NODE
