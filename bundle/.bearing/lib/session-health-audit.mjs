#!/usr/bin/env node
/**
 * Kit health audit — used by agent-health.mjs (bearing:health) and bearing-verify.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadHookConfig, repoName } from "./hook-helpers.mjs";
import { inspectPersistence } from "./persistence-health.mjs";

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
  // SessionStart only. This required a PreToolUse hook too, which bearing no longer installs (the
  // GitNexus gates are retired, NS-25) — left as it was, it would report every correct install as
  // broken, the false alarm NS-20 warns about in the other direction.
  const hooksOk = Boolean(settings?.hooks?.SessionStart?.length);
  if (runtimes.has("claude")) checks.push({
    id: "hooks",
    ok: hooksOk,
    label: "Claude hooks",
    detail: hooksOk
      ? "SessionStart brief wired"
      : "no SessionStart hook in .claude/settings*.json",
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

