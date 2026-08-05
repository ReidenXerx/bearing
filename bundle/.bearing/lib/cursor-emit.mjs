#!/usr/bin/env node
/**
 * Cursor-protocol adapter: maps a vendor-neutral {@link import('./classify.mjs').Verdict}
 * onto Cursor's hook wire format and prints it. This is the ONLY place that knows
 * Cursor's `permission`/`agent_message`/`user_message` shape + guide-mode + nudges,
 * so the guard `.sh` files stay thin and the policy lives in classify.mjs.
 */
import * as helpers from "./hook-helpers.mjs";
import { appendNudge, bumpScore } from "./session-primer.mjs";

/**
 * @param {import('./classify.mjs').Verdict} verdict
 * @param {{ root: string, mode: import('./hook-helpers.mjs').HookMode, nudge?: string }} opts
 */
export function emitVerdict(verdict, { root, mode, nudge = "" }) {
  if (verdict.decision === "deny" && verdict.scoreEvent) {
    bumpScore(root, verdict.scoreEvent);
  }
  const user_message = verdict.userKey
    ? helpers.userMessage(verdict.userKey, verdict.userVars || {})
    : verdict.userMessageText;
  const applied = helpers.applyHookMode(
    {
      permission: verdict.decision,
      agent_message: verdict.agentMessage,
      user_message,
    },
    mode,
  );
  if (applied.agent_message && nudge) {
    applied.agent_message = appendNudge(applied.agent_message, nudge);
  }
  process.stdout.write(JSON.stringify(applied));
}
