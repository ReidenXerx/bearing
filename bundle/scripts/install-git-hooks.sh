#!/usr/bin/env bash
# Point this repo at tracked hooks in .githooks/ (run once per clone).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

chmod +x .githooks/pre-commit
chmod +x scripts/install-git-hooks.sh scripts/bearing-setup.sh scripts/pack-bearing-teaching.sh 2>/dev/null || true
chmod +x scripts/bearing-teaching/install-from-bundle.sh 2>/dev/null || true
for hook in .cursor/hooks/gitnexus-*.sh; do
  [[ -f "$hook" ]] && chmod +x "$hook"
done

git config core.hooksPath .githooks

echo "Git hooks installed: core.hooksPath=.githooks"
echo "Pre-commit will run: npm run bearing:pdg (embeddings + skills + PDG)"
