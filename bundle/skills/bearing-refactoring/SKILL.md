---
name: bearing-refactoring
description: "Use when the user wants to rename, extract, split, move, or restructure code safely. Examples: \"Rename this function\", \"Extract this into a module\", \"Refactor this class\", \"Move this to a separate file\""
---

# Refactoring with GitNexus

## `rename` is not all graph — check the tag on every edit

Every edit in a `rename` preview is tagged `confidence: "graph"` (resolved through the knowledge
graph, safe) or `confidence: "text_search"` (a regex match — find-and-replace, labelled). A real
rename came back **4 graph, 3 text_search**: 43% regex, landing on an object-literal key that merely
shared the name.

`dry_run: true` is the default for a reason. Compare `graph_edits` against `text_search_edits`, read
every `text_search` line on its own merits, and run `detect_changes` afterwards. "Safer than
find-and-replace" is true and does not mean "is not find-and-replace".

## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.


## Workflow

```
1. impact({target: "X", direction: "upstream"})  → Map all dependents
2. query({search_query: "X"})                            → Find execution flows involving X
3. context({name: "X"})                           → See all incoming/outgoing refs
4. Plan update order: interfaces → implementations → callers → tests
```

> Stale index → `npm run bearing:agent-refresh` (always includes `--embeddings`; an index
> without them counts as stale).

## Checklists

### Rename Symbol

```
- [ ] rename({symbol_name: "oldName", new_name: "newName", dry_run: true}) — preview all edits
- [ ] Review graph edits (high confidence) and text_search edits (review carefully)
- [ ] If satisfied: rename({..., dry_run: false}) — apply edits
- [ ] detect_changes() — verify only expected files changed
- [ ] Run tests for affected processes
```

### Extract Module

```
- [ ] context({name: target}) — see all incoming/outgoing refs
- [ ] impact({target, direction: "upstream"}) — find all external callers
- [ ] Define new module interface
- [ ] Extract code, update imports
- [ ] detect_changes() — verify affected scope
- [ ] Run tests for affected processes
```

### Split Function/Service

```
- [ ] context({name: target}) — understand all callees
- [ ] Group callees by responsibility
- [ ] impact({target, direction: "upstream"}) — map callers to update
- [ ] Create new functions/services
- [ ] Update callers
- [ ] detect_changes() — verify affected scope
- [ ] Run tests for affected processes
```

## Risk Rules

| Risk Factor         | Mitigation                                |
| ------------------- | ----------------------------------------- |
| Many callers (>5)   | Use rename for automated updates |
| Cross-area refs     | Use detect_changes after to verify scope  |
| String/dynamic refs | query to find them               |
| External/public API | Version and deprecate properly            |

## Worked example — rename `validateUser` to `authenticateUser`

```
1. rename({ symbol_name: "validateUser", new_name: "authenticateUser", dry_run: true })
   → 12 edits across 8 files
   → graph_edits: 10   text_search_edits: 2      ← read BOTH numbers
   → the 2 text_search hits are in config.json — a dynamic reference, not a call

2. Review every text_search line on its own merits. These are regex matches; one landing on a
   same-named object key is the normal failure, not a rare one.

3. rename({ ..., dry_run: false })   → applies 12 edits across 8 files
4. detect_changes({ scope: "all" })  → Affected: LoginFlow, TokenRefresh · Risk: MEDIUM
```

