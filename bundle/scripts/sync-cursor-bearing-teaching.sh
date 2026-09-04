#!/usr/bin/env bash
# Sync the GitNexus teaching bundle into each runtime's skill directory.
# Source of truth: .bearing/skills/ (the canonical store); the per-runtime dirs are symlinks to it.
#
# The FILENAME still says cursor. It is named in .bearing/commands.json, in the generated
# `bearing:sync-teaching` npm script and in user-owned git hooks, so renaming it carries an alias
# obligation (NS-15) and is worth doing on its own, not inside the Cursor removal.
# Run via: npm run bearing:setup (or directly)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Runtime may be zed|claude|codex|both|all or a comma-list. both = zed+claude.
#
# The env var is set by bearing-setup.sh, and by NOTHING ELSE. Defaulting to `both` when it is unset
# therefore turned Cursor checks back on for every other caller — `bearing:agent-refresh` on a
# zed-only install exited 1 on every run with "Missing rule: .cursor/rules/00-bearing-enforcement
# .mdc", after a refresh that had succeeded. The agent is told to run that command autonomously, so
# it read exit 1 as an unusable graph.
#
# The runtime is already RECORDED at install time. Ask the manifest rather than guessing, and keep
# `both` only as the last resort for a pre-manifest install.
runtime_from_manifest() {
  node -p "try{require('./.bearing/manifest.json').runtime||''}catch(e){''}" 2>/dev/null
}
RUNTIME="${GITNEXUS_RUNTIME:-$(runtime_from_manifest)}"
RUNTIME="${RUNTIME:-both}"
wants_claude() { case "$RUNTIME" in *claude*|*both*|*all*) return 0;; esac; return 1; }

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m    !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# The non-lib files this bundle cannot work without. Fixed set, so listed.
HOOK_LIBS=(
  ".bearing/hooks.json"
  "scripts/bearing-agent.mjs"
  "scripts/bearing-gate-hint.mjs"
  "scripts/bearing-teaching/script-gates.mjs"
  "scripts/lib/setup-ui.mjs"
)

# .bearing/lib/*.mjs was a hand-kept list, and it drifted in BOTH directions. Retiring
# `context-pressure.mjs` (NS-19) left this array demanding it, so `bearing update` aborted with
# "Missing hook lib" on every Cursor repo — a failure the USER hit, mid-install. Meanwhile six libs
# that did exist had never been added, so nothing checked they arrived. Check the invariant that
# actually matters instead: every lib something REFERENCES must be present. That covers new files
# for free and stops naming deleted ones.
check_referenced_libs() {
  node - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

// ONLY the files bearing installed. Walking `scripts/` wholesale caught bearing's own maintainer
// script naming historical libs it copies from elsewhere — five "missing" libs and an aborted
// install, in a repo where nothing was wrong. A repo may contain any number of scripts that mention
// a path bearing does not install, and none of them are bearing's business. The manifest records
// exactly what was written; ask it.
const MANIFESTS = ['.bearing/manifest.json', '.gitnexus/agent-kit-manifest.json'];
let files = [];
for (const rel of MANIFESTS) {
  try {
    const owned = JSON.parse(fs.readFileSync(rel, 'utf8')).files;
    if (Array.isArray(owned) && owned.length) {
      files = owned.filter((f) => /\.(mjs|sh|json)$/.test(f) && fs.existsSync(f));
      break;
    }
  } catch {
    /* try the next */
  }
}
if (!files.length) {
  // No manifest yet (first install, mid-flight). Fall back to the directories bearing owns
  // outright — never the repo's own `scripts/`.
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|sh|json)$/.test(e.name)) files.push(full);
    }
  };
  ['.claude/hooks', '.bearing/lib'].forEach(walk);
}

const missing = new Map();
for (const f of files) {
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of text.matchAll(/\.bearing\/lib\/([\w.-]+\.mjs)/g)) {
    const rel = `.bearing/lib/${m[1]}`;
    if (!fs.existsSync(rel) && !missing.has(rel)) missing.set(rel, f);
  }
}
if (missing.size) {
  for (const [lib, referrer] of missing) console.error(`    ! missing ${lib} (named by ${referrer})`);
  process.exit(1);
}
const n = fs.readdirSync('.bearing/lib').filter((f) => f.endsWith('.mjs')).length;
console.log(`    \u001b[1;32m\u2713\u001b[0m ${n} hook libs present, every reference resolves`);
NODE
}


