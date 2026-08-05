#!/usr/bin/env bash
# beforeSubmitPrompt: classify user prompt; write playbook hints for first-tool nudge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"

node <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const prompt = input.prompt ?? '';
const root = process.env.GITNEXUS_ROOT;

// Single source of truth for "what counts as a source file" — the hook config's
// sourceExtRe (built-in polyglot default, overridable in gitnexus-hooks.json).
const helpers = await import(pathToFileURL(path.join(root, '.bearing/lib/hook-helpers.mjs')).href);
const sourceExtRe = helpers.loadHookConfig(root).sourceExtRe;

const architecture =
  /\b(how does|how do|architecture|pipeline|data flow|call chain|what calls|walk me through|end.to.end|cross.module|execution flow|business flow|trace|who calls|where does .+ flow|deep dive|gather context|full context|map the|audit)\b/i.test(
    prompt
  );

const structural =
  /\b(readers?|writers?|who (reads|writes)|field access|property access|getter|setter|mutat|ACCESSES|data flow through|override chain|method override|diamond inherit|\d+.hop|multi.hop|call chain|shortest path|trace from|path from|process step|STEP_IN_PROCESS|HAS_METHOD|class methods|PDG|control dependence|control flow|data dependence|taint|injection|xss|path traversal)\b/i.test(
    prompt
  );

const explore =
  /\b(explore|investigate|understand the|navigate|orient|get context on)\b/i.test(prompt);

const reasoning =
  /\b(reason|why does|what breaks|blast radius|depend on|downstream|upstream|side effect|if i change|safe to change)\b/i.test(
    prompt
  );

const codeTask =
  /\b(fix|bug|refactor|implement|add|change|edit|update|review|commit|test|polish|hooks|enforce)\b/i.test(
    prompt
  );

// Grab the first file-like token, then validate its extension against the shared
// sourceExtRe instead of a duplicated inline extension list.
const pathTokenMatch = prompt.match(/(?:^|[\s(])([\w./-]+\.[A-Za-z]{1,6})\b/);
const pathMatch =
  pathTokenMatch && sourceExtRe.test(pathTokenMatch[1]) ? pathTokenMatch : null;
const symbolMatch = prompt.match(/\b([A-Z][A-Za-z0-9]+)\b/);
const fieldMatch =
  prompt.match(/\b(?:field|property)\s+[`'"]?([a-z][a-zA-Z0-9]*)[`'"]?/i) ||
  prompt.match(/\b(readers?|writers?)\s+(?:of|for)\s+[`'"]?([a-z][a-zA-Z0-9]*)[`'"]?/i);
const callChainMatch = prompt.match(/\b(?:call chain|callers?|shortest path|trace)\s+(?:of|for|to)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i);
const traceMatch = prompt.match(/\b(?:trace|path)\s+(?:from\s+)?[`'"]?([A-Za-z_$][\w$]*)[`'"]?\s+(?:to|->|→)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i);
const overrideMatch = prompt.match(/\b(?:override|overrides)\s+(?:of|for|on)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i);
const processMatch = prompt.match(/\b(?:process|flow)\s+[`'"]?([^"'`]+)[`'"]?/i);
const renameParsed = (await import(pathToFileURL(path.join(root, '.bearing/lib/rename-helpers.mjs')).href)).parseRenameFromPrompt(prompt);
const dataFlow = /\b(data flow|data dependence|field flow|property flow|who (reads|writes)|readers?|writers?|mutat|getter|setter|where does .+ flow)\b/i.test(prompt);
const pdgControl = /\b(PDG|control flow|control dependence|what guards|guarded by|under what condition|why does .+ run)\b/i.test(prompt);
const pdgImpact = /\b(PDG impact|precise impact|genuinely affected|control.data affected)\b/i.test(prompt);
const taint = /\b(taint|injection|sql injection|command injection|code injection|path traversal|xss|source.?sink|security review)\b/i.test(prompt);
const variableMatch = prompt.match(/\b(?:variable|var|binding)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i);

const { writePromptHint } = await import(
  pathToFileURL(path.join(root, '.bearing/lib/session-primer.mjs')).href
);

writePromptHint(root, {
  architecture: architecture || explore,
  explore,
  reasoning,
  codeTask,
  structural: structural || Boolean(fieldMatch || callChainMatch || traceMatch) || dataFlow || pdgControl || pdgImpact || taint,
  dataFlow,
  pdgFlowHint: dataFlow,
  pdgControlHint: pdgControl,
  pdgImpactHint: pdgImpact,
  taintHint: taint,
  renameHint: renameParsed,
  fieldHint: fieldMatch?.[2] || fieldMatch?.[1] || null,
  fieldRead: /\b(readers?|reads|read access|getter)\b/i.test(prompt),
  fieldWrite: /\b(writers?|writes|write access|mutat|setter)\b/i.test(prompt),
  callChainHint: callChainMatch?.[1] || null,
  traceFrom: traceMatch?.[1] || null,
  traceTo: traceMatch?.[2] || null,
  variableHint: variableMatch?.[1] || null,
  overrideHint: overrideMatch?.[1] || null,
  processHint: structural && processMatch ? processMatch[1].trim().slice(0, 80) : null,
  hopDepth: /\b(\d+)[- ]hop/i.test(prompt) ? Number(prompt.match(/\b(\d+)[- ]hop/i)[1]) : 3,
  snippet: prompt.slice(0, 200),
  fileHint: pathMatch?.[1],
  symbolHint: symbolMatch?.[1],
});

process.stdout.write(JSON.stringify({ continue: true }));
NODE
