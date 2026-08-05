/**
 * Stale index policy — refresh first, classical tools only after refresh fails.
 *
 * Phases:
 *   fresh              — graph trusted; hooks enforce graph-first tools
 *   must_refresh       — stale; deny classical + MCP until agent-refresh runs
 *   classical_fallback — refresh failed OR agent granted a fallback; classical OK with reason
 */
import { isRefreshFailed, isRefreshPending, fallbackGrant } from './session-primer.mjs';

/**
 * @param {object} stale from check-staleness / load-staleness
 * @param {string} root repo root
 */
export function evaluateStalePolicy(stale, root) {
  // Explicit escape hatch: the agent/user declared GitNexus untrustworthy here
  // (`npm run gitnexus:fallback "<why>"`) → classical fallback even on a FRESH index.
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
      'Shell NOW: npm run gitnexus:agent-refresh with required_permissions: ["all"]. ' +
      'Run yourself — never ask the user to run npx gitnexus analyze.'
    );
  }

  if (policy.phase === 'classical_fallback') {
    if (policy.override) {
      const mins = Math.max(1, Math.round(policy.override.remainingMs / 60000));
      const why = policy.override.reason || 'GitNexus distrusted';
      return (
        `CLASSICAL FALLBACK active (${why}) — classical Grep/Read/shell OK for ~${mins} min. ` +
        'Re-confirm with the graph once GitNexus is reliable; ' +
        'end early with npm run gitnexus:fallback:off.'
      );
    }
    return (
      `GN FALLBACK (${detail}): agent-refresh failed or graph unavailable. ` +
      'Classical Grep/Read OK — state why refresh failed in one sentence.'
    );
  }

  return '';
}
