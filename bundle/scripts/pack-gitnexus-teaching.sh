#!/usr/bin/env bash
# Pack portable GitNexus + Cursor teaching bundle for other repos (tar.gz archive).
#
# Usage:
#   npm run bearing:pack
#   npm run bearing:pack -- --output /tmp/my-bundle.tar.gz
#
# Teammates on another project:
#   tar -xzf gitnexus-cursor-teaching-*.tar.gz -C /path/to/their-repo
#   cd /path/to/their-repo && bash scripts/bearing-teaching/install-from-bundle.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output|-o) OUTPUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
VERSION="$(node -e "
  const fs=require('fs');
  const p='.cursor/bearing-teaching-bundle.json';
  if(fs.existsSync(p)){console.log(JSON.parse(fs.readFileSync(p,'utf8')).version||2)}else{console.log(2)}
")"
BASENAME="gitnexus-cursor-teaching-v${VERSION}-${STAMP}"
WORKDIR="$(mktemp -d)"
BUNDLE_ROOT="$WORKDIR/$BASENAME"
ARCHIVE="${OUTPUT:-$ROOT/${BASENAME}.tar.gz}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }

# Paths relative to repo root — keep in sync with scripts/bearing-setup.sh TEACHING_SOURCES
BUNDLE_PATHS=(
  .cursor/rules/00-gitnexus-enforcement.mdc
  .cursor/rules/gitnexus.mdc
  .cursor/rules/gitnexus-first.mdc
  .cursor/hooks.json
  .cursor/hooks/bearing-session-primer.sh
  .cursor/hooks/bearing-session-health.sh
  .cursor/hooks/bearing-session-health-user.sh
  .cursor/hooks/bearing-prompt-router.sh
  .cursor/hooks/bearing-grep-guard.sh
  .cursor/hooks/bearing-read-guard.sh
  .cursor/hooks/bearing-edit-guard.sh
  .cursor/hooks/bearing-shell-staleness-guard.sh
  .cursor/hooks/bearing-shell-allowlist.sh
  .cursor/hooks/bearing-commit-guard.sh
  .cursor/hooks/bearing-mcp-allowlist.sh
  .cursor/hooks/bearing-after-git-commit.sh
  .bearing/lib/check-staleness.mjs
  .bearing/lib/load-staleness.mjs
  .bearing/lib/classify.mjs
  .bearing/lib/cursor-emit.mjs
  .bearing/lib/claude-emit.mjs
  .bearing/lib/session-primer.mjs
  .bearing/lib/context-pressure.mjs
  .bearing/lib/first-nudge.mjs
  .bearing/lib/clear-session.mjs
  .bearing/lib/set-refresh-pending.mjs
  .bearing/lib/hook-helpers.mjs
  .bearing/lib/cypher-helpers.mjs
  .bearing/lib/rename-helpers.mjs
  .bearing/lib/stale-policy.mjs
  .bearing/lib/cypher-cli.mjs
  .bearing/lib/generate-arch-doc.mjs
  .bearing/lib/stabilize-agent-docs.mjs
  .bearing/lib/commit-message.mjs
  .bearing/lib/detect-api-router.mjs
  .bearing/lib/graph-smoke.mjs
  .bearing/lib/agent-brief.mjs
  .bearing/lib/agent-health.mjs
  .bearing/lib/session-health-audit.mjs
  .bearing/lib/session-health-context.mjs
  .bearing/lib/verify-kit.mjs
  .bearing/gitnexus-hooks.json
  scripts/bearing-verify.mjs
  scripts/bearing-setup.sh
  scripts/sync-cursor-bearing-teaching.sh
  scripts/pack-bearing-teaching.sh
  scripts/install-git-hooks.sh
  scripts/bearing-agent.mjs
  scripts/bearing-ci.mjs
  scripts/bearing-gate-hint.mjs
  scripts/run-with-project-tmp.sh
  scripts/clean-project-tmp.sh
  scripts/lib/project-tmp.mjs
  scripts/lib/setup-ui.mjs
  scripts/bearing-teaching/install-from-bundle.sh
  scripts/bearing-teaching/merge-package-scripts.mjs
  scripts/bearing-teaching/script-gates.mjs
  docs/GITNEXUS-TEAM-BUNDLE.md
  docs/GITNEXUS-CURSOR-GUIDE.md
  .github/workflows/gitnexus-ci.yml
  .gitnexusignore
  skills
)

