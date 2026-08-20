#!/usr/bin/env bash
# Sync GitNexus teaching bundle into Cursor-native paths (.cursor/skills).
# Source of truth: .bearing/skills/ + .cursor/rules/ + .cursor/hooks/
# Run via: npm run bearing:setup (or directly)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Runtime may be cursor|zed|claude|both|all or a comma-list. both = cursor+zed.
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
wants_cursor() { case "$RUNTIME" in *cursor*|*both*|*all*) return 0;; esac; return 1; }

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m    !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

HOOK_SCRIPTS=(
  ".cursor/hooks/bearing-session-primer.sh"
  ".cursor/hooks/bearing-session-health.sh"
  ".cursor/hooks/bearing-session-health-user.sh"
  ".cursor/hooks/bearing-prompt-router.sh"
  ".cursor/hooks/bearing-grep-guard.sh"
  ".cursor/hooks/bearing-read-guard.sh"
  ".cursor/hooks/bearing-edit-guard.sh"
  ".cursor/hooks/bearing-shell-staleness-guard.sh"
  ".cursor/hooks/bearing-shell-allowlist.sh"
  ".cursor/hooks/bearing-commit-guard.sh"
  ".cursor/hooks/bearing-mcp-allowlist.sh"
  ".cursor/hooks/bearing-after-git-commit.sh"
)

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

const scan = ['.cursor/hooks', '.claude/hooks', '.bearing/lib', 'scripts'];
const files = [];
const walk = (d) => {
  let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(mjs|sh|json)$/.test(e.name)) files.push(full);
  }
};
scan.forEach(walk);

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

verify_always_apply_rule() {
  local rule="$1"
  [[ -f "$rule" ]] || fail "Missing rule: $rule"
  grep -q 'alwaysApply: true' "$rule" \
    || fail "$rule must have 'alwaysApply: true' in frontmatter"
  ok "Rule active: $rule"
}

verify_hooks_json() {
  node <<'NODE'
import fs from 'node:fs';

const hooksPath = '.cursor/hooks.json';
const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
const h = hooks.hooks ?? {};

const checks = [
  ['sessionStart', 'bearing-session-primer'],
  ['sessionStart', 'bearing-session-health'],
  ['beforeSubmitPrompt', 'bearing-session-health-user'],
  ['beforeSubmitPrompt', 'bearing-prompt-router'],
  ['preToolUse', 'bearing-shell-staleness-guard'],
  ['preToolUse', 'bearing-grep-guard'],
  ['preToolUse', 'bearing-read-guard'],
  ['preToolUse', 'bearing-edit-guard'],
  ['beforeShellExecution', 'bearing-shell-allowlist'],
  ['beforeShellExecution', 'bearing-commit-guard'],
  ['beforeMCPExecution', 'bearing-mcp-allowlist'],
  ['afterShellExecution', 'bearing-after-git-commit'],
];

for (const [event, needle] of checks) {
  const list = h[event] ?? [];
  if (!list.some(x => (x.command ?? '').includes(needle))) {
    console.error(`    ! hooks.json missing ${event} → ${needle}`);
    process.exit(1);
  }
}
console.log('    ✓ hooks.json: session + prompt router + guards + shell/mcp allowlist');
NODE
}

write_manifest() {
  node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

function listSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map(d => d.name)
    .sort();
}

const manifest = {
  bundle: '__GITNEXUS_REPO__-gitnexus-cursor-teaching',
  version: 2,
  installedAt: new Date().toISOString(),
  repo: '__GITNEXUS_REPO__',
  enforcement: {
    blockedTools: ['Grep(symbols)', 'Grep(fields→cypher)', 'SemanticSearch', 'Glob(broad src)', 'Read(large src, no offset)'],
    gates: ['session status/refresh', 'session health', 'prompt architecture router', 'query/context explore', 'cypher structural', 'staleness pre-edit', 'impact pre-edit', 'detect_changes pre-done'],
    hookScripts: [
      'bearing-session-primer.sh',
      'bearing-session-health.sh',
      'bearing-session-health-user.sh',
      'bearing-prompt-router.sh',
      'bearing-shell-staleness-guard.sh',
      'bearing-grep-guard.sh',
      'bearing-read-guard.sh',
      'bearing-edit-guard.sh',
      'bearing-shell-allowlist.sh',
      'bearing-commit-guard.sh',
      'bearing-mcp-allowlist.sh',
      'bearing-after-git-commit.sh',
    ],
    agentCli: ['npm run bearing:agent-status', 'npm run bearing:agent-refresh'],
  },
  components: {
    rules: [
      '.cursor/rules/00-bearing-enforcement.mdc',
      '.cursor/rules/bearing.mdc',
      '.cursor/rules/bearing-first.mdc',
    ],
    hooks: '.cursor/hooks.json',
    mcp: '.cursor/mcp.json',
    masterSkill: '.agents/skills/bearing-workspace/SKILL.md',
    enforcementSkill: '.agents/skills/bearing-enforcement/SKILL.md',
    gitnexusSkills: listSkills('.bearing/skills').filter((n) => n.startsWith('gitnexus-')),
    generatedAreaSkills: listSkills('.cursor/skills/generated'),
  },
  workflowChain: [
    'READ bearing://repo/__GITNEXUS_REPO__/context',
    'READ bearing://repo/__GITNEXUS_REPO__/schema',
    'query({query, task_context, goal})',
    'context({name|uid})',
    'cypher({query, params})',
    'impact({target, direction: upstream})',
    'detect_changes({scope})',
  ],
};

