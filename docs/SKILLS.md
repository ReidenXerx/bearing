# bearing — agent skills

Use this index to route agent work to the right reusable playbook. Skills marked **core** need no GitNexus; the rest teach the graph tool surface and install with the `gitnexus` module. The canonical skill store is installed into target repos at `.bearing/skills/` and symlinked into Cursor (`.cursor/skills/`) and Zed (`.agents/skills/`) based on runtime.

| Skill | Use when | Minimum graph path |
| --- | --- | --- |
| `bearing-workspace` | General session orientation, “what should I use?” questions | READ context → query/context as needed |
| `bearing-enforcement` | Understanding hook blocks and graph-first rules | Follow hook replacement call exactly |
| `bearing-impact-analysis` | Any pre-edit blast-radius question | `impact({ target, direction: "upstream" })` before edit; `detect_changes` before done |
| `bearing-security-review` | Auth/session/input/file/db/exec/rendering/webhook changes | `query` → `context` → `explain` → `pdg_query` → `trace`/PDG impact |
| `bearing-pr-review` | PR or branch review | `npm run bearing:branch-status -- <base>` → `detect_changes({ scope: "compare", branch })` |
| `bearing-api-routes` | API handler or payload shape changes | `api_impact` before route edits; `shape_check` for payload drift |
| `bearing-debugging` | Bugs, failing flows, “how did we reach this?” | `query` symptom → `context` suspect → `trace`/process/PDG as needed |
| `bearing-refactoring` | Rename/extract/split/move work | `impact` → `context` → `rename({ dry_run: true })` or manual plan |
| `bearing-feature-dev` | Adding a feature / new code — reuse + wire in | `query` existing pattern → `context` integration point → `impact` before wiring |
| `bearing-testing` | What to test / coverage gaps | `impact` → affected processes = test surface; `cypher` for untested symbols |
| `bearing-performance` | Slow / hot path / cost | `query`/process → `trace` depth → `cypher` fan-in → `pdg_query flows` |
| `bearing-architecture-review` | Judge coupling/cohesion/cycles/god objects | `clusters` → `check(cycles)` → `cypher` cross-area `CALLS` → `impact` hubs |
| `bearing-layered-systems` | Working across layers (controller→service→repo→model) | `process`/`trace` through layers → `impact` widened across boundaries |
| `bearing-northstars` **core** | Reading, citing and maintaining the project's authoritative fixed points | read `.bearing/northstars.md` → cite `NS-#` on consequential claims → propose (never silently edit) |
| `bearing-taskcore` **core** | Context filling, or recovering after compaction | write `.bearing/.task-core.md` before compaction → read it back first on recovery |
| `bearing-microscope` **core** | Milestone deep audit — adopts your project's expert ROLE, then multi-lens, verified, in waves | map (`clusters`/`processes`) → spawn per-slice lenses (2 kinds) → adversarial verify → synthesize |
| `bearing-exploring` | Learning an unfamiliar codebase or feature | READ context → `query({ search_query })` → process/resource reads |
| `bearing-imaging` | Producing architectural maps or mental models | clusters/processes → query → context on hubs |
| `bearing-scenarios` | Checklist-style common workflows | Use the scenario checklist matching the task |
| `bearing-cli` | GitNexus CLI setup/troubleshooting | Prefer kit commands first, then raw `gitnexus` CLI |
| `bearing-local` | Local model / Ollama / lower-tier agent usage | Use small, explicit MCP calls; avoid broad file reads |
| `bearing-guide` | Human/team explanation of the workflow | Reference when onboarding contributors |

## Routing shortcuts

- Security-sensitive task → `bearing-security-review`
- API route or response payload → `bearing-api-routes`
- PR/branch review → `bearing-pr-review`
- Rename/refactor → `bearing-refactoring`
- Add a feature / new code → `bearing-feature-dev`
- What to test / coverage → `bearing-testing`
- Slow / hot path → `bearing-performance`
- Judge structure (coupling/cycles/god objects) → `bearing-architecture-review`
- Work across layers (controller→service→repo→model) → `bearing-layered-systems`
- Milestone deep audit (feature done / pre-ship / big refactor) → `bearing-microscope`
- Bug trace/failure path → `bearing-debugging`
- Unknown codebase/feature → `bearing-exploring` or `bearing-imaging`
- Hook blocked an action → `bearing-enforcement`

## Non-negotiables

- If the index is stale, refresh first: `npm run bearing:agent-refresh`.
- Before editing runtime code, run impact analysis.
- Before commit or “done”, run `detect_changes`.
- For high-risk runtime/security changes, use PDG tools when available.
- No taint finding / no PDG layer is not proof of safety.