info "Packing GitNexus Cursor teaching bundle v${VERSION}"

for rel in "${BUNDLE_PATHS[@]}"; do
  [[ -e "$rel" ]] || { echo "Missing bundle file: $rel" >&2; exit 1; }
  mkdir -p "$BUNDLE_ROOT/$(dirname "$rel")"
  if [[ -d "$rel" ]]; then
    rsync -a "$rel/" "$BUNDLE_ROOT/$rel/"
  else
    cp -a "$rel" "$BUNDLE_ROOT/$rel"
  fi
done

# package.json scripts snippet (generated from canonical merge script)
node scripts/bearing-teaching/merge-package-scripts.mjs --snippet > "$BUNDLE_ROOT/package.json.scripts.snippet.json"

# gitignore snippet
cat > "$BUNDLE_ROOT/gitignore.snippet" <<'SNIP'
# GitNexus + gitnexus-agent-kit generated local state (safe to remove via gn-agent-kit uninstall)
.gitnexus/
.gitnexus/agent-kit/
.tmp-agent/
.cursor/skills/
.agents/skills/
.cursor/bearing-teaching-bundle.json
.cursor/gn-kit-manifest.json
.gitnexus/agent-kit-manifest.json
.bearing/.bearing-session-edits.flag
.bearing/.bearing-session-primed.flag
.bearing/.gitnexus-prompt-hint.json
.bearing/.gitnexus-refresh-pending.flag
.bearing/.gitnexus-refresh-failed.flag
.bearing/.gitnexus-mcp-used.flag
.bearing/.gitnexus-impact-used.flag
.bearing/.gitnexus-detect-used.flag
.bearing/.gitnexus-staleness-cache.json
.bearing/.gitnexus-scorecard.json
.bearing/.gitnexus-deny-cache.json
.bearing/.bearing-session-health.json
.bearing/.bearing-session-user-notified.flag
.cursor/gitnexus-api-profile.json
SNIP

node <<NODE > "$BUNDLE_ROOT/MANIFEST.json"
const fs = require('fs');
const manifest = {
  bundle: 'gitnexus-cursor-teaching',
  version: ${VERSION},
  packedAt: new Date().toISOString(),
  sourceRepo: '__GITNEXUS_REPO__',
  files: $(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "${BUNDLE_PATHS[@]}" "package.json.scripts.snippet.json" "gitignore.snippet" "MANIFEST.json"),
  notes: [
    'Project-specific: replace __GITNEXUS_REPO__ with target repo name in rules/hooks/skills',
    'Run scripts/bearing-teaching/install-from-bundle.sh after extracting',
    'Area skills (.claude/skills/generated) are NOT bundled — created by bearing:refresh on target repo',
  ],
};
console.log(JSON.stringify(manifest, null, 2));
NODE

chmod +x "$BUNDLE_ROOT"/scripts/*.sh "$BUNDLE_ROOT"/.cursor/hooks/*.sh 2>/dev/null || true

tar -czf "$ARCHIVE" -C "$WORKDIR" "$BASENAME"
rm -rf "$WORKDIR"

ok "Created $ARCHIVE"
echo ""
echo "Send to teammates:"
echo "  tar -xzf $(basename "$ARCHIVE") -C /path/to/their-repo --strip-components=1"
echo "  cd /path/to/their-repo && bash scripts/bearing-teaching/install-from-bundle.sh"
echo ""
echo "See docs/GITNEXUS-TEAM-BUNDLE.md inside the archive."
