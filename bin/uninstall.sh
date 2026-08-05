#!/usr/bin/env bash
# Uninstall bearing from a target repo.
# Usage: ./bin/uninstall.sh /path/to/repo [--remove-index]
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  sed -n '2,3p' "$0" | sed 's/^# *//'
  exit 0
fi

shift
exec node "$KIT_ROOT/lib/kit.mjs" uninstall "$TARGET" "$@"
