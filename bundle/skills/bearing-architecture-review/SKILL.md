---
name: bearing-architecture-review
description: "Use to JUDGE structure — coupling, cohesion, layering violations, import cycles, god objects. Exploring/imaging help you understand; this produces an assessment with evidence. Examples: \"review the architecture\", \"where's the coupling\", \"are there layering violations\", \"find import cycles / god objects\"."
---

# Architecture review with GitNexus

## The graph can be wrong

It is derived from parsing, not ground truth, and it fails in three different ways:

- **A zero is not absence.** Never conclude "unused", "no callers" or "safe to delete" from an empty result.
- **A low-confidence edge is a lead, not proof.** Check `r.confidence` — `CALLS` and resolved `ACCESSES` come back at 0.85–1.0, while ~92% of `USES` edges sit near 0.5.
- **A count can be a floor.** `impact` returns `epistemic: "lower-bound"` with a `boundaries` note when it knows it is guessing low; it returns `"exact"` when it is not.

When the conclusion matters — deleting, renaming, "nothing reads this", a security claim — confirm with a scoped `Grep` or by reading the file, and **say which check you ran**. A scoped grep for this is explicitly allowed; it is not a gate violation. When the graph and a classical check disagree, the classical check wins on existence, and the disagreement is a defect worth reporting via `bearing:fallback`.


`bearing-exploring`/`imaging` help you *understand* a codebase; this skill *judges* it — and backs every claim with a graph query, not vibes.

## When to Use

- "Review the architecture / call out structural problems"
- "Where is the coupling / are layers respected?"
- "Find import cycles, god objects, dead seams"
- Pre-refactor scoping, or a design-health pass

## Workflow

```
1. READ bearing://repo/{name}/clusters     → functional areas + cohesion scores (low = poorly factored)
2. READ bearing://repo/{name}/processes    → long/tangled flows = candidate hotspots
3. check({cycles: true})                    → circular File IMPORTS (hard structural smell)
4. cypher: cross-cluster CALLS              → coupling + layering violations (lower layer calling higher)
5. cypher: god objects                      → classes with many HAS_METHOD AND high fan-in
6. impact on hub symbols                    → load-bearing nodes (high blast radius = architectural risk)
```

> Stale index → `npm run bearing:agent-refresh` (autonomous).

## What to assess (and how)

| Finding | How to detect | Why it matters |
| --- | --- | --- |
| **Import cycles** | `check({cycles: true})` | Cyclic deps block modularity, slow builds, break reasoning |
| **Low cohesion** | `clusters` cohesion score | An area doing too many unrelated things |
| **High coupling / layering violation** | `cypher` cross-cluster `CALLS` (e.g. `core` → `ui`, `repo` → `controller`) | Wrong-direction dependency erodes the architecture |
| **God object** | `cypher` classes with many `HAS_METHOD` + many callers | Single point that everything touches |
| **Load-bearing hub** | `impact` upstream (huge d=1) | Change here is high-risk; candidate to split/stabilize |
| **Dead seam** | `cypher` symbols with 0 callers / `route_map` orphan routes | Cruft to remove |

## Cypher starters (READ schema first)

```cypher
// Cross-area CALLS — coupling between functional areas
MATCH (a)-[:CodeRelation {type:'CALLS'}]->(b)
WHERE a.community <> b.community
RETURN a.community AS from, b.community AS to, count(*) AS edges
ORDER BY edges DESC

// God-object candidates — wide classes with high fan-in
MATCH (c:Class)-[:CodeRelation {type:'HAS_METHOD'}]->(m)
WITH c, count(m) AS methods
MATCH (caller)-[:CodeRelation {type:'CALLS'}]->(c)
RETURN c.name, methods, count(caller) AS callers
ORDER BY methods + callers DESC
```

## Checklist

```
- [ ] clusters → note low-cohesion areas
- [ ] check(cycles) → list every import cycle (cite the file ring)
- [ ] cypher cross-cluster CALLS → coupling hotspots + wrong-direction (layering) edges
- [ ] cypher → god objects / wide high-fan-in classes
- [ ] impact on top hubs → quantify blast radius (the refactor priority list)
- [ ] Report: each finding + the query that proves it + a concrete remediation
```

## Example output

```
Findings (evidence-backed):
- CYCLE: payments/index.ts → billing/tax.ts → payments/index.ts  (check cycles)
- LAYERING: data/UserRepo CALLS api/UserController  (cross-cluster, wrong direction)
- GOD OBJECT: AppContext — 41 methods, 180 callers  (split by concern)
- HUB: validateRequest — impact d=1 = 63  (stabilize before touching)
Priority: break the payments↔billing cycle first (blocks independent testing).
```
