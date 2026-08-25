---
name: bearing-workspace
description: >-
  Master index for __GITNEXUS_REPO__ GitNexus usage in Cursor. Use at the start
  of any code task — exploration, edits, refactors, PR review, or API changes.
  Teaches workflow chain, anti-patterns, and which skill to load.
---

# GitNexus Workspace (__GITNEXUS_REPO__)

This repo replaces grep-first navigation with a **knowledge graph + embeddings + Cypher/PDG** for **all code reasoning** (not only the first lookup). **`query`** uses BM25 + semantic vectors for orient/explore. **`trace`** answers known A→B call paths. **`pdg_query`** answers control/data-flow questions when the PDG layer exists. **`cypher`** answers precise graph questions (field ACCESSES, overrides, process steps). **`rename`** coordinates multi-file symbol renames (dry_run first). **Hooks actively block** lazy patterns when the index is fresh; **autonomous refresh** when stale or embeddings missing; **classical fallback** when GN fails — see `00-bearing-enforcement` rule.

## Mandatory workflow chain

Do not skip steps:

```
READ gitnexus://repo/__GITNEXUS_REPO__/context   # or npm run bearing:agent-brief (autonomous)
READ gitnexus://repo/__GITNEXUS_REPO__/schema    # before ad-hoc Cypher
→ query({search_query, task_context, goal, repo, limit: 5, max_symbols: 12})   # graph + embeddings — orient
→ context({name, include_content: false}) or context({uid, include_content: false})
→ trace({from, to}) or pdg_query({mode})   # known paths, control/data flow when relevant
→ cypher({statement, params})   # structural graph: field ACCESSES, overrides, process steps
→ impact({target, direction: "upstream", summaryOnly: false, limit: 100})   # BEFORE edit
→ detect_changes({scope})                                              # BEFORE commit / PR
```

**Renames:** `impact` → `rename({symbol_name, new_name, dry_run: true})` — never find-and-replace symbols.

Stale, missing embeddings, or wrong graph? **`npm run bearing:agent-refresh`** autonomously (Shell, `required_permissions: ["all"]`) — includes `--embeddings`; hook pre-approves, do not ask user.

## HTTP API routing (auto-detected at install)

After index build, the kit writes `.bearing/gitnexus-api-profile.json`:

| Profile | Use |
| --- | --- |
| `framework` | `api_impact` / `route_map` / `shape_check` — indexed Route nodes |
| `custom` | **`bearing-api-routes`** skill — context on the dispatcher symbol (e.g. `dispatchRequest`) |
| `framework-likely` | Try `api_impact`; if empty, fall back to custom playbook |
| `none` | No HTTP layer detected |

Run `npm run bearing:detect-api` to refresh the profile after major server changes.

## Pick the right skill

| Situation | Read |
| --- | --- |
| Unfamiliar code / architecture | `bearing-exploring` |
| Pipelines / cross-module flows / "how does X connect" | `bearing-imaging` (`trace` when A and B are known) |
| Field read/write / data flow | `pdg_query flows` when PDG exists; otherwise `cypher` ACCESSES (READ schema) |
| Before editing / blast radius | `bearing-impact-analysis` |
| Bug / failure / wrong behavior | `bearing-debugging` |
| Rename / extract / refactor | `bearing-refactoring` + **`rename` MCP** |
| Add a feature / new code (reuse + wire in) | `bearing-feature-dev` |
| What to test / coverage gaps | `bearing-testing` |
| Slow path / hot path / cost | `bearing-performance` |
| Judge structure (coupling, cycles, god objects) | `bearing-architecture-review` |
| Work across layers (controller→service→repo→model) | `bearing-layered-systems` |
| Structured task (pre-commit, PR, cross-module) | `bearing-scenarios` |
| Milestone deep audit (feature done, pre-ship, big refactor) | **`bearing-microscope`** — multi-lens, opinionated, verified |
| Context filling / near compaction / recover after compaction | **`bearing-taskcore`** — dense AI save-state, survives compaction without drift |
| Project fundamentals / a doc contradicts a doc / proposing or rejecting an idea | **`bearing-northstars`** — the authoritative fixed points; cite `NS-#`, they outrank every other doc |
| PR or branch review | `bearing-pr-review` |
| Security / taint / injection review | `bearing-security-review` |
| Research HTTP API change | See **HTTP API routing** above |
| Tool reference / Cypher / CLI | `bearing-guide` / `bearing-cli` |
| Area entry points | `.claude/skills/gitnexus-area-<area>/` (mirrored to `.agents/skills/`) |
| Hook blocked Grep/Read | `bearing-enforcement` (staleness + suspicion fallback) |
| Full agent contract | `.cursor/rules/bearing.mdc` + `00-bearing-enforcement.mdc` |

