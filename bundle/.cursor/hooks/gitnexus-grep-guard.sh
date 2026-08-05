#!/usr/bin/env bash
# preToolUse Grep/Glob/SemanticSearch: route symbol/field/broad searches to GitNexus.
# Thin Cursor-protocol glue — the decision lives in lib/classify.mjs (vendor-neutral).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.bearing/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
# first-nudge reuses GITNEXUS_STALENESS (exported above) instead of recomputing it.
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.bearing/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const imp = (rel) => import(pathToFileURL(path.join(root, '.bearing/lib', rel)).href);
const helpers = await imp('hook-helpers.mjs');
const { evaluateStalePolicy, staleRefreshAgentMessage } = await imp('stale-policy.mjs');
const { classifyGrep } = await imp('classify.mjs');
const { emitVerdict } = await imp('cursor-emit.mjs');

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const config = helpers.loadHookConfig(root);
const policy = evaluateStalePolicy(stale, root);
const staleMsg = staleRefreshAgentMessage(stale, policy);

const verdict = classifyGrep(
  { tool: input.tool_name ?? '', toolInput: input.tool_input ?? {} },
  {
    phase: policy.phase,
    graphUsed: fs.existsSync(path.join(root, '.bearing/.gitnexus-mcp-used.flag')),
    config,
    repo: helpers.repoName(root),
    root,
    staleMustRefreshMsg: staleMsg,
    staleFallbackMsg: staleMsg,
  },
);

emitVerdict(verdict, { root, mode: config.mode, nudge: process.env.GITNEXUS_FIRST_NUDGE || '' });
NODE
