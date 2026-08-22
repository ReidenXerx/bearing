#!/usr/bin/env bash
# sessionStart: audit kit health after primer refresh; inject agent health checklist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"

composer_mode="$(echo "$GITNEXUS_HOOK_INPUT" | node -e "
  let j='{}'; try { j=JSON.parse(require('fs').readFileSync(0,'utf8')); } catch {}
  process.stdout.write(j.composer_mode ?? '');
" 2>/dev/null || true)"

if [[ "$composer_mode" == "ask" ]]; then
  echo '{}'
  exit 0
fi

# FAIL OPEN, same as every other hook: with .bearing/lib gone this threw and `set -e` turned the
# missing directory into a failing hook. A briefing we cannot produce is not a reason to fail.
node "$ROOT/.bearing/lib/session-health-context.mjs" "$ROOT" || exit 0