sync_dir() {
  local src="$1"
  local dest="$2"
  local label="$3"

  [[ -d "$src" ]] || fail "Missing teaching source: $src"

  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${src}/" "${dest}/"
  else
    rm -rf "${dest:?}"/*
    cp -a "${src}/." "$dest/"
  fi
  local count
  count="$(find "$dest" -name 'SKILL.md' | wc -l | tr -d ' ')"
  ok "$label → $dest ($count SKILL.md files)"
}

# ── main ─────────────────────────────────────────────────────────────────────

info "Installing bearing teaching bundle (runtime: ${RUNTIME})"

# Four of the five steps here verified CURSOR's own files, and `wants_cursor` matched `all` and
# `both` — so once the bundle stopped shipping `.cursor/`, every setup-enabled install died at
# "[1/5] Cursor rules … Missing rule: .cursor/rules/00-bearing-enforcement.mdc", after the kit files
# had already been written. Nothing caught it because every test in the suite passes runSetup:false
# (NS-21: the least-exercised configuration is the least verified).
for lib in "${HOOK_LIBS[@]}"; do
  [[ -f "$lib" ]] || fail "Missing hook lib: $lib"
done
check_referenced_libs || fail "a hook names a .bearing/lib module that is not installed"

info "  [1/2] Link skills (symlinks from canonical store)"
STORE=".bearing/skills"
if [[ ! -d "$STORE" ]]; then
  fail "Missing $STORE — run 'npx bearing install .' or 'npx bearing update .' first"
fi

link_skills() {
  local dest_root="$1"
  local label="$2"
  [[ -d "$STORE" ]] || return 0
  mkdir -p "$dest_root"
  local count=0
  for dir in "$STORE"/*/; do
    [[ -d "$dir" ]] || continue
    local name
    name="$(basename "$dir")"
    ln -sfn "../../$STORE/$name" "$dest_root/$name"
    count=$((count + 1))
  done
  ok "$label → $dest_root ($count skills symlinked)"
}

# `both` is zed+claude now. It used to be cursor+zed, so the claude arm did not match it — and a
# `both` install got no .claude/skills at all, which is precisely the "module not available in
# Claude Code" report this whole area exists to prevent.
case "$RUNTIME" in *zed*|*both*|*all*)    link_skills ".agents/skills" "Zed skills" ;; esac
case "$RUNTIME" in *claude*|*both*|*all*) link_skills ".claude/skills" "Claude skills" ;; esac

# Drop the volatile GitNexus stats block from AGENTS.md/CLAUDE.md so committed
# agent docs stay stable across machines (the `analyze` tool re-adds it each refresh).
if [[ -f ".bearing/lib/stabilize-agent-docs.mjs" ]]; then
  node .bearing/lib/stabilize-agent-docs.mjs . || true
fi

# Claude is the only runtime that enforces (NS-14), so this smoke test is the last thing standing
# between a dead gate and a user who believes they are protected. It drove Cursor's shell wrapper;
# it drives the Claude hook the way Claude Code does — node, JSON on stdin, CLAUDE_PROJECT_DIR set.
if wants_claude && [[ -f .claude/hooks/bearing-grep-guard.mjs ]]; then
  info "  [2/2] Quick hook smoke test"
  if printf '%s' '{"tool_name":"Grep","tool_input":{"pattern":"handlePayment"}}' \
    | CLAUDE_PROJECT_DIR="$ROOT" node .claude/hooks/bearing-grep-guard.mjs 2>/dev/null \
    | grep -q 'deny'; then
    ok "Symbol-grep block verified"
  else
    warn "Hook smoke test inconclusive — restart Claude Code and re-run bearing:verify"
  fi
fi

echo ""
ok "Teaching bundle v2 installed (enforcement hooks active)"
if wants_claude; then
echo "    Enforcement:   grep/read/edit/bash guards in .claude/hooks (staleness block)"
fi
echo "    Graph imaging: bearing-imaging skill"
echo "    Master skill:  bearing-workspace"
echo "    If blocked:    bearing-enforcement skill"
