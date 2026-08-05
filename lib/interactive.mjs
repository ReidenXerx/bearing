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
  banner(`${KIT_NAME} — interactive install`, 'Intel layer for AI coding agents — Cursor, Zed, Claude Code');

  const target = await pickTargetInteractive();
  const runtime = await pickRuntimeInteractive();
  const features = await pickFeaturesInteractive();
  const indexMode = await pickIndexModeInteractive();

  ok(`Target: ${path.resolve(target)}`);
  ok(`Runtime: ${runtime}`);
  ok(`Features: ${features.join(', ')}`);
  ok(`Index: ${indexMode === 'quick' ? 'skip (--quick)' : 'full'}`);

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