## Smart query habits (use the embeddings, don't grep-in-disguise)

`query` is **hybrid**: BM25 keyword + **embedding vectors** (RRF). The embedding half is the point — it matches *meaning*, so it finds code that a keyword search misses.

- **Phrase `search_query` as a natural-language concept, not a symbol/keyword.** `"where auth tokens are validated"` ✓ — not `"validateToken"` ✗ (that's a `context` lookup). Concept phrasing feeds the vector ranker.
- **Always pass `task_context` + `goal`** — they steer the embedding ranking, not just keyword match.
- **Embeddings win when:** you don't know the symbol name · you want "code that *does* X even if named differently" · fuzzy/conceptual exploration. (Exact known symbol → skip to `context`.)

```javascript
query({
  search_query: "how retry/backoff is applied to outbound requests",  // concept, not a keyword
  task_context: "adding a circuit breaker",
  goal: "find existing retry logic to reuse",
  repo: "__GITNEXUS_REPO__",
  limit: 5,
  max_symbols: 12
})
```

## Anti-patterns (grep is wrong tool)

- Symbol lookup → `context`, not Grep
- Field/property data flow → `cypher` ACCESSES, not Grep field name
- Understand a module → `query`, not Read whole file (data-flow reads → Cypher first)
- Change scope → `detect_changes`, not git diff \| grep
- Rename symbol → **`rename` dry_run**, not StrReplace across files
- Research API route → profile-driven (`api_impact` vs `bearing-api-routes`)

Grep **is** correct for: preset JSON, log strings, comments, exact config keys in YAML.

## Persistence in Cursor

Installed by `npm run bearing:setup`:

- **Enforcement rule** — `.cursor/rules/00-bearing-enforcement.mdc` (only `alwaysApply: true` contract)
- **Reference rules** — `.cursor/rules/bearing.mdc` + `bearing-first.mdc` (load on demand)
- **Hooks** — GN-first when fresh; **refresh-first when stale** (classical only after refresh fails); field grep → Cypher; large data-flow Read → Cypher
- **Skills** — canonical store in `.bearing/skills/`, symlinked to `.cursor/skills/` (and `.agents/skills/` on Zed)
- **MCP** — `gitnexus` in `.cursor/mcp.json`

Restart Cursor after setup so MCP + hooks load.

## Power moves

| Need | Tool / param |
| --- | --- |
| Ambiguous symbol name | `context({uid: "..."})` from prior output |
| Field read/write trace | `cypher` with `ACCESSES` |
| Shortest known A→B call path | `trace({from, to})` |
| N-hop call chain | `cypher` CALLS variable-length path when endpoints are fuzzy |
| Coordinated rename | `rename({symbol_name, new_name, dry_run: true})` |
| Class member blast radius | `impact` + `relationTypes: ["CALLS","IMPORTS","ACCESSES"]` |
| Precise high-risk impact | `impact({ mode: "pdg", direction: "upstream" })` after PDG refresh |
| Security source→sink review | `explain({target})` + `pdg_query` + `trace` |
| Branch status / PR setup | `npm run bearing:branch-status -- <base>` |
| PR vs main | `detect_changes({scope: "compare", base_ref: "main", branch: "<current>"})` |
| Graph integrity check | `npm run bearing:graph-smoke` |
| Architecture doc | MCP prompt `generate_map` |
