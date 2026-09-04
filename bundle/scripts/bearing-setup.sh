#!/usr/bin/env bash
# __GITNEXUS_REPO__ — all-in-one GitNexus teaching + git hooks team installer.
#
# Installs:
#   • Teaching bundle (skills sync, manifest)
#   • GitNexus MCP (project + optional global)
#   • Git pre-commit PDG index refresh (no personal tooling)
#   • Knowledge graph index
#
# Run once after cloning:
#   npm run bearing:setup
#
# Options:
#   --quick           Hooks + teaching + MCP only; skip index build
#   --full            Force full re-index (--force)
#   --skip-index      Same as --quick for index step
#   --skip-global-mcp Accepted and ignored — the global step was Cursor-only
#   -h, --help        Show usage
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# WHICH gitnexus this repo runs. Pinning it to `npx -y gitnexus@latest` here meant setup used the
# published analyzer even on a machine with a local build or a global install — a different program
# from the one every other bearing command uses, reporting the same version string. Ask the repo's
# own resolver (recorded choice → installed binary → npx), falling back only if it is missing.
if [[ -f .bearing/lib/gitnexus-cmd.mjs ]]; then
  read -r -a GITNEXUS_CLI <<<"$(node .bearing/lib/gitnexus-cmd.mjs 2>/dev/null || echo 'npx -y gitnexus@latest')"
else
  GITNEXUS_CLI=(npx -y gitnexus@latest)
fi
SKIP_INDEX=false
FULL_INDEX=false
SKIP_GLOBAL_MCP=false
GITNEXUS_RUNTIME="${GITNEXUS_RUNTIME:-both}"

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  echo ""
  echo "Examples:"
  echo "  npm run bearing:setup              # full team onboarding (recommended)"
  echo "  npm run bearing:setup -- --quick   # teaching + hooks/MCP, skip index"
  echo "  npm run bearing:setup -- --full    # force full graph rebuild"
  echo ""
  echo "Re-sync teaching only (after pulling rule/skill updates):"
  echo "  npm run bearing:pack             # tar.gz for other projects"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick|--skip-index) SKIP_INDEX=true ;;
    --full) FULL_INDEX=true ;;
    --skip-global-mcp) SKIP_GLOBAL_MCP=true ;;
    --runtime)
      GITNEXUS_RUNTIME="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

export GITNEXUS_RUNTIME

# Runtime membership — GITNEXUS_RUNTIME may be zed|claude|codex|both|all or a
# comma-list (e.g. "zed,claude"). both = zed+claude; all = every adapter.
wants_zed()    { case "$GITNEXUS_RUNTIME" in *zed*|*both*|*all*)    return 0;; esac; return 1; }
wants_claude() { case "$GITNEXUS_RUNTIME" in *claude*|*all*)        return 0;; esac; return 1; }

# Stealth installs put bearing in someone else's repo without touching a tracked file. Read the
# mode from the manifest — the only record of it — rather than guessing from what is on disk.
is_stealth() { [[ "$(node -p "try{require('./.bearing/manifest.json').stealth===true}catch(e){false}" 2>/dev/null)" == "true" ]]; }

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m    !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing: $1"; }
require_file() { [[ -f "$1" ]] || fail "Missing: $1"; }

