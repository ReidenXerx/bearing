---
name: bearing-refactoring
description: "Use when the user wants to rename, extract, split, move, or restructure code safely. Examples: \"Rename this function\", \"Extract this into a module\", \"Refactor this class\", \"Move this to a separate file\""
---

# Refactoring with GitNexus

## `rename` is not all graph — check the tag on every edit

Every edit in a `rename` preview is tagged `confidence: "graph"` (resolved through the knowledge
graph) or `confidence: "text_search"` (a regex match — find-and-replace, labelled).

**The ratio varies wildly and is not the point.** One measured rename came back 4 graph / 3
text_search; another, 36 / 1. What matters is WHICH edit is regex — in the second, the lone
text_search hit was the only production caller, and every confident edit was in the spec file.

`dry_run: true` is the default for a reason. Compare `graph_edits` against `text_search_edits`, read
every `text_search` line on its own merits, and run `detect_changes` afterwards. "Safer than
find-and-replace" is true and does not mean "is not find-and-replace".

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


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

## Worked example — measured, not invented

`rename({ symbol_name: "handleWebhookEvent", new_name: "...", dry_run: true })` on a real NestJS
backend:

```
files_affected: 3   total_edits: 37
graph_edits: 36     text_search_edits: 1     ← read BOTH numbers

  stripe.service.ts:586        the definition                    confidence: "graph"
  stripe.service.spec.ts       35 call sites in the test file    confidence: "graph"
  stripe.controller.ts:231     await this.stripeService.handle…  confidence: "text_search"
```

**The one regex edit is the only production caller.** The graph resolved every call in the spec
file and fell back to text search for the call that actually ships — because it goes through
`this.stripeService`, a receiver it could not type. That is `causes.receiverTyping` showing up in a
rename.

So the edit you most need to be right about is the one tagged lowest-confidence, and a preview that
is "97% graph" is not 97% safe. Read every `text_search` line on its own merits, then
`detect_changes({ scope: "all" })`.
