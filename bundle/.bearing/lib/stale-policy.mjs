/**
 * Stale index policy — refresh first, classical tools only after refresh fails.
 *
 * Phases:
 *   fresh              — graph trusted; hooks enforce graph-first tools
 *   must_refresh       — stale; deny classical + MCP until agent-refresh runs
 *   classical_fallback — refresh failed OR agent granted a fallback; classical OK with reason
 */
import { isRefreshFailed, isRefreshPending, fallbackGrant } from './session-primer.mjs';
import { howToRun } from './how-to-run.mjs';
import { loadHookConfig } from './hook-helpers.mjs';

/**
 * @param {object} stale from check-staleness / load-staleness
 * @param {string} root repo root
 */
/** Ways OUT of a block. A blocked session could not discover either, so a failing analyze looked
 * like a dead end. Kept short so it does not bury the primary instruction. */
export const ESCAPE_HINT =
  ` If GitNexus itself is wrong/unavailable: \`${howToRun('bearing:fallback')} -- "<why>"\` (bounded, logged). To downgrade blocks to warnings: set "mode":"guide" in .bearing/hooks.json.`;

export function evaluateStalePolicy(stale, root) {
  // THE GRANT IS CHECKED FIRST, and the order is the whole point. It used to sit BELOW the
  // staleness-gate-off branch, which returns early whenever the index is not fresh — the default
  // configuration and the common case. So `bearing:fallback` wrote its grant, printed "GRANTED for
  // ~15 min", and was never read: on any repo even one commit behind, the escape hatch NS-6
  // promises did nothing, silently. An explicit human override outranks every automatic phase
  // decision, so it is evaluated before all of them.
  // Explicit escape hatch: the agent/user declared GitNexus untrustworthy here
  // (`npm run bearing:fallback "<why>"`) → classical fallback even on a FRESH index.
  // Bounded (auto-expires), logged, and surfaced so it can't be a silent bypass.
  const grant = fallbackGrant(root);
  if (grant) {
    return {
      phase: 'classical_fallback',
      forceRefresh: false,
      allowClassical: true,
      allowGraphTools: true,
      override: grant,
    };
  }

  // STALENESS GATE OFF (the default). A stale index no longer denies anything: it is reported, the
  // graph still refreshes on commit and on demand, and the agent is not ordered to rebuild mid-task.
  //
  // Every must_refresh denial in the codebase flows from this function, so one branch retires all of
  // them. Enforcement that is NOT about staleness — graph-first search, impact-before-edit — is
  // untouched, because none of it depends on this phase being `must_refresh`.
  if (!stale?.fresh && loadHookConfig(root).stalenessGate !== "block") {
    return {
      phase: "fresh",
      forceRefresh: false,
      allowClassical: false,
      allowGraphTools: true,
      staleNote: stale?.detail || null,
      gateOff: true,
    };
  }

  if (stale?.fresh) {
    return {
      phase: 'fresh',
      forceRefresh: false,
      allowClassical: false,
      allowGraphTools: true,
    };
  }

  if (isRefreshFailed(root)) {
    return {
      phase: 'classical_fallback',
      forceRefresh: false,
      allowClassical: true,
      allowGraphTools: true,
    };
  }

  // A SMALL, measured gap: fewer source files behind HEAD than the drift threshold. The graph is
  // wrong about a handful of files, not structurally invalid, so the proportionate response is the
  // one the drift path already makes — distrust the graph, not the rest of the toolbox. Placed after
  // the refresh-failed check so a failed refresh still yields the full fallback.
  if (stale?.softBehind) {
    return {
      phase: 'graph_behind',
      forceRefresh: false,
      allowClassical: true,
      allowGraphTools: false,
      behindFiles: stale.behindFiles,
    };
  }

  return {
    phase: 'must_refresh',
    forceRefresh: true,
    allowClassical: false,
    allowGraphTools: false,
    refreshPending: isRefreshPending(root),
  };
}

/**
 * @param {object} stale
 * @param {ReturnType<typeof evaluateStalePolicy>} policy
 */
export function staleRefreshAgentMessage(stale, policy) {
  const detail = stale?.detail || stale?.reason || 'index not fresh';

  if (policy.phase === 'must_refresh') {
    const pending = policy.refreshPending ? ' Session auto-refresh did not complete.' : '';
    return (
      `STALE INDEX (${detail}) — mandatory refresh BEFORE Grep/Read/MCP/shell.${pending} ` +
      `Shell NOW: ${howToRun('bearing:agent-refresh')} with required_permissions: ["all"]. ` +
      // Names NO raw indexer command. This read "Run yourself — never ask the user to run npx
      // gitnexus analyze", where the only concrete command in the sentence was the one it meant to
      // FORBID — so an agent read it as the instruction and ran `npx gitnexus analyze`, which also
      // reintroduces the npx invocation the command resolver exists to avoid.
      'Run it yourself; do not hand the refresh to the user, and do not call the indexer directly.'
    );
  }

  if (policy.phase === 'classical_fallback') {
    if (policy.override) {
      const mins = Math.max(1, Math.round(policy.override.remainingMs / 60000));
      const why = policy.override.reason || 'GitNexus distrusted';
      return (
        `CLASSICAL FALLBACK active (${why}) — classical Grep/Read/shell OK for ~${mins} min. ` +
        'Re-confirm with the graph once GitNexus is reliable; ' +
        `end early with ${howToRun('bearing:fallback:off')}.`
      );
    }
    return (
      `GN FALLBACK (${detail}): agent-refresh failed or graph unavailable. ` +
      'Classical Grep/Read OK — state why refresh failed in one sentence.'
    );
  }

  return '';
}