fs.mkdirSync('.cursor', { recursive: true });
fs.writeFileSync(
  '.cursor/bearing-teaching-bundle.json',
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log('    ✓ Wrote .cursor/bearing-teaching-bundle.json (v2 enforcement)');
NODE
}

# ── main ─────────────────────────────────────────────────────────────────────

info "Installing GitNexus agent kit teaching bundle (runtime: ${RUNTIME})"

# Steps 1, 2, 4 and 5 verify CURSOR's own files. They were unconditional, so a `--runtime claude`
# repo — which is never given a `.cursor/` directory — failed here with "Missing rule:
# .cursor/rules/00-bearing-enforcement.mdc" after the install had already written everything. Only
# an all-runtimes repo has these, so only an all-runtimes repo should be asked for them.
if wants_cursor; then
  info "  [1/5] Cursor rules (single always-on contract)"
  verify_always_apply_rule ".cursor/rules/00-bearing-enforcement.mdc"
  for ref_rule in ".cursor/rules/bearing.mdc" ".cursor/rules/bearing-first.mdc"; do
    [[ -f "$ref_rule" ]] || fail "Missing rule: $ref_rule"
    ok "Reference rule present: $ref_rule (load on demand)"
  done

  info "  [2/5] Cursor agent hooks (blocking guards)"
  verify_hooks_json
  for script in "${HOOK_SCRIPTS[@]}"; do
    [[ -f "$script" ]] || fail "Missing hook: $script"
    chmod +x "$script"
  done
  for lib in "${HOOK_LIBS[@]}"; do
    [[ -f "$lib" ]] || fail "Missing hook lib: $lib"
  done
  ok "${#HOOK_SCRIPTS[@]} hook scripts + support files ready"
else
  info "  [1-2/5] Cursor rules + hooks skipped (runtime: $RUNTIME)"
fi

# Not Cursor-specific: every runtime's hooks import from .bearing/lib.
check_referenced_libs || fail "a hook names a .bearing/lib module that is not installed"

info "  [3/5] Link skills (symlinks from canonical store)"
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

case "$RUNTIME" in *cursor*|*both*|*all*) link_skills ".cursor/skills" "Cursor skills" ;; esac
case "$RUNTIME" in *zed*|*both*|*all*)    link_skills ".agents/skills" "Zed skills" ;; esac
case "$RUNTIME" in *claude*|*all*)        link_skills ".claude/skills" "Claude skills" ;; esac

if wants_cursor; then
  info "  [4/5] Teaching bundle manifest"
  write_manifest
fi

# Drop the volatile GitNexus stats block from AGENTS.md/CLAUDE.md so committed
# agent docs stay stable across machines (the `analyze` tool re-adds it each refresh).
if [[ -f ".bearing/lib/stabilize-agent-docs.mjs" ]]; then
  node .bearing/lib/stabilize-agent-docs.mjs . || true
fi

if wants_cursor; then
  info "  [5/5] Quick hook smoke test"
  if printf '%s' '{"tool_name":"SemanticSearch","tool_input":{"query":"test"}}' \
    | bash .cursor/hooks/bearing-grep-guard.sh 2>/dev/null \
    | grep -q 'deny'; then
    ok "SemanticSearch block verified"
  else
    warn "Hook smoke test inconclusive — restart Cursor and check Hooks panel"
  fi
fi

echo ""
ok "Teaching bundle v2 installed (enforcement hooks active)"
if wants_cursor; then
echo "    Enforcement:   00-bearing-enforcement.mdc + grep/read/edit hooks (staleness block)"
fi
echo "    Graph imaging: bearing-imaging skill"
echo "    Master skill:  bearing-workspace"
echo "    If blocked:    bearing-enforcement skill"
