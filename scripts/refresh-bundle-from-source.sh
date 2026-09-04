#!/usr/bin/env bash
# Maintainer: re-copy bundle from an already-installed source repo.
# Usage: ./scripts/refresh-bundle-from-source.sh <source-repo-path>
#        GITNEXUS_BUNDLE_SOURCE=/path/to/source ./scripts/refresh-bundle-from-source.sh
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-${GITNEXUS_BUNDLE_SOURCE:-}}"

if [[ -z "$SRC" ]]; then
  echo "Usage: $0 <source-repo-path>" >&2
  echo "Or set GITNEXUS_BUNDLE_SOURCE=/path/to/source" >&2
  exit 2
fi

[[ -d "$SRC/.cursor/hooks" ]] || { echo "Missing source hooks: $SRC" >&2; exit 1; }

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

info "Refreshing bundle from $SRC"

# NOTE: bundle/skills/ and bundle/docs/ are kit-owned sources of truth and are
# NOT derived from $SRC. Never `rm -rf bundle` wholesale — that would wipe the
# canonical skill store (incl. bearing-local) and the team docs. We only
# refresh the subtrees that genuinely come from the source repo.
rm -rf \
  "$KIT_ROOT/bundle/.cursor" \
  "$KIT_ROOT/bundle/.githooks" \
  "$KIT_ROOT/bundle/.vscode" \
  "$KIT_ROOT/bundle/scripts" \
  "$KIT_ROOT/bundle/.gitnexusignore"
mkdir -p "$KIT_ROOT/bundle/.cursor/rules"

cp -a "$SRC/.cursor/rules/"* "$KIT_ROOT/bundle/.cursor/rules/"
cp "$SRC/.cursor/hooks.json" "$KIT_ROOT/bundle/.cursor/"
cp -a "$SRC/.cursor/hooks" "$KIT_ROOT/bundle/.cursor/"
# Skills are NOT copied from $SRC. The shipped store is bundle/skills/ — edit it
# directly. There is no bundle/.claude/skills/ tree anymore.
mkdir -p "$KIT_ROOT/bundle/.githooks" "$KIT_ROOT/bundle/.vscode" "$KIT_ROOT/bundle/scripts/lib" "$KIT_ROOT/bundle/scripts/bearing-teaching" "$KIT_ROOT/bundle/docs"
cp "$SRC/.githooks/pre-commit" "$KIT_ROOT/bundle/.githooks/"
cp "$SRC/.vscode/settings.json" "$KIT_ROOT/bundle/.vscode/"
cp "$SRC/.gitnexusignore" "$KIT_ROOT/bundle/"
for f in gitnexus-setup.sh sync-cursor-bearing-teaching.sh pack-bearing-teaching.sh install-git-hooks.sh gitnexus-agent.mjs run-with-project-tmp.sh clean-project-tmp.sh; do
  cp "$SRC/scripts/$f" "$KIT_ROOT/bundle/scripts/"
done
cp "$SRC/scripts/lib/project-tmp.mjs" "$KIT_ROOT/bundle/scripts/lib/"
cp "$SRC/scripts/bearing-teaching/"* "$KIT_ROOT/bundle/scripts/bearing-teaching/"
# Docs flow ONE WAY: docs/ (current, vendor-neutral) is the source of truth.
# The bundle ships team handouts under bundle/docs/GITNEXUS-*.md, which are
# REGENERATED from docs/ here — never copied back over docs/, and never sourced
# from $SRC (the source repo's docs are stale Cursor-only copies).
#   docs/TEAM-BUNDLE.md -> bundle/docs/GITNEXUS-TEAM-BUNDLE.md
#   docs/SKILLS.md      -> bundle/docs/GITNEXUS-SKILLS.md
# (the Cursor handout that used to live here went with Cursor support)
# no neutral
# twin) and is left as-is.
cp "$KIT_ROOT/docs/TEAM-BUNDLE.md" "$KIT_ROOT/bundle/docs/GITNEXUS-TEAM-BUNDLE.md"
cp "$KIT_ROOT/docs/SKILLS.md" "$KIT_ROOT/bundle/docs/GITNEXUS-SKILLS.md"

# Strip region enforcement from refreshed bundle (kit no longer ships regions)
for f in \
  bundle/.bearing/lib/region-edit-check.mjs \
  bundle/.bearing/lib/region-infer.mjs \
  bundle/.bearing/lib/region-picker-context.mjs \
  bundle/.bearing/lib/region-session.mjs \
  bundle/.bearing/lib/region-user-guide.mjs \
  bundle/docs/AGENT-REGIONS-GUIDE.md \
  bundle/docs/regions.overlay.stub.json \
  bundle/docs/AGENT-PROFILES.stub.md \
  bundle/scripts/bearing-teaching/generate-regions.mjs; do
  rm -rf "$KIT_ROOT/$f" 2>/dev/null || true
done

SOURCE_REPO_NAME="$(basename "$SRC")"
find "$KIT_ROOT/bundle" -type f \( -name '*.mdc' -o -name '*.sh' -o -name '*.mjs' -o -name 'SKILL.md' -o -name '*.md' \) -print0 \
  | xargs -0 sed -i "s/${SOURCE_REPO_NAME}/__GITNEXUS_REPO__/g"

chmod +x "$KIT_ROOT/bundle/scripts/"*.sh "$KIT_ROOT/bundle/.cursor/hooks/"*.sh 2>/dev/null || true

info "Done — run npm test && ./bin/update.sh <target-repo>"
