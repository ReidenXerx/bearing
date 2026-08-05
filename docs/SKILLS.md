# GitNexus agent skills

Use this index to route agent work to the right reusable playbook. The canonical skill store is installed into target repos at `.bearing/skills/` and symlinked into Cursor (`.cursor/skills/`) and Zed (`.agents/skills/`) based on runtime.

| Skill | Use when | Minimum graph path |
| --- | --- | --- |
| `gitnexus-workspace` | General session orientation, “what should I use?” questions | READ context → query/context as needed |
| `gitnexus-enforcement` | Understanding hook blocks and graph-first rules | Follow hook replacement call exactly |
| `gitnexus-impact-analysis` | Any pre-edit blast-radius question | `impact({ target, direction: "upstream" })` before edit; `detect_changes` before done |
| `gitnexus-security-review` | Auth/session/input/file/db/exec/rendering/webhook changes | `query` → `context` → `explain` → `pdg_query` → `trace`/PDG impact |
| `gitnexus-pr-review` | PR or branch review | `npm run gitnexus:branch-status -- <base>` → `detect_changes({ scope: "compare", branch })` |
| `gitnexus-api-routes` | API handler or payload shape changes | `api_impact` before route edits; `shape_check` for payload drift |
| `gitnexus-debugging` | Bugs, failing flows, “how did we reach this?” | `query` symptom → `context` suspect → `trace`/process/PDG as needed |
| `gitnexus-refactoring` | Rename/extract/split/move work | `impact` → `context` → `rename({ dry_run: true })` or manual plan |
| `gitnexus-feature-dev` | Adding a feature / new code — reuse + wire in | `query` existing pattern → `context` integration point → `impact` before wiring |
| `gitnexus-testing` | What to test / coverage gaps | `impact` → affected processes = test surface; `cypher` for untested symbols |
| `gitnexus-performance` | Slow / hot path / cost | `query`/process → `trace` depth → `cypher` fan-in → `pdg_query flows` |
| `gitnexus-architecture-review` | Judge coupling/cohesion/cycles/god objects | `clusters` → `check(cycles)` → `cypher` cross-area `CALLS` → `impact` hubs |
| `gitnexus-layered-systems` | Working across layers (controller→service→repo→model) | `process`/`trace` through layers → `impact` widened across boundaries |
| `gitnexus-microscope` | Milestone deep audit — opinionated multi-lens, verified, waves | map (`clusters`/`processes`) → spawn per-slice lenses (2 kinds) → adversarial verify → synthesize |
| `gitnexus-exploring` | Learning an unfamiliar codebase or feature | READ context → `query({ search_query })` → process/resource reads |
| `gitnexus-imaging` | Producing architectural maps or mental models | clusters/processes → query → context on hubs |
| `gitnexus-scenarios` | Checklist-style common workflows | Use the scenario checklist matching the task |
| `gitnexus-cli` | GitNexus CLI setup/troubleshooting | Prefer kit commands first, then raw `gitnexus` CLI |
| `gitnexus-local` | Local model / Ollama / lower-tier agent usage | Use small, explicit MCP calls; avoid broad file reads |
| `gitnexus-guide` | Human/team explanation of the workflow | Reference when onboarding contributors |

## Routing shortcuts

- Security-sensitive task → `gitnexus-security-review`
- API route or response payload → `gitnexus-api-routes`
- PR/branch review → `gitnexus-pr-review`
- Rename/refactor → `gitnexus-refactoring`
- Add a feature / new code → `gitnexus-feature-dev`
- What to test / coverage → `gitnexus-testing`
- Slow / hot path → `gitnexus-performance`
- Judge structure (coupling/cycles/god objects) → `gitnexus-architecture-review`
- Work across layers (controller→service→repo→model) → `gitnexus-layered-systems`
- Milestone deep audit (feature done / pre-ship / big refactor) → `gitnexus-microscope`
- Bug trace/failure path → `gitnexus-debugging`
- Unknown codebase/feature → `gitnexus-exploring` or `gitnexus-imaging`
- Hook blocked an action → `gitnexus-enforcement`

## Non-negotiables

- If the index is stale, refresh first: `npm run gitnexus:agent-refresh`.
- Before editing runtime code, run impact analysis.
- Before commit or “done”, run `detect_changes`.
- For high-risk runtime/security changes, use PDG tools when available.
- No taint finding / no PDG layer is not proof of safety.
