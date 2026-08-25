---
name: bearing-scenarios
description: "Scenario playbooks for GitNexus — pre-edit, pre-commit, PR review, bugs, refactors, cross-module changes, presets. Read when starting a structured task."
---

# GitNexus Scenario Playbooks

## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.


Match your task to a playbook. Always start with READ `gitnexus://repo/__GITNEXUS_REPO__/context`.

Cross-module flows / architecture questions → also read **`bearing-imaging`** skill.

## 1. Pre-edit (any symbol change)

```
- [ ] READ context resource — index fresh?
- [ ] gitnexus_impact({target, direction: "upstream", repo: "__GITNEXUS_REPO__"})
- [ ] Report d=1 (WILL BREAK), affected processes, risk level to user
- [ ] If HIGH/CRITICAL → warn before editing; suggest narrower change or tests
- [ ] Optional: widen with relationTypes: ["CALLS","IMPORTS","ACCESSES"] for field/member edits
- [ ] Make edit
- [ ] Run tests for affected processes
```

## 2. Pre-commit

```
- [ ] gitnexus_detect_changes({ scope: "staged", repo: "__GITNEXUS_REPO__" })
- [ ] Review changed_symbols + affected_processes
- [ ] Unexpected cross-module hits? → split commit or narrow scope
- [ ] Risk CRITICAL/HIGH → run broader test suite before commit
- [ ] Commit (pre-commit hook refreshes index with PDG via `bearing:full-pdg` (full --force rebuild); agents use `bearing:agent-refresh` when stale mid-session)
```

## 3. PR / branch review

```
- [ ] gitnexus_detect_changes({ scope: "compare", base_ref: "main", repo: "__GITNEXUS_REPO__" })
- [ ] List affected processes — do they match PR intent?
- [ ] For each changed entry-point symbol: gitnexus_impact upstream
- [ ] Flag cross-community process breaks
- [ ] Verify tests cover affected processes
```

## 4. Bug trace / failure

```
- [ ] gitnexus_query({search_query: "<error or symptom>", task_context: "debugging", goal: "find throw site"})
- [ ] gitnexus_context on top suspect from returned processes
- [ ] READ gitnexus://repo/__GITNEXUS_REPO__/processes — pick matching flow
- [ ] Optional cypher for call chains (see bearing-debugging skill)
- [ ] Read source at flagged lines — confirm root cause
- [ ] If regression: detect_changes on recent commits
```

## 5. Refactor / rename

```
- [ ] gitnexus_impact upstream on target
- [ ] gitnexus_context on target — understand callees/callers
- [ ] gitnexus_rename({ symbol_name, new_name, dry_run: true })
- [ ] Review graph vs text_search edits carefully
- [ ] Apply rename (dry_run: false) OR manual edit following impact map
- [ ] gitnexus_detect_changes({ scope: "all" })
- [ ] Run tests for every affected process listed
```

## 6. Cross-module / shared contract change

```
- [ ] gitnexus_detect_changes — confirm blast radius
- [ ] gitnexus_impact on shared symbols at module boundaries
- [ ] Edit contract source first, then consumers
- [ ] Run tests on both sides of the boundary
```

## 7. Config / data files (JSON / YAML only)

```
- [ ] Grep / Read config & fixture files is appropriate (not graph symbols)
- [ ] Validate config keys/IDs against the code that consumes them (context or Read)
- [ ] Run the relevant config/fixture tests
```

## 8. Explore unfamiliar code

See `bearing-exploring` skill — query → context → process trace → Read source.

## 9. HTTP route change

See `bearing-api-routes` skill — `api_impact`/`route_map`/`shape_check` for framework routers,
`context` on dispatcher symbols for custom routers (profile-driven).
