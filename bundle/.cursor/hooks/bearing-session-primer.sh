#!/usr/bin/env bash
# sessionStart: inject GitNexus workflow + auto-refresh stale index + reset session flags.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
node "$ROOT/.bearing/lib/clear-session.mjs" "$ROOT" 2>/dev/null || true

composer_mode="$(echo "$GITNEXUS_HOOK_INPUT" | node -e "
  let j='{}'; try { j=JSON.parse(require('fs').readFileSync(0,'utf8')); } catch {}
  process.stdout.write(j.composer_mode ?? '');
" 2>/dev/null || true)"

if [[ "$composer_mode" == "ask" ]]; then
  echo '{}'
  exit 0
fi

STALENESS_JSON="$(node "$ROOT/.bearing/lib/check-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
IS_FRESH="$(echo "$STALENESS_JSON" | node -e "
  let j={}; try { j=JSON.parse(require('fs').readFileSync(0,'utf8')); } catch {}
  process.stdout.write(j.fresh === true ? 'true' : 'false');
" <<< "$STALENESS_JSON")"

REFRESH_CONTEXT=""
if [[ "$IS_FRESH" != "true" ]] && [[ "${GITNEXUS_SKIP_SESSION_REFRESH:-}" != "1" ]]; then
  node "$ROOT/.bearing/lib/set-refresh-pending.mjs" "$ROOT" set "$STALENESS_JSON" 2>/dev/null || true
  if node "$ROOT/scripts/gitnexus-agent.mjs" refresh; then
    REFRESH_CONTEXT="GitNexus index was stale at session start — auto-refresh completed (graph + embeddings). Use query/context/impact normally."
    node "$ROOT/.bearing/lib/set-refresh-pending.mjs" "$ROOT" clear 2>/dev/null || true
  else
    node "$ROOT/.bearing/lib/set-refresh-pending.mjs" "$ROOT" set-failed "session auto-refresh failed" 2>/dev/null || true
    REFRESH_CONTEXT="GitNexus index is STALE and auto-refresh failed at session start. Agent MUST run Shell: npm run gitnexus:agent-refresh with required_permissions [\"all\"] as the very next tool call — hooks block Grep/Read/MCP until refresh succeeds or fails again. NEVER tell the user to run npx gitnexus analyze."
  fi
elif [[ "$IS_FRESH" != "true" ]]; then
  REFRESH_CONTEXT="GitNexus index is stale (GITNEXUS_SKIP_SESSION_REFRESH=1). Agent MUST run npm run gitnexus:agent-refresh autonomously before structural edits — never ask the user."
fi

cat <<JSON
{
  "env": {
    "GITNEXUS_REPO": "__GITNEXUS_REPO__",
    "GITNEXUS_WORKFLOW": "context→query→context→impact→detect_changes",
    "GITNEXUS_AGENT_REFRESH": "npm run gitnexus:agent-refresh"
  },
  "additional_context": "GN: graph+embeddings when fresh — query for fuzzy/explore (not graph-only). Refresh if stale or embeddings missing (agent-refresh includes --embeddings). Session: agent-brief OR READ context. ${REFRESH_CONTEXT}"
}
JSON
