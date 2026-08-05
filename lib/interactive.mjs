#!/usr/bin/env node
/**
 * Interactive installer — pick target repo + IDE runtime.
 * Usage: node lib/interactive.mjs
 */
import path from 'node:path';
import { banner, ok } from '../bundle/scripts/lib/setup-ui.mjs';
import { KIT_NAME } from './constants.mjs';
import { installKit } from './kit.mjs';
import {
  pickRuntimeInteractive,
  pickTargetInteractive,
  pickIndexModeInteractive,
  pickFeaturesInteractive,
} from './prompt.mjs';

async function main() {
  banner(`${KIT_NAME} — interactive install`, 'Intel layer for AI coding agents — Cursor, Zed, Claude Code, Codex');

  const target = await pickTargetInteractive();
  const runtime = await pickRuntimeInteractive();
  const features = await pickFeaturesInteractive();
  // The index question only means something with the graph module: without it there is no indexer,
  // setup is skipped, and the answer is discarded. Asking anyway makes the very first run look like
  // it needs GitNexus, which is the impression the feature split exists to remove.
  const wantsGraph = features.includes('gitnexus');
  const indexMode = wantsGraph ? await pickIndexModeInteractive() : 'quick';

  ok(`Target: ${path.resolve(target)}`);
  ok(`Runtime: ${runtime}`);
  ok(`Features: ${features.join(', ')}`);
  if (wantsGraph) ok(`Index: ${indexMode === 'quick' ? 'skip (--quick)' : 'full'}`);

  installKit(target, {
    runtime,
    features: features.join(','),
    quick: indexMode === 'quick',
    runSetup: true,
  });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
