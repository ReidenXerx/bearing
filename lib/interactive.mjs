#!/usr/bin/env node
/**
 * Interactive installer — pick target repo + IDE runtime.
 * Usage: node lib/interactive.mjs
 */
import path from 'node:path';
import { banner, ok, warn } from '../bundle/scripts/lib/setup-ui.mjs';
import { KIT_NAME } from './constants.mjs';
import { installKit } from './kit.mjs';
import {
  pickRuntimeInteractive,
  pickTargetInteractive,
  pickIndexModeInteractive,
  pickFeaturesInteractive,
  pickMcpTransportInteractive,
} from './prompt.mjs';
import { parseMcpTransport } from './mcp-config.mjs';
import { installService, manualCommand } from './mcp-service.mjs';

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

  // How the MCP server runs is only a question if the graph module is installed at all.
  const mcpChoice = wantsGraph
    ? await pickMcpTransportInteractive()
    : { transport: 'stdio', install: false };
  const mcpTransport = parseMcpTransport(mcpChoice.transport);

  // Start the shared server BEFORE writing a config that points at it, so the repo is never left
  // aimed at a port with nothing behind it. If it will not start, say so and fall back to stdio —
  // a broken http entry fails every graph call, which is worse than the contention it solves.
  let effectiveTransport = mcpTransport;
  if (mcpTransport.mode === 'http') {
    const port = Number(new URL(mcpTransport.url).port) || undefined;
    if (mcpChoice.install) {
      const res = installService({ port });
      if (res.ok) {
        ok(`Shared MCP server: ${res.detail}`);
        ok(`  stop it with: ${res.stopHint}`);
        if (!res.verified) {
          // Say so rather than let it be discovered. The launchd and Task Scheduler paths are
          // written from documentation, not from a machine we could run them on.
          warn(`  this platform's service path is untested — if it misbehaves, run it by hand:`);
          warn(`    ${manualCommand({ port })}`);
        }
      } else {
        warn(`Could not start the shared server (${res.detail}) — falling back to stdio.`);
        warn(`  to use it later, run: ${manualCommand({ port })}`);
        effectiveTransport = parseMcpTransport('stdio');
      }
    } else {
      ok(`Shared MCP server: config only — start it with \`${manualCommand({ port })}\``);
    }
  }

  ok(`Target: ${path.resolve(target)}`);
  ok(`Runtime: ${runtime}`);
  ok(`Features: ${features.join(', ')}`);
  if (wantsGraph) ok(`Index: ${indexMode === 'quick' ? 'skip (--quick)' : 'full'}`);

  installKit(target, {
    runtime,
    features: features.join(','),
    quick: indexMode === 'quick',
    mcpTransport: effectiveTransport,
    runSetup: true,
  });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
