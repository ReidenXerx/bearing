#!/usr/bin/env bash
# beforeMCPExecution: allow GitNexus MCP when fresh; stale → refresh first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.bearing/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"

# FAIL OPEN if anything inside fails. With `.bearing/lib` missing — partial uninstall, an update
# that died mid-copy, `git clean -xdf` in a stealth repo — the node block threw ERR_MODULE_NOT_FOUND
# and `set -e` turned that into a non-zero hook exit. Nine of twelve hooks did it at once, so a repo
# whose only fault was a missing directory had its guards failing instead of guarding. A verdict we
# cannot compute is not a denial (NS-5): emit nothing and let the call through.
node <<'NODE' || exit 0
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const root = process.env.GITNEXUS_ROOT;
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const tool = input.tool_name ?? '';
const url = input.url ?? '';
const cmd = input.command ?? '';

const helpers = await import(pathToFileURL(path.join(root, '.bearing/lib/hook-helpers.mjs')).href);
const { evaluateStalePolicy, staleRefreshAgentMessage } = await import(
  pathToFileURL(path.join(root, '.bearing/lib/stale-policy.mjs')).href
);
const { setMcpToolUsed, bumpScore } = await import(
  pathToFileURL(path.join(root, '.bearing/lib/session-primer.mjs')).href
);
const { classifyMcpDrift } = await import(
  pathToFileURL(path.join(root, '.bearing/lib/classify.mjs')).href
);

const config = helpers.loadHookConfig(root);
const isGitnexus =
  /gitnexus/i.test(tool) ||
  /gitnexus/i.test(url) ||
  /gitnexus/i.test(cmd);

function out(obj) {
  // Route through guide mode so `mode: "guide"` nudges instead of hard-blocking.
  process.stdout.write(JSON.stringify(helpers.applyHookMode(obj, config.mode)));
}

if (!isGitnexus) {
  out({ permission: 'allow' });
  process.exit(0);
}

const policy = evaluateStalePolicy(stale, root);

if (policy.phase === 'must_refresh') {
  out({
    permission: 'deny',
    agent_message: staleRefreshAgentMessage(stale, policy),
    user_message: helpers.userMessage('stale.must_refresh'),
  });
  process.exit(0);
}

// Drift gate (classifyMcpDrift enforces phase === 'fresh' itself, so never fires during
// classical_fallback). A graph QUERY tool on a drifted-but-fresh index would ignore the
// agent's uncommitted edits → require a fast incremental refresh.
const drift = classifyMcpDrift(tool, stale, config, policy.phase);
if (drift.decision === 'deny') {
  bumpScore(root, 'driftRefreshBlocks');
  out({
    permission: 'deny',
    agent_message: drift.agentMessage,
    user_message: helpers.userMessage('drift.refresh'),
  });
  process.exit(0);
}

setMcpToolUsed(root, `${tool} ${url} ${cmd}`);
bumpScore(root, 'graphCalls');

const suffix =
  policy.phase === 'classical_fallback'
    ? ' Refresh failed — graph may be stale; classical fallback OK if MCP wrong (say why).'
    : ' Keep using graph tools for mid-task code reasoning.';

out({
  permission: 'allow',
  agent_message: `GitNexus MCP call approved.${suffix}`,
});
NODE
