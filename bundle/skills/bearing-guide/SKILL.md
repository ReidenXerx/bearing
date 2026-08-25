---
name: bearing-guide
description: "Use when the user asks about GitNexus itself — available tools, how to query the knowledge graph, MCP resources, graph schema, or workflow reference. Examples: \"What GitNexus tools are available?\", \"How do I use GitNexus?\""
---

# GitNexus Guide

Quick reference for all GitNexus MCP tools, resources, and the knowledge graph schema.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npm run bearing:agent-refresh` (autonomous, hook-pre-approved) — never ask the user to analyze.

## Skills

| Task                                         | Skill to read       |
| -------------------------------------------- | ------------------- |
| Understand architecture / "How does X work?" | `bearing-exploring`         |
| Blast radius / "What breaks if I change X?"  | `bearing-impact-analysis`   |
| Trace bugs / "Why is X failing?"             | `bearing-debugging`         |
| Rename / extract / split / refactor          | `bearing-refactoring`       |
| Add a feature / new code (reuse + wire in)   | `bearing-feature-dev`       |
| What to test / coverage gaps                 | `bearing-testing`           |
| Slow / hot path / cost optimization          | `bearing-performance`       |
| Judge structure (coupling, cycles, god objs) | `bearing-architecture-review` |
| Work across layers (controller→repo→model)   | `bearing-layered-systems`   |
| Milestone deep audit (opinionated, verified) | `bearing-microscope`        |
| Tools, resources, schema reference           | `bearing-guide` (this file) |
| Security / taint / injection review          | `bearing-security-review`   |
| Index, status, clean, wiki CLI commands      | `bearing-cli`               |

## Tools Reference (full surface — `group_list`/`group_sync` cross-repo are out of scope)

**Core navigation & safety**

| Tool             | What it gives you / when to reach for it                                 |
| ---------------- | ------------------------------------------------------------------------ |
| `query`          | Orient — process-grouped execution flows for a concept (BM25 + vectors). First move for fuzzy work. |
| `context`        | 360° on one symbol — callers, callees, categorized refs, processes. After `query`, or when symbol is known. |
| `cypher`         | Raw structural traversals the canned tools can't express — `ACCESSES`, N-hop `CALLS`, `METHOD_OVERRIDES`, `STEP_IN_PROCESS`. READ schema first. |
| `impact`         | Pre-edit blast radius + risk + affected processes. `mode: "pdg"` for statement-level control/data affectedness. |
| `detect_changes` | Git-diff impact — what your current/staged/compared changes affect. Pre-commit + PR review. |
| `rename`         | Multi-file coordinated rename, confidence-tagged. `dry_run: true` first — never find-and-replace. |

**Deep precision (need `analyze --pdg`)**

| Tool          | What it gives you / when                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `trace`       | Shortest directed call/member path between two symbols — "how does A reach B?" in one call. |
| `pdg_query`   | Control dependence (`mode:"controls"` — what gates a line) / data dependence (`mode:"flows"` — where a variable flows). Anchored to a function. |
| `explain`     | Persisted taint findings — source→sink (injection, path-traversal, XSS), intra- and inter-procedural. Security review. |

**HTTP API (framework routers)**

| Tool          | What it gives you / when                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `api_impact`  | Pre-change report for a route handler — consumers, response-shape mismatches, middleware, risk. BEFORE editing a route. |
| `route_map`   | Routes → consumers + handler + middleware chain; find orphaned routes. (Custom router → `context` on the dispatcher.) |
| `shape_check` | Response-shape drift — keys a route returns vs keys consumers access (flags MISMATCH). |

**Meta / health**

| Tool          | What it gives you / when                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `tool_map`    | MCP/RPC tool definitions → handler files + descriptions. Tool-API work, impact of a tool-contract change. |
| `check`       | Read-only structural integrity — detects circular File `IMPORTS` cycles (health / CI). |
| `list_repos`  | Discover/disambiguate indexed repos (paginated — `limit`/`offset`). Only when multiple repos are indexed. |

### Paginating `list_repos`

`list_repos` is paginated so a large registry is not truncated by MCP/LLM token limits. It takes optional `limit` (default **50**, max **200**) and `offset`, and returns:

```jsonc
{
  "repositories": [
    { "name": "...", "path": "...", "indexedAt": "...", "lastCommit": "...", "stats": { } }
  ],
  "pagination": {
    "total": 437,
    "limit": 50,
    "offset": 0,
    "returned": 50,
    "hasMore": true,
    "nextOffset": 50
  }
}
```

To enumerate **every** repository, keep calling with `offset` set to `pagination.nextOffset` until `hasMore` is `false`:

```text
list_repos {}               → repos 1–50,    nextOffset 50,  hasMore true
list_repos { offset: 50 }   → repos 51–100,  nextOffset 100, hasMore true
…
list_repos { offset: 400 }  → repos 401–437,                 hasMore false   (done)
```

Notes: `offset` ≥ `total` returns an empty page (with `total` still reported). Out-of-range or malformed `limit`/`offset` (non-integer, `limit` outside `[1, 200]`, `offset < 0`) are rejected with a clear error — `limit` above the max is rejected, not silently capped. The order is deterministic (lower-cased name, then path), so paging never skips or duplicates an entry while the registry is unchanged.

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource                                       | Content                                   |
| ---------------------------------------------- | ----------------------------------------- |
| `gitnexus://repo/{name}/context`               | Stats, staleness check                    |
| `gitnexus://repo/{name}/clusters`              | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members                              |
| `gitnexus://repo/{name}/processes`             | All execution flows                       |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace                        |
| `gitnexus://repo/{name}/schema`                | Graph schema for Cypher                   |

## Graph Schema

Always `READ gitnexus://repo/{name}/schema` before writing Cypher — it's authoritative for this repo.

**Nodes:** File, Function, Class, Interface, Method, Community, Process (PDG layer adds BasicBlock).
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, HAS_METHOD, METHOD_OVERRIDES, STEP_IN_PROCESS, **ACCESSES** (field read/write — carries `reason: "read"|"write"`). PDG layer adds CONTROL_DEP, REACHING_DEF, TAINTED.

```cypher
// Who calls myFunc?
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath

// Who writes the `balance` field? (use ACCESSES, not field grep)
MATCH (s)-[r:CodeRelation {type: 'ACCESSES'}]->(field {name: "balance"})
WHERE r.reason = "write"
RETURN s.name, s.filePath, s.kind
```
