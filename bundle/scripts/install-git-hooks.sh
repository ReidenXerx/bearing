#!/usr/bin/env bash
# Point this repo at tracked hooks in .githooks/ (run once per clone).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# A STEALTH install deliberately ships no .githooks/ — the hook runs `npm run bearing:full-pdg`,
# and stealth adds no npm scripts, so a wired hook would fail on every commit. Setup called this
# script anyway and `chmod` aborted the whole install (`set -e`) on a file that was never meant to
# exist. Nothing to point at is a reason to stop, not to fail.
if [[ ! -f .githooks/pre-commit ]]; then
  echo "Git hooks: skipped (.githooks/pre-commit not installed in this repo)"
  exit 0
fi

chmod +x .githooks/pre-commit
chmod +x scripts/install-git-hooks.sh scripts/bearing-setup.sh scripts/pack-bearing-teaching.sh 2>/dev/null || true
chmod +x scripts/bearing-teaching/install-from-bundle.sh 2>/dev/null || true
for hook in .cursor/hooks/gitnexus-*.sh; do
  [[ -f "$hook" ]] && chmod +x "$hook"
done

git config core.hooksPath .githooks

echo "Git hooks installed: core.hooksPath=.githooks"
# Name what the hook ACTUALLY runs. It said `bearing:pdg` while .githooks/pre-commit ran
# `bearing:full-pdg` (a --force rebuild) plus `bearing:graph-smoke` — so anyone debugging a slow
# commit was looking for the wrong command.
echo "Pre-commit will run: npm run bearing:full-pdg + bearing:graph-smoke (force rebuild + PDG, then smoke test)"
