#!/usr/bin/env node
/**
 * Human-friendly bearing + graph status (for developers and team leads).
 * Usage: node .bearing/lib/agent-health.mjs [repoRoot]
 */
import { howToRun } from './how-to-run.mjs';
import { auditKitHealth } from "./session-health-audit.mjs";

const root = process.argv[2] ?? process.cwd();

function mark(ok) {
  return ok ? "✓" : "✗";
}

async function main() {
  const audit = auditKitHealth(root);
  const { stale, repo, checks, stats } = audit;
  const lines = [];

  lines.push(`bearing — ${repo}`);
  lines.push("");

  for (const c of checks) {
    if (c.id === "graph_fresh") {
      lines.push(`Graph index     ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "embeddings") {
      lines.push(`Embeddings      ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "hooks") {
      lines.push(`Claude hooks    ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "mcp") {
      lines.push(`MCP server      ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "kit_manifest" && c.ok) {
      lines.push(`Kit manifest    ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "persistence_dir" || c.id === "persistence_meta") {
      lines.push(`Persistence     ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "pdg_layer_hint") {
      lines.push(`PDG / taint     ${mark(c.ok)} ${c.detail}`);
    }
  }

  if (stats) {
    lines.push(
      `Graph stats     ${stats.nodes ?? "?"} symbols · ${stats.processes ?? "?"} flows · ${stats.communities ?? "?"} clusters`,
    );
  }

  lines.push("");
  lines.push("What this means for you:");
  // These bullets used to describe the gates — grep and reads blocked, refresh forced, pre-edit
  // checks. All retired (NS-25, NS-28); a summary that says otherwise is the NS-20 failure.
  lines.push(
    "• GitNexus is opt-in: the agent uses the graph when you ask for it (\"use gitnexus …\")",
  );
  lines.push("• Grep and Read are never blocked");
  lines.push(
    `• Nothing refreshes the index on its own. When you want it current, ask the agent ("refresh the gitnexus index") or run ${howToRun('bearing:agent-refresh')}`,
  );
  lines.push("");
  lines.push("Commands:");
  lines.push(`  ${howToRun('bearing:health')}        this summary`);
  lines.push(`  ${howToRun('bearing:agent-brief')}   session orientation (agents)`);
  lines.push(`  ${howToRun('bearing:agent-status')}  staleness check (agents)`);
  lines.push("");
  if (!audit.healthy) {
    lines.push("");
    // It used to promise the agent would refresh "autonomously". Nothing does: the index is
    // refreshed when the user asks (NS-25), so the action names the two ways to ask.
    lines.push(
      `Action: refresh the index — ask your agent ("refresh the gitnexus index") or run ${howToRun('bearing:agent-refresh')}`,
    );
  }

  console.log(lines.join("\n"));
  process.exit(audit.healthy ? 0 : 1);
}

main();
