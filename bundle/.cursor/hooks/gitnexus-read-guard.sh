#!/usr/bin/env bash
# preToolUse Read: block full-file reads when GN is fresh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.bearing/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.bearing/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const imp = (rel) => import(pathToFileURL(path.join(root, '.bearing/lib', rel)).href);
const helpers = await imp('hook-helpers.mjs');
const { readPromptHint } = await imp('session-primer.mjs');
const { evaluateStalePolicy, staleRefreshAgentMessage } = await imp('stale-policy.mjs');
const { classifyRead } = await imp('classify.mjs');
const { emitVerdict } = await imp('cursor-emit.mjs');

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const ti = input.tool_input ?? {};
const filePath = ti.path ?? ti.target_file ?? '';
const config = helpers.loadHookConfig(root);
const policy = evaluateStalePolicy(stale, root);
const staleMsg = staleRefreshAgentMessage(stale, policy);

const verdict = classifyRead(
  { toolInput: ti },
  {
    phase: policy.phase,
    config,
    repo: helpers.repoName(root),
    root,
    graphUsed: fs.existsSync(path.join(root, '.bearing/.gitnexus-mcp-used.flag')),
    promptHint: readPromptHint(root),
    // Lazy line count — only read the file when classify actually needs the size.
    readLines: () => {
      try {
        const abs = path.resolve(root, filePath);
        return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n').length : 0;
      } catch {
        return 0;
      }
    },
    staleMustRefreshMsg: staleMsg,
    staleFallbackMsg: staleMsg,
  },
);

emitVerdict(verdict, { root, mode: config.mode, nudge: process.env.GITNEXUS_FIRST_NUDGE || '' });
NODE
