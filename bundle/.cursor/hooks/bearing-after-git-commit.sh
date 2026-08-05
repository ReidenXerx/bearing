#!/bin/bash
# After git commit/merge/amend: remind agent to verify index + run detect_changes if needed.
# Does not block — informational only.

input=$(cat)

if echo "$input" | grep -qE '"command"[[:space:]]*:[[:space:]]*"git[[:space:]]+(commit|merge|rebase|cherry-pick|pull)'; then
  cat <<'JSON'
{
  "additional_context": "Git commit/merge detected. If hooks ran, GitNexus index should be fresh with PDG. If stale or hooks were skipped (--no-verify): agent MUST run npm run gitnexus:agent-refresh autonomously (Shell, required_permissions all) — never tell the user to run analyze. Before the next commit: gitnexus_detect_changes."
}
JSON
  exit 0
fi

if echo "$input" | grep -qE '"command"[[:space:]]*:[[:space:]]*"git[[:space:]]+commit[[:space:]]+--amend'; then
  cat <<'JSON'
{
  "additional_context": "Git commit --amend detected. Agent MUST verify index freshness and run npm run gitnexus:agent-refresh autonomously if stale — never ask the user to run analyze."
}
JSON
  exit 0
fi

echo '{}'
exit 0
