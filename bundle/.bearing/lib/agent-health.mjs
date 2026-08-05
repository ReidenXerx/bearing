#!/usr/bin/env node
/**
 * Human-friendly GitNexus + Cursor kit status (for developers and team leads).
 * Usage: node .bearing/lib/agent-health.mjs [repoRoot]
 */
import fs from "node:fs";
import path from "node:path";
import { auditKitHealth } from "./session-health-audit.mjs";

const root = process.argv[2] ?? process.cwd();

function mark(ok) {
  return ok ? "✓" : "✗";
}

async function main() {
  const audit = auditKitHealth(root);
  const { stale, repo, checks, stats } = audit;
  const lines = [];

  lines.push(`GitNexus Cursor Kit — ${repo}`);
  lines.push("");

  for (const c of checks) {
    if (c.id === "graph_fresh") {
      lines.push(`Graph index     ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "embeddings") {
      lines.push(`Embeddings      ${mark(c.ok)} ${c.detail}`);
    } else if (c.id === "hooks") {
      lines.push(`Cursor hooks    ${mark(c.ok)} ${c.detail}`);
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
  lines.push(
    "• Your Cursor agent uses the GitNexus knowledge graph for code reasoning",
  );
  lines.push(
    "• When the graph is fresh, grep and broad reads are blocked — by design",
  );
  lines.push(
    "• Field/property searches route to Cypher (ACCESSES) — readers/writers from the graph",
  );
  lines.push(
    "• The agent refreshes the index automatically when it falls behind",
  );
  lines.push(
    "• Pre-edit checks reduce “what breaks if I change this?” surprises",
  );
  lines.push("");
  lines.push("Commands:");
  lines.push("  npm run bearing:health        this summary");
  lines.push("  npm run bearing:agent-brief   session orientation (agents)");
  lines.push("  npm run bearing:agent-status  staleness check (agents)");
  lines.push("");
  lines.push("Team guide: docs/GITNEXUS-CURSOR-GUIDE.md");

  if (!audit.healthy) {
    lines.push("");
    lines.push(
      "Action: open a new Agent chat — the agent will refresh the graph autonomously.",
    );
  }

  console.log(lines.join("\n"));
  process.exit(audit.healthy ? 0 : 1);
}

main();
