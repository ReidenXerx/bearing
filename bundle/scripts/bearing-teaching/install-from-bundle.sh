#!/usr/bin/env bash
# Install GitNexus teaching bundle on a target repo (after extracting archive at repo root).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m    !\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Run from a git repo root (extract archive here first)"

REPO_NAME="${GITNEXUS_REPO_NAME:-$(basename "$ROOT")}"

info "Target repo: $REPO_NAME"

if grep -rq '__GITNEXUS_REPO__' .cursor/rules .cursor/hooks .bearing/skills/gitnexus-workspace .bearing/skills/gitnexus-enforcement 2>/dev/null; then
  warn "Bundle still references __GITNEXUS_REPO__ — set GITNEXUS_REPO_NAME and re-run substitution:"
  warn "  GITNEXUS_REPO_NAME=$REPO_NAME bash scripts/bearing-teaching/install-from-bundle.sh"
  if [[ "${GITNEXUS_SKIP_RENAME:-}" != "1" ]]; then
    info "Replacing __GITNEXUS_REPO__ → $REPO_NAME in rules/hooks/skills"
    find .cursor/rules .cursor/hooks .bearing/skills/gitnexus-workspace .bearing/skills/gitnexus-enforcement \
      -type f \( -name '*.mdc' -o -name '*.sh' -o -name '*.mjs' -o -name 'SKILL.md' \) \
      -exec sed -i '' "s/__GITNEXUS_REPO__/$REPO_NAME/g" {} + 2>/dev/null \
      || find .cursor/rules .cursor/hooks .bearing/skills/gitnexus-workspace .bearing/skills/gitnexus-enforcement \
      -type f \( -name '*.mdc' -o -name '*.sh' -o -name '*.mjs' -o -name 'SKILL.md' \) \
      -exec sed -i "s/__GITNEXUS_REPO__/$REPO_NAME/g" {} +
    ok "Repo name substituted"
  fi
fi

if [[ -f scripts/bearing-teaching/merge-package-scripts.mjs ]]; then
  info "Injecting GitNexus npm scripts into package.json"
  GITNEXUS_REPO_NAME="$REPO_NAME" node scripts/bearing-teaching/merge-package-scripts.mjs --write
  ok "package.json updated (bearing:* + hooks:install)"
elif [[ -f package.json.scripts.snippet.json ]]; then
  warn "merge-package-scripts.mjs missing — falling back to snippet merge"
  node <<'NODE'
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const snip = JSON.parse(fs.readFileSync('package.json.scripts.snippet.json', 'utf8'));
pkg.scripts ??= {};
for (const [k, v] of Object.entries(snip.scripts ?? {})) pkg.scripts[k] = v;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('    ✓ Merged scripts from snippet');
NODE
fi

if [[ -f gitignore.snippet ]]; then
  if ! grep -q 'bearing-teaching-bundle' .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    cat gitignore.snippet >> .gitignore
    ok "Appended gitignore.snippet"
  fi
fi

info "Running team setup"
bash scripts/bearing-setup.sh ${GITNEXUS_SETUP_FLAGS:-}

ok "Install complete — restart Cursor"
