#!/usr/bin/env node
/**
 * Claude Code hook-protocol adapter: read a hook's stdin payload, and inject context.
 *
 * This used to also map a guard's verdict onto PreToolUse's permission JSON and build the
 * staleness/policy context the GitNexus gates read. The gates are retired (NS-25, NS-28), and with
 * them went this module's imports of the classifier and the stale policy — which, because this file
 * is CORE, had shipped graph code to every install, including the ones that declined the graph
 * (NS-2, NS-13).
 */

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

/** Inject additional context (SessionStart / UserPromptSubmit / PreToolUse / PostToolUse). */
export function emitContext(text, event = "SessionStart") {
  if (!text) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
  );
}
