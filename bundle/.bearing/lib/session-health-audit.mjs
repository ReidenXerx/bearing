#!/usr/bin/env node
/**
 * Kit health audit — shared by agent-health.mjs and sessionStart hook.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadHookConfig, repoName } from "./hook-helpers.mjs";
import { inspectPersistence } from "./persistence-health.mjs";

export const SESSION_HEALTH_FILE = ".bearing-session-health.json";
export const SESSION_USER_NOTIFIED_FLAG =
  ".bearing-session-user-notified.flag";

/**
 * @param {string} root
 */
export function loadStaleness(root) {
  const checkPath = path.join(root, ".bearing/lib/check-staleness.mjs");
  try {
    const r = spawnSync(process.execPath, [checkPath, root], {
      encoding: "utf8",
    });
    return JSON.parse(r.stdout.trim() || "{}");
  } catch {
    return {
      fresh: false,
      reason: "check_failed",
      detail: "Staleness check failed.",
    };
  }
}

/**
 * @param {string} root
 */
export function auditKitHealth(root) {
  const stale = loadStaleness(root);
  const config = loadHookConfig(root);
  const repo = repoName(root);

  /** @type {{ id: string, ok: boolean, label: string, detail?: string }[]} */
  const checks = [];

  const hooksPath = path.join(root, ".cursor/hooks.json");
  const hooksOk =
    fs.existsSync(hooksPath) &&
    (() => {
      try {
        const h = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
        const hooks = h.hooks ?? {};
        return Boolean(hooks.sessionStart?.length && hooks.preToolUse?.length);
      } catch {
        return false;
      }
    })();
  checks.push({
    id: "hooks",
    ok: hooksOk,
    label: "Cursor hooks",
    detail: hooksOk
      ? `Enforcement (${config.mode})`
      : "hooks.json missing or incomplete",
  });

  const mcpPath = path.join(root, ".cursor/mcp.json");
  const mcpOk =
    fs.existsSync(mcpPath) &&
    (() => {
      try {
        return Boolean(
          JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers?.gitnexus,
        );
      } catch {
        return false;
      }
    })();
  checks.push({
    id: "mcp",
    ok: mcpOk,
    label: "GitNexus MCP",
    detail: mcpOk
      ? "gitnexus in .cursor/mcp.json"
      : "Missing gitnexus MCP entry",
  });

  const rulePath = path.join(root, ".cursor/rules/00-gitnexus-enforcement.mdc");
  const ruleOk = fs.existsSync(rulePath);
  checks.push({
    id: "rule",
    ok: ruleOk,
    label: "Enforcement rule",
    detail: ruleOk ? "00-gitnexus-enforcement.mdc" : "Missing north-star rule",
  });

  const helpersOk =
    fs.existsSync(path.join(root, ".bearing/lib/hook-helpers.mjs")) &&
    fs.existsSync(path.join(root, ".bearing/lib/cypher-helpers.mjs"));
  checks.push({
    id: "hook_libs",
    ok: helpersOk,
    label: "Hook helpers",
    detail: helpersOk ? "hook-helpers + cypher-helpers" : "Missing hook lib(s)",
  });

  const graphFresh = stale.fresh === true;
  checks.push({
    id: "graph_fresh",
    ok: graphFresh,
    label: "Graph index",
    detail: graphFresh
      ? `Fresh (${(stale.indexedCommit || "").slice(0, 7) || "HEAD"})`
      : stale.detail || stale.reason || "Not fresh",
  });

  const embeddingsOk =
    graphFresh &&
    ((stale.embeddingCount ?? 0) > 0 || (stale.nodeCount ?? 0) === 0);
  checks.push({
    id: "embeddings",
    ok: embeddingsOk,
    label: "Embeddings",
    detail:
      (stale.embeddingCount ?? 0) > 0
        ? `${stale.embeddingCount} vectors`
        : stale.reason === "missing_embeddings"
          ? "Missing — refresh required"
          : graphFresh
            ? "OK"
            : "Unavailable until graph is fresh",
  });

  const kitOk =
    fs.existsSync(path.join(root, ".gitnexus/agent-kit-manifest.json")) ||
    fs.existsSync(path.join(root, ".cursor/gn-kit-manifest.json"));
  checks.push({
    id: "kit_manifest",
    ok: kitOk,
    label: "Kit manifest",
    detail: kitOk
      ? "gitnexus-agent-kit installed"
      : "No agent-kit manifest (manual install?)",
  });

  const persistence = inspectPersistence(root);
  checks.push(...persistence.checks);

  const healthy = checks
    .filter((c) => c.id !== "pdg_layer_hint")
    .every((c) => c.ok);

  let stats = null;
  const metaPath = path.join(root, ".gitnexus/meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      stats = JSON.parse(fs.readFileSync(metaPath, "utf8")).stats ?? null;
    } catch {
      /* ignore */
    }
  }

  return {
    repo,
    healthy,
    stale,
    config: { mode: config.mode },
    checks,
    stats,
    auditedAt: new Date().toISOString(),
  };
}

/**
 * @param {ReturnType<typeof auditKitHealth>} audit
 */
export function userMessageForSession(audit) {
  if (audit.healthy) {
    return "GitNexus kit is active — graph fresh, embeddings ready, and enforcement hooks are on. The agent will confirm health at the start of this chat.";
  }
  const stale = audit.stale?.reason === "missing_embeddings";
  if (stale) {
    return "GitNexus kit is active — the graph needs embeddings. The agent will refresh automatically before code work.";
  }
  return "GitNexus kit is active — the graph is behind your latest commits. The agent will refresh it automatically before code work.";
}

/**
 * @param {ReturnType<typeof auditKitHealth>} audit
 */
export function agentContextForSession(audit) {
  const failed = audit.checks.filter((c) => !c.ok).map((c) => c.id);
  const summary = audit.checks
    .map((c) => `${c.id}:${c.ok ? "ok" : "FAIL"}`)
    .join(" ");
  return (
    "GN SESSION HEALTH (mandatory — first reply before task work):\n" +
    '1. Shell: npm run gitnexus:agent-status (required_permissions: ["all"])\n' +
    "2. Confirm kit checks match snapshot; if mismatch run npm run gitnexus:agent-refresh autonomously\n" +
    "3. Optional: READ gitnexus://repo/" +
    audit.repo +
    "/context OR npm run gitnexus:agent-brief\n" +
    "4. Reasoning stack: query → context → cypher (structural) → impact → detect_changes\n" +
    '5. Tell the user ONE sentence: "GitNexus kit: ready (graph fresh, enforcement on)" OR brief fix in progress\n' +
    "Keep laconic. Do not paste this block verbatim.\n" +
    `Audit: healthy=${audit.healthy} ${summary}` +
    (failed.length ? ` failed=[${failed.join(",")}]` : "")
  );
}

/**
 * @param {string} root
 * @param {ReturnType<typeof auditKitHealth>} audit
 */
export function writeSessionHealthFile(root, audit) {
  const p = path.join(root, ".bearing", SESSION_HEALTH_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(audit, null, 2) + "\n");
}
