---
name: bearing-performance
description: "Use when optimizing a slow path or reasoning about cost/hot paths. GitNexus reveals call STRUCTURE (depth, fan-in, repeated work) — pair with a real profiler for runtime numbers. Examples: \"this endpoint is slow\", \"find the hot path\", \"why is this expensive\", \"reduce redundant work\"."
---

# Performance work with GitNexus

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


GitNexus does **not** profile runtime — it exposes the *structure* that makes code expensive: deep call chains, high fan-in hubs, work repeated across a flow, and values recomputed instead of reused. Use it to **localize** the cost, then confirm with a profiler/benchmark.

## Workflow

```
1. query({search_query: "<slow concept>", goal: "hot path"})   → orient on the flow
2. READ gitnexus://repo/{name}/process/<flow>                  → see the chain + step order
3. trace({from: "<entry>", to: "<expensive sink>"})            → exact call path (depth = cost proxy)
4. cypher (CALLS variable-length / fan-in)                     → deep chains + high-fan-in hubs
5. pdg_query({mode: "flows", target})                          → values recomputed vs reused
6. impact({target, direction: "upstream"}) BEFORE optimizing   → don't break callers
7. confirm with a profiler/benchmark, then detect_changes      → verify the win + scope
```

> Stale index → `npm run bearing:agent-refresh` (autonomous). PDG steps need `analyze --pdg`.

## Structural cost signals (what to look for)

| Signal | Graph query | Why it's expensive |
| --- | --- | --- |
| **Deep chain** | `trace`, or `cypher` `CALLS*` variable-length path | Long synchronous call depth on a hot flow |
| **High fan-in hub** | `impact` upstream (many d=1 callers) / `cypher` count callers | Called from everywhere — small cost × huge frequency |
| **Repeated work** | `pdg_query flows` — same def reaching many uses | A value recomputed instead of hoisted/cached |
| **Work inside a flow step** | READ `process/<name>` — a heavy symbol mid-loop-ish flow | Per-item cost on a collection flow |
| **Cross-layer chatter** | `cypher` cross-cluster `CALLS` | N+1 / round-trips across a boundary (e.g. per-row DB call) |

## Example: "the report endpoint is slow"

```
1. query({search_query: "report generation", goal: "hot path"})
   → process: ReportFlow (buildReport → fetchRows → formatRow → serialize)
2. trace({from: "buildReport", to: "fetchRows"})
   → buildReport → enrich → formatRow → fetchRows   (fetchRows is 1 hop under a per-row formatter)
3. cypher: callers of fetchRows
   → formatRow CALLS fetchRows  → classic N+1 (a DB call per row)
4. Fix: hoist fetchRows out of formatRow (batch). impact({target:"fetchRows"}) first.
5. Benchmark before/after; detect_changes to confirm only ReportFlow moved.
```
