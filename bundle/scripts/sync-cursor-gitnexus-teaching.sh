#!/usr/bin/env bash
# Sync GitNexus teaching bundle into Cursor-native paths (.cursor/skills).
# Source of truth: .bearing/skills/ + .cursor/rules/ + .cursor/hooks/
# Run via: npm run gitnexus:setup (or directly)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

HOOK_LIBS=(
  ".bearing/lib/check-staleness.mjs"
  ".bearing/lib/load-staleness.mjs"
  ".bearing/lib/classify.mjs"
  ".bearing/lib/cursor-emit.mjs"
  ".bearing/lib/claude-emit.mjs"
  ".bearing/lib/session-primer.mjs"
  ".bearing/lib/context-pressure.mjs"
  ".bearing/lib/first-nudge.mjs"
  ".bearing/lib/clear-session.mjs"
  ".bearing/lib/set-refresh-pending.mjs"
  ".bearing/lib/hook-helpers.mjs"
  ".bearing/lib/cypher-helpers.mjs"
  ".bearing/lib/rename-helpers.mjs"
  ".bearing/lib/stale-policy.mjs"
  ".bearing/lib/cypher-cli.mjs"
  ".bearing/lib/generate-arch-doc.mjs"
  ".bearing/lib/stabilize-agent-docs.mjs"
  ".bearing/lib/commit-message.mjs"
  ".bearing/lib/detect-api-router.mjs"
  ".bearing/lib/graph-smoke.mjs"
  ".bearing/lib/agent-brief.mjs"
  ".bearing/lib/agent-health.mjs"
  ".bearing/lib/session-health-audit.mjs"
  ".bearing/lib/session-health-context.mjs"
  ".bearing/lib/verify-kit.mjs"
  ".bearing/gitnexus-hooks.json"
  "scripts/gitnexus-agent.mjs"
  "scripts/gitnexus-gate-hint.mjs"
  "scripts/gitnexus-teaching/script-gates.mjs"
  "scripts/lib/setup-ui.mjs"
)

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
    agentCli: ['npm run gitnexus:agent-status', 'npm run gitnexus:agent-refresh'],
  },
  components: {
    rules: [
      '.cursor/rules/00-gitnexus-enforcement.mdc',
      '.cursor/rules/gitnexus.mdc',
      '.cursor/rules/gitnexus-first.mdc',
    ],
    hooks: '.cursor/hooks.json',
    mcp: '.cursor/mcp.json',
    masterSkill: '.agents/skills/gitnexus-workspace/SKILL.md',
    enforcementSkill: '.agents/skills/gitnexus-enforcement/SKILL.md',
    gitnexusSkills: listSkills('.bearing/skills').filter((n) => n.startsWith('gitnexus-')),
    generatedAreaSkills: listSkills('.cursor/skills/generated'),
  },
  workflowChain: [
    'READ gitnexus://repo/__GITNEXUS_REPO__/context',
    'READ gitnexus://repo/__GITNEXUS_REPO__/schema',
    'query({query, task_context, goal})',
    'context({name|uid})',
    'cypher({query, params})',
    'impact({target, direction: upstream})',
    'detect_changes({scope})',
  ],
};

fs.mkdirSync('.cursor', { recursive: true });
fs.writeFileSync(
  '.cursor/gitnexus-teaching-bundle.json',
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log('    ✓ Wrote .cursor/gitnexus-teaching-bundle.json (v2 enforcement)');
NODE
}

# ── main ─────────────────────────────────────────────────────────────────────

info "Installing GitNexus agent kit teaching bundle (runtime: ${GITNEXUS_RUNTIME:-both})"

info "  [1/5] Cursor rules (single always-on contract)"
verify_always_apply_rule ".cursor/rules/00-gitnexus-enforcement.mdc"
for ref_rule in ".cursor/rules/gitnexus.mdc" ".cursor/rules/gitnexus-first.mdc"; do
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
ok "${#HOOK_SCRIPTS[@]} hook scripts + ${#HOOK_LIBS[@]} lib(s) ready"

info "  [3/5] Link skills (symlinks from canonical store)"
STORE=".bearing/skills"
if [[ ! -d "$STORE" ]]; then
  fail "Missing $STORE — run gn-agent-kit install or update first"
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

# Runtime may be cursor|zed|claude|both|all or a comma-list. both = cursor+zed.
RUNTIME="${GITNEXUS_RUNTIME:-both}"
case "$RUNTIME" in *cursor*|*both*|*all*) link_skills ".cursor/skills" "Cursor skills" ;; esac
case "$RUNTIME" in *zed*|*both*|*all*)    link_skills ".agents/skills" "Zed skills" ;; esac
case "$RUNTIME" in *claude*|*all*)        link_skills ".claude/skills" "Claude skills" ;; esac

info "  [4/5] Teaching bundle manifest"
write_manifest

# Drop the volatile GitNexus stats block from AGENTS.md/CLAUDE.md so committed
# agent docs stay stable across machines (the `analyze` tool re-adds it each refresh).
if [[ -f ".bearing/lib/stabilize-agent-docs.mjs" ]]; then
  node .bearing/lib/stabilize-agent-docs.mjs . || true
fi

info "  [5/5] Quick hook smoke test"
if printf '%s' '{"tool_name":"SemanticSearch","tool_input":{"query":"test"}}' \
  | bash .cursor/hooks/bearing-grep-guard.sh 2>/dev/null \
  | grep -q 'deny'; then
  ok "SemanticSearch block verified"
else
  warn "Hook smoke test inconclusive — restart Cursor and check Hooks panel"
fi

echo ""
ok "Teaching bundle v2 installed (enforcement hooks active)"
echo "    Enforcement:   00-gitnexus-enforcement.mdc + grep/read/edit hooks (staleness block)"
echo "    Graph imaging: gitnexus-imaging skill"
echo "    Master skill:  gitnexus-workspace"
echo "    If blocked:    gitnexus-enforcement skill"
