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
  pickStealthInteractive,
  pickPrettierIgnoreInteractive,
  pickTestOrderInteractive,
} from './prompt.mjs';
import { parseMcpTransport } from './mcp-config.mjs';
import { detectPrettier, prettierIgnoreLines } from './prettier.mjs';
import { installService, manualCommand } from './mcp-service.mjs';
import { hasSharedInstall } from './stealth.mjs';

async function main() {
  banner(`${KIT_NAME} — interactive install`, 'Intel layer for AI coding agents — Cursor, Zed, Claude Code, Codex');
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));

  const target = await pickTargetInteractive();
  // Asked right after the target, because it is a property of THAT repo and it gates everything
  // after it. Skipped when bearing is already committed there — stealth would be refused anyway,
  // and offering a choice we intend to reject is worse than not offering it.
  const alreadyShared = hasSharedInstall(path.resolve(target)).shared;
  const stealth = flags.has('--stealth') || (!alreadyShared && (await pickStealthInteractive()));
  const runtime = await pickRuntimeInteractive();
  const features = await pickFeaturesInteractive();
  // Asked only when there is something to ask about: Prettier is actually configured here, and
  // this is not a stealth install (which must not touch the repo's own config at all).
  const prettier = stealth ? { found: false, why: null } : detectPrettier(path.resolve(target));
  const prettierIgnore = prettier.found
    ? await pickPrettierIgnoreInteractive(
        prettier.why,
        prettierIgnoreLines(runtime, new Set(features)).length,
      )
    : false;

  // Only worth asking when the graph is coming: the ordering is derived from the index, so a repo
  // that declined gitnexus has nothing to rank with.
  const testOrder = features.includes("gitnexus") ? await pickTestOrderInteractive() : false;

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
  ok(`Mode: ${stealth ? 'stealth — visible to you, invisible to git' : 'team — committed'}`);
  ok(`Runtime: ${runtime}`);
  ok(`Features: ${features.join(', ')}`);
  if (prettier.found) ok(`Prettier: ${prettierIgnore ? 'bearing paths exempted' : 'left alone'}`);
  if (features.includes("gitnexus")) {
    ok(`PR test order: ${testOrder ? "impacted tests ranked on every PR" : "off"}`);
  }
  if (wantsGraph) ok(`Index: ${indexMode === 'quick' ? 'skip (--quick)' : 'full'}`);

  installKit(target, {
    runtime,
    features: features.join(','),
    quick: indexMode === 'quick',
    mcpTransport: effectiveTransport,
    stealth,
    prettierIgnore,
    testOrder,
    runSetup: true,
  });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
