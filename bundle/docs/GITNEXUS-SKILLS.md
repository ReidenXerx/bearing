# GitNexus agent skills

Use this index to route agent work to the right reusable playbook. The canonical skill store is installed into target repos at `.bearing/skills/` and symlinked into Cursor (`.cursor/skills/`) and Zed (`.agents/skills/`) based on runtime.

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
- Bug trace/failure path → `bearing-debugging`
- Unknown codebase/feature → `bearing-exploring` or `bearing-imaging`
- Hook blocked an action → `bearing-enforcement`

## Non-negotiables

- If the index is stale, refresh first: `npm run bearing:agent-refresh`.
- Before editing runtime code, run impact analysis.
- Before commit or “done”, run `detect_changes`.
- For high-risk runtime/security changes, use PDG tools when available.
- No taint finding / no PDG layer is not proof of safety.
