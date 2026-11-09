#!/usr/bin/env bash
# Install bearing into a target git repo (interactive if no path given).
# Usage: ./bin/install.sh [/path/to/repo] [--runtime claude|zed|codex|all] [--features ...] [--quick] [--no-setup]
#   runtime: claude · zed · codex · all (=claude+zed+codex) · comma-list e.g. zed,claude
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "--interactive" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  if [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
    sed -n '2,4p' "$0" | sed 's/^# *//'
    echo ""
    echo "Examples:"
    echo "  $0                              # interactive (pick runtime, modules + repo path)"
    echo "  $0 --interactive                # interactive"
    echo "  $0 ../my-service"
    echo "  $0 ../my-app --runtime all              # Claude Code + Zed + Codex"
    echo "  $0 ../my-app --runtime claude --no-setup"
    echo "  $0 ../my-app --runtime claude --features +gitnexus --repo-name my-app"
    exit 0
  fi
  exec node "$KIT_ROOT/lib/interactive.mjs"
fi

shift
exec node "$KIT_ROOT/lib/kit.mjs" install "$TARGET" "$@"
