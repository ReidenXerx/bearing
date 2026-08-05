---
name: gitnexus-enforcement
description: >-
  North-star tool router when GitNexus hooks block Grep/Read/SemanticSearch.
  Graph + embeddings + cypher reasoning, autonomous refresh when stale, classical fallback when GN fails.
disable-model-invocation: false
---

# GitNexus Enforcement & Tool Router

## North star

> **GitNexus is the default reasoning layer for every task.** Prefer graph + embeddings when fresh. Use `query` to orient. Use `cypher` for precise structural questions (field ACCESSES, N-hop CALLS, overrides). Refresh autonomously when stale or embeddings missing. Classical tools **only after refresh fails** (or MCP down / GN wrong) — say why in one sentence.

GitNexus tools are for **reasoning throughout the task**, not only the first lookup or unfamiliar code. Local LLM: rebuild context freely; do not skip gates.

## Graph + embeddings + cypher (layered)

| Task | Tool |
| --- | --- |
| Fuzzy concept, flow trace, "how does X work?" | `query` (BM25 + embedding vectors) |
| Known symbol, callers, 360° | `context` |
| Known A→B call path | `trace` |
| Control/data flow | `pdg_query` (`flows` / `controls`) when PDG layer exists |
| Field read/write, overrides, process steps | READ schema → `cypher` |
| Security taint/source→sink | `explain` + `pdg_query` + `trace` |
| Pre-edit safety | `impact` (`mode: "pdg"` for high-risk/PDG-backed precision) |
| Pre-commit / done | `detect_changes` |

`SemanticSearch` is blocked → always `query`. Field/property grep → `cypher` (`ACCESSES`). Missing embeddings = **stale** → `agent-refresh` (includes `--embeddings`).

## MCP defaults (generous)

| Tool | Default |
| --- | --- |
| `context` | `include_content: false` |
| `query` | `limit: 5`, `max_symbols: 12` |
| `trace` | Use when both source and target symbols are known |
| `pdg_query` | `mode: "flows"` for variables; `mode: "controls"` for guards |
| `explain` | Taint findings for files/symbols; absence is not proof of safety |
| `cypher` | READ `bearing://repo/__GITNEXUS_REPO__/schema` first; use `$params` |
| `impact` | `summaryOnly: false`, `limit: 100` |

Hooks inject calls with these defaults — run verbatim; expand when needed.

## Decision tree (follow in order)

```
START
  │
  ├─ New session / new task?
  │    └─ npm run bearing:agent-brief  OR  READ context + schema (autonomous)
  │         stale or missing embeddings? → npm run bearing:agent-refresh (Shell, required_permissions: ["all"])
  │
  ├─ Reasoning about code (any point in task)?
  │    └─ query({search_query, task_context, goal, repo})   # graph + embeddings
  │         └─ context({name}) or context({uid})
  │              └─ Structural precision needed?
  │                   ├─ known A→B path → trace({from, to})
  │                   ├─ control/data flow → pdg_query({mode: "controls"|"flows"})
  │                   ├─ field read/write → pdg_query flows OR cypher ACCESSES
  │                   ├─ fuzzy N-hop call chain → cypher CALLS path
  │                   ├─ overrides / process steps → cypher (see schema)
  │                   └─ READ process trace if cross-module
  │                        └─ impact when considering edits
  │                             └─ Read offset/limit ONLY for exact edit lines
  │
  ├─ About to RENAME symbol X → Y (prompt or StrReplace)?
  │    └─ impact({target: X, direction: "upstream"}) → rename({symbol_name: X, new_name: Y, dry_run: true})
  │         preview → apply dry_run: false OR manual edits following map
  │
  ├─ About to EDIT src/, tests/, apps/, scripts/?
  │    └─ impact({target, direction: "upstream"}) FIRST
  │         report d=1 + risk → then edit
  │
  ├─ About to COMMIT or say "done"?
  │    └─ detect_changes({scope: "unstaged"})
  │
  └─ Hook blocked Grep/Read?
       ├─ Index stale / embeddings missing / check failed? → run `agent-refresh` FIRST (hooks block classical until refresh succeeds or fails)
       ├─ Refresh failed / MCP down? → classical OK; tell user why
       ├─ GN suspicious after uid retry + graph used this session? → scoped Grep or Read; tell user why
       └─ Otherwise → run the **exact** MCP call from hook agent_message (copy-paste)
```

