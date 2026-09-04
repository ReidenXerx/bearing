#!/usr/bin/env node
/**
 * Kit health audit — shared by agent-health.mjs and sessionStart hook.
 */
import fs from "node:fs";
import { howToRun } from './how-to-run.mjs';
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
/**
 * Which runtimes this install actually covers, from the manifest it wrote.
 *
 * The three Cursor checks below ran unconditionally, so a correct CLAUDE-ONLY install was reported
 * broken — "Cursor hooks ✗", "Missing gitnexus MCP entry", "Missing north-star rule" — and
 * `bearing:doctor` signed off with "restart Cursor". Advice the reader cannot follow, about a
 * problem that does not exist (NS-6), on three separate commands at once.
 *
 * Gating them on the runtime fixed the symptom and left the cause: this kept its OWN copy of the
 * alias table, and when Cursor was removed that copy still expanded `all` and `both` to include
 * cursor — so the gate opened and all three fired again, on every `--runtime all` install. The
 * checks are now pointed at the runtime that exists; the table is only ever the installer's.
 * @param {string} root
 */
function installedRuntimes(root) {
  for (const rel of [".bearing/manifest.json", ".gitnexus/agent-kit-manifest.json"]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")).runtime;
      const out = new Set();
      for (const t of String(raw || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean)) {
        if (t === "both") { out.add("zed"); out.add("claude"); }
        else if (t === "all") { out.add("zed"); out.add("claude"); out.add("codex"); }
        else out.add(t);
      }
      if (out.size) return out;
    } catch {
      /* try the next location */
    }
  }
  // No manifest — an old or hand-made install. Check everything, as it did before: a false alarm
  // beats silently verifying nothing.
  return new Set(["zed", "claude", "codex"]);
}

export function auditKitHealth(root) {
  const stale = loadStaleness(root);
  const config = loadHookConfig(root);
  const repo = repoName(root);
  const runtimes = installedRuntimes(root);

  /** @type {{ id: string, ok: boolean, label: string, detail?: string }[]} */
  const checks = [];

  // A stealth install writes settings.LOCAL.json — not touching the tracked file is the whole
  // point of the mode — so a check that knows only one of the two reports a correct stealth repo
  // as ungated.
  const settings = [".claude/settings.json", ".claude/settings.local.json"]
    .map((rel) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
      } catch {
        return null;
      }
    })
    .find((s) => s?.hooks);
  const hooksOk = Boolean(settings?.hooks?.PreToolUse?.length && settings?.hooks?.SessionStart?.length);
  if (runtimes.has("claude")) checks.push({
    id: "hooks",
    ok: hooksOk,
    label: "Claude hooks",
    detail: hooksOk
      ? `Enforcement (${config.mode})`
      : "no PreToolUse/SessionStart hooks in .claude/settings*.json",
  });

  const mcpPath = path.join(root, ".mcp.json");
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
  if (runtimes.has("claude")) checks.push({
    id: "mcp",
    ok: mcpOk,
    label: "GitNexus MCP",
    detail: mcpOk ? "gitnexus in .mcp.json" : "Missing gitnexus MCP entry",
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

  // Newest first; the older paths keep an install that predates the move reporting as healthy.
  const kitOk = [
    ".bearing/manifest.json",
    ".gitnexus/agent-kit-manifest.json",
    ".cursor/gn-kit-manifest.json",
  ].some((rel) => fs.existsSync(path.join(root, rel)));
  checks.push({
    id: "kit_manifest",
    ok: kitOk,
    label: "Kit manifest",
    detail: kitOk ? "bearing installed" : "No bearing manifest (manual install?)",
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
    // The hooks half is only true where hooks exist. The `hooks` check is correctly gated to
    // claude, so on a zed install it is simply absent from the list — and this line then asserted
    // it anyway (NS-14, NS-20).
    const enforcing = (audit.checks ?? []).some((c) => c.id === "hooks");
    return enforcing
      ? "bearing is active — graph fresh, embeddings ready, and enforcement hooks are on. The agent will confirm health at the start of this chat."
      : "bearing is active — graph fresh and embeddings ready. This runtime has no tool-interception hooks, so the contract is advisory here.";
  }
  const stale = audit.stale?.reason === "missing_embeddings";
  if (stale) {
    return "bearing is active — the graph needs embeddings. The agent will refresh automatically before code work.";
  }
  return "bearing is active — the graph is behind your latest commits. The agent will refresh it automatically before code work.";
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
    `1. Shell: ${howToRun('bearing:agent-status')} (required_permissions: ["all"])\n` +
    `2. Confirm kit checks match snapshot; if mismatch run ${howToRun('bearing:agent-refresh')} autonomously\n` +
    "3. Optional: READ gitnexus://repo/" +
    audit.repo +
    `/context OR ${howToRun('bearing:agent-brief')}\n` +
    "4. Reasoning stack: query → context → cypher (structural) → impact → detect_changes\n" +
    '5. Tell the user ONE sentence: "bearing: ready (graph fresh, enforcement on)" OR brief fix in progress\n' +
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
