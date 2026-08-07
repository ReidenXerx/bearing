#!/usr/bin/env bash
# Update bearing in a target repo. Reads the runtime from the manifest — pass
# --runtime only to CHANGE it (cursor|zed|claude|both|all, comma-list allowed).
# Fresh clone? The manifest (.bearing/manifest.json) is gitignored, so it's absent and
# update prints "Not installed. Run install first." — use ./bin/install.sh <repo> --runtime <rt> instead.
# Usage: ./bin/update.sh /path/to/repo [--runtime ...] [--full] [--no-setup] [--skip-verify]
#        ./bin/update.sh --all [search-root] [--runtime ...] [--no-setup] [--skip-verify]
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  sed -n '2,7p' "$0" | sed 's/^# *//'
  exit 0
fi

shift
if [[ "$TARGET" == "--all" ]] || [[ "$TARGET" == "--all-installed" ]]; then
  SEARCH_ROOT="${1:-$HOME/Projects}"
  if [[ $# -gt 0 ]]; then shift; fi
  exec node "$KIT_ROOT/lib/kit.mjs" update-all "$SEARCH_ROOT" "$@"
fi

exec node "$KIT_ROOT/lib/kit.mjs" update "$TARGET" "$@"