semver_ge() {
  node -e "
    const p = v => v.replace(/^v/, '').split('.').map(n => +n || 0);
    const a = p(process.argv[1]), b = p(process.argv[2]);
    for (let i = 0; i < 3; i++) { if (a[i] > b[i]) process.exit(0); if (a[i] < b[i]) process.exit(1); }
    process.exit(0);
  " "$1" "$2"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  __GITNEXUS_REPO__ — GitNexus team setup                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. prerequisites ─────────────────────────────────────────────────────────

info "Checking prerequisites"
require_cmd git
require_cmd node
require_cmd npm
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not a git repo"
NODE_VERSION="$(node -p "process.versions.node")"
semver_ge "$NODE_VERSION" "22.9.0" || fail "Node >= 22.9.0 required (found $NODE_VERSION)"
ok "Node.js $NODE_VERSION"

# ── 2. npm scripts (auto-inject / update bearing:* commands) ─────────────────

if is_stealth; then
  info "Skipping npm scripts (stealth install — package.json stays untouched)"
else
  info "Ensuring GitNexus npm scripts in package.json"
  node scripts/bearing-teaching/merge-package-scripts.mjs --write
  ok "package.json bearing:* scripts injected"
fi

# ── 3. verify teaching sources (committed in repo) ───────────────────────────

info "Verifying GitNexus teaching sources"

CORE_SOURCES=(
  "scripts/bearing-setup.sh"
  "scripts/sync-cursor-bearing-teaching.sh"
  "scripts/install-git-hooks.sh"
  "scripts/bearing-verify.mjs"
  "scripts/bearing-agent.mjs"
  "scripts/bearing-gate-hint.mjs"
  "scripts/bearing-teaching/script-gates.mjs"
  "scripts/lib/setup-ui.mjs"
  ".bearing/skills/bearing-workspace/SKILL.md"
  ".bearing/skills/bearing-enforcement/SKILL.md"
)

# These two moved out of the Cursor list rather than going with it: they are shared hook libs,
# shipped for every runtime, and nothing else required them.
CORE_LIB_SOURCES=(
  ".bearing/lib/hook-helpers.mjs"
  ".bearing/lib/stale-policy.mjs"
)

ZED_SOURCES=(
  ".zed/settings.json"
  "AGENTS.md"
)

# Stealth delivers the SAME teaching through different files, because the ordinary ones are tracked
# and writing them is the leak the mode exists to avoid:
#   settings.json     → settings.local.json  (personal, Claude Code reads both)
#   CLAUDE.md         → .bearing/contract.md (injected per session by the SessionStart hook)
#   .mcp.json         → skipped entirely when it is tracked
# Demanding the ordinary names killed `bearing update` on stealth repos at step 3, with every kit
# file already written. It only ever *appeared* to work on repos that happened to have their own
# CLAUDE.md — a coincidence, not a check.
if is_stealth; then
  CLAUDE_SOURCES=(
    ".claude/settings.local.json"
    ".bearing/contract.md"
    ".bearing/lib/classify.mjs"
  )
else
  CLAUDE_SOURCES=(
    ".mcp.json"
    ".claude/settings.json"
    "CLAUDE.md"
    ".bearing/lib/classify.mjs"
  )
fi

for f in "${CORE_SOURCES[@]}"; do require_file "$f"; done
for f in "${CORE_LIB_SOURCES[@]}"; do require_file "$f"; done
if wants_zed;    then for f in "${ZED_SOURCES[@]}";    do require_file "$f"; done; fi
if wants_claude; then for f in "${CLAUDE_SOURCES[@]}"; do require_file "$f"; done; fi
ok "Teaching sources OK (runtime: ${GITNEXUS_RUNTIME})"

# ── 4. teaching bundle (skills symlinks + manifest) ─────────────────────────

info "Sync skills + teaching manifest (runtime: ${GITNEXUS_RUNTIME})"
chmod +x scripts/sync-cursor-bearing-teaching.sh scripts/bearing-setup.sh
bash scripts/sync-cursor-bearing-teaching.sh

# Steps 4b (the .cursor/mcp.json entry) and 5 (the global ~/.cursor/mcp.json setup) are gone with
# Cursor. Claude's MCP entry is written by its adapter into .mcp.json at install time, and zed's
# into .zed/settings.json — neither needs a step here. `--skip-global-mcp` still parses so an
# existing caller keeps working (NS-15); it now controls nothing.

# ── 6. git hooks (GitNexus refresh only — no personal tooling) ─────────────────

if is_stealth; then
  info "Skipping git hooks (stealth install — no .githooks/, and no npm scripts for it to call)"
else
  info "Installing git hooks"
  bash scripts/install-git-hooks.sh
fi

# ── 7. knowledge graph index ─────────────────────────────────────────────────

if [[ "$SKIP_INDEX" == true ]]; then
  warn "Skipping index (--quick) — run npm run bearing:refresh before using graph tools"
else
  if [[ "$FULL_INDEX" == true ]]; then
    info "Full index rebuild (may take several minutes)"
    npm run bearing:full
  else
    info "Incremental index (embeddings + area skills)"
    npm run bearing:refresh
  fi
  ok "Knowledge graph indexed"

  info "Detecting HTTP router profile (Express vs custom)"
  npm run bearing:detect-api 2>/dev/null && ok "API router profile written" || warn "API profile detection skipped"

  info "Graph smoke test (Cypher / ACCESSES)"
  npm run bearing:graph-smoke 2>/dev/null && ok "Graph smoke passed" || warn "Graph smoke failed — check index"

  # Re-sync generated area skills produced by analyze --skills
  info "Re-syncing area skills after index"
  bash scripts/sync-cursor-bearing-teaching.sh
fi

# ── 8. verify ─────────────────────────────────────────────────────────────────

info "Full kit verification"
if npm run bearing:verify 2>/dev/null; then
  ok "Kit verification passed"
else
  warn "Verification reported issues — run npm run bearing:verify after fixing"
fi

# ── 9. onboarding ─────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Setup complete                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
cat <<'ONBOARD'

  GitNexus is now your agent's code brain — with enforcement on Claude Code.

  ✓ Graph + embeddings indexed (or run bearing:agent-refresh after --quick)
  ✓ Hooks block grep-first habits when the graph is fresh (Claude Code only)
  ✓ Agent refreshes the index autonomously when stale

  NEXT STEPS
  ──────────
  1. RESTART YOUR EDITOR on this project (MCP + hooks load on restart)
  2. Open a new Agent chat and describe your task
  3. Share docs/GITNEXUS-TEAM-BUNDLE.md with your team

  Quick check:  npm run bearing:health
  Full audit:   npm run bearing:verify
  Gate docs:    npm run bearing.__gate.1.session

  When hooks redirect the agent (grep/read blocked), that is expected —
  GitNexus is enforcing graph-first reasoning.

  ── Maintainer details ────────────────────────────────────────

  Agent workflow (enforced):
    query → context → cypher (structural) → impact → detect_changes

  Daily commands:
    npm run bearing:health          human-friendly status
    npm run bearing:agent-brief     session orientation (agents)
    npm run bearing:agent-status    staleness (agents)
    npm run bearing:agent-refresh   re-index when stale
    npm run bearing:sync-teaching   after pulling kit updates

  Hooks DENY (when fresh): symbol Grep, SemanticSearch, broad Glob, large Read
  Hooks ALLOW: gitnexus npm scripts (agent refresh pre-approved)
  MCP: gitnexus in .mcp.json (Claude) / .zed/settings.json (Zed) · pre-commit → bearing:pdg

ONBOARD
echo ""
