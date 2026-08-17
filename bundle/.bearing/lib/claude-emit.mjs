#!/usr/bin/env node
/**
 * Claude Code hook-protocol adapter — the analog of cursor-emit.mjs.
 *
 * Maps a vendor-neutral {@link import('./classify.mjs').Verdict} onto Claude
 * Code's PreToolUse JSON (`hookSpecificOutput.permissionDecision` + reason), and
 * provides the shared context Claude guard scripts need (staleness, policy, repo,
 * config). The policy itself lives in classify.mjs — this file only knows Claude's
 * wire format, so the same core drives Cursor and Claude Code identically.
 *
 * Lives under .bearing/lib because that dir is the shared, always-shipped
 * hook library; nothing here depends on Cursor.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as helpers from "./hook-helpers.mjs";
import { bumpScore } from "./session-primer.mjs";
import { evaluateStalePolicy, staleRefreshAgentMessage , ESCAPE_HINT } from "./stale-policy.mjs";

const LIB = path.dirname(fileURLToPath(import.meta.url));

/** Read the hook's JSON stdin payload (Claude passes the event object). */
export async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** Shared classify context: staleness phase, config, repo, precomputed messages. */
export function gnContext(root) {
  const r = spawnSync(process.execPath, [path.join(LIB, "load-staleness.mjs"), root], {
    encoding: "utf8",
  });
  let stale = { fresh: false, reason: "check_failed" };
  try {
    stale = JSON.parse(r.stdout.trim() || "{}");
  } catch {
    /* keep fail-closed default */
  }
  const policy = evaluateStalePolicy(stale, root);
  const staleMsg = staleRefreshAgentMessage(stale, policy);
  return {
    root,
    stale,
    config: helpers.loadHookConfig(root),
    repo: helpers.repoName(root),
    phase: policy.phase,
    staleMustRefreshMsg: staleMsg + ESCAPE_HINT,
    staleFallbackMsg: staleMsg,
    staleDetail: stale.detail,
    graphUsed: existsFlag(root, ".gitnexus-mcp-used.flag"),
  };
}

function existsFlag(root, name) {
  return fs.existsSync(path.join(root, ".bearing", name));
}

/**
 * Map a Verdict to Claude's PreToolUse output. deny → permissionDecision deny
 * (reason shown to the model). allow → exit 0 silently so the tool follows the
 * normal permission flow; any reminder is surfaced on stderr (visible to the user).
 * @param {import('./classify.mjs').Verdict} verdict
 * @param {{ root: string, mode: import('./hook-helpers.mjs').HookMode, event?: string }} opts
 */
export function emitVerdict(verdict, { root, mode, event = "PreToolUse" }) {
  if (verdict.decision === "deny" && verdict.scoreEvent) {
    bumpScore(root, verdict.scoreEvent);
  }
  const applied = helpers.applyHookMode(
    { permission: verdict.decision, agent_message: verdict.agentMessage },
    mode,
  );
  if (applied.permission === "deny") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: "deny",
          permissionDecisionReason:
            applied.agent_message || "Blocked by GitNexus enforcement — use the graph.",
        },
      }),
    );
  } else if (applied.agent_message) {
    process.stderr.write(`${applied.agent_message}\n`);
  }
}

/** Inject additional context (SessionStart / UserPromptSubmit). */
export function emitContext(text, event = "SessionStart") {
  if (!text) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
  );
}