## Hook block → copy-paste replacements

When blocked, hooks return ready-to-run calls like:

```javascript
gitnexus_query({ search_query: "auth flow", task_context: "...", goal: "...", repo: "__GITNEXUS_REPO__", limit: 5, max_symbols: 12 })
gitnexus_context({ name: "<symbol>", repo: "__GITNEXUS_REPO__" })
gitnexus_trace({ from: "<source>", to: "<target>", repo: "__GITNEXUS_REPO__", maxDepth: 10 })
gitnexus_pdg_query({ mode: "flows", target: "<function-or-file>", variable: "<var>", repo: "__GITNEXUS_REPO__" })
gitnexus_explain({ target: "<file-or-symbol>", repo: "__GITNEXUS_REPO__" })
READ bearing://repo/__GITNEXUS_REPO__/schema
gitnexus_cypher({ statement: "MATCH (f)-[r:CodeRelation {type: 'ACCESSES'}]->(p:Property {name: $name}) RETURN f.name, f.filePath, r.reason", params: { name: "<field>" }, repo: "__GITNEXUS_REPO__" })
gitnexus_impact({ target: "<symbol>", direction: "upstream", repo: "__GITNEXUS_REPO__", summaryOnly: false, limit: 100 })
```

## Classical fallback (when NOT to trust GitNexus)

| Signal | What to do |
| --- | --- |
| **Stale index** or **missing embeddings** | Hooks block classical — run `agent-refresh` first; edits blocked until fresh |
| **Refresh failed** (ENOSPC, MCP down) | Classical OK; warn user; retry refresh once if feasible |
| **0 upstream** on a known hub | `context({uid})` retry once → scoped Grep in GN-named file (after ≥1 MCP call this session) |
| **impact vs detect_changes** disagree | Trust `detect_changes`; verify with Read/Grep |
| **Wrong/missing file** from graph | Classical Read/Grep; mention GN drift |
| **MCP unreachable** | Warn user; classical OK |

**Always:** one sentence to the user explaining the bypass.

## Hook block → replacement (fresh index)

| Blocked | Replacement |
| --- | --- |
| `Grep("someFunctionName")` | `context({name: "someFunctionName"})` |
| `Grep("address")` (field/property) | READ schema → `cypher` ACCESSES on `$name: "address"` |
| `SemanticSearch("auth flow")` | `query({search_query: "auth flow", task_context, goal})` — uses embeddings |
| `Glob("src/**/*.js")` | `query({search_query: "module area", goal: "entry points"})` |
| `Read(entire large source file)` | `query` → `context` → Read offset/limit |
| Scoped Grep before any GN MCP call | `context` first — scoped Grep only after graph use + suspicion |

When index is **stale**, hooks **block** classical patterns until refresh succeeds or fails — run `agent-refresh` first.

## Autonomous agent CLI

```bash
npm run bearing:agent-brief    # session orientation + suggested calls
npm run bearing:agent-status   # exit 1 if stale or embeddings missing
npm run bearing:agent-refresh  # analyze --embeddings + sync — when stale
```

**NEVER** tell the user to run `npx gitnexus analyze` — that is agent work.

## When hooks can't help (Grep is correct)

- Config / fixture files (`*.json`, `*.yaml`) — literal values
- Exact string in logs/comments
- Config keys / IDs in data files
- Validating docs paths exist

## Before saying "done"

If you edited code: `detect_changes` + summarize affected processes and risk.
