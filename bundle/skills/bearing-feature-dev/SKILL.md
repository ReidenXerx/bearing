---
name: bearing-feature-dev
description: "Use when ADDING new code — implement a feature, add an endpoint/handler, wire in a new module. The graph finds existing patterns to reuse and the right place to integrate. Examples: \"add a feature that does X\", \"where do I wire this in\", \"implement X like the existing Y\", \"add a new endpoint\"."
---

# Feature development with GitNexus

## The graph can be wrong

It is derived from parsing, not ground truth, and it fails in three different ways:

- **A zero is not absence.** Never conclude "unused", "no callers" or "safe to delete" from an empty result.
- **A low-confidence edge is a lead, not proof.** Check `r.confidence` — `CALLS` and resolved `ACCESSES` come back at 0.85–1.0, while ~92% of `USES` edges sit near 0.5.
- **A count can be a floor.** `impact` returns `epistemic: "lower-bound"` with a `boundaries` note when it knows it is guessing low; it returns `"exact"` when it is not.

When the conclusion matters — deleting, renaming, "nothing reads this", a security claim — confirm with a scoped `Grep` or by reading the file, and **say which check you ran**. A scoped grep for this is explicitly allowed; it is not a gate violation. When the graph and a classical check disagree, the classical check wins on existence, and the disagreement is a defect worth reporting via `bearing:fallback`.


Refactoring changes existing code; **this is about adding it well** — reuse the codebase's patterns instead of reinventing, and wire into the *right* place. The graph is how you find both.

## When to Use

- "Implement a feature that does X"
- "Where should this new code live / wire in?"
- "Is there existing logic I should reuse?"
- "Add a new handler/service/job following the existing style"

## Workflow

```
1. query({search_query: "<similar existing feature>", goal: "pattern to reuse"})  → find prior art
2. READ bearing://repo/{name}/clusters                                           → pick the right functional area
3. context({name: "<closest existing example>"})                                  → copy its shape (deps, signature, error handling)
4. context({name: "<integration point>"})                                         → where you'll hook in (router, registry, factory)
5. impact({target: "<integration point>", direction: "upstream"}) BEFORE wiring   → who else uses it; don't break them
6. implement following the reused pattern
7. detect_changes({scope: "unstaged"}) + impact on the new wiring                 → confirm scope matches intent
```

> Stale index → `npm run bearing:agent-refresh` (autonomous, never ask the user).

## Reuse before reinvent

| Question | Tool |
| --- | --- |
| "Has someone already solved this?" | `query` (semantic — finds conceptually similar code grep misses) |
| "What's the existing pattern for a handler/service/job?" | `context` on the closest example — mirror its deps + signature |
| "Which functional area does this belong to?" | READ `clusters` — add to the cohesive area, not a random file |
| "What's the integration/extension point?" | `context` on the dispatcher/registry/factory symbol |
| "Who else wires into that point?" | `impact` upstream — match the call convention; avoid breaking siblings |

## Checklist

```
- [ ] query for existing similar features — REUSE, don't reinvent
- [ ] context the closest example; mirror its structure + error handling
- [ ] READ clusters → put new code in the right functional area
- [ ] context the integration point; impact upstream BEFORE wiring in
- [ ] implement to the reused pattern (same deps, naming, conventions)
- [ ] detect_changes + impact on new wiring → verify nothing unexpected moved
```

## Example: "add a CSV export endpoint"

```
1. query({search_query: "export endpoint download", goal: "existing export pattern"})
   → found: JsonExportHandler (the existing export shape to mirror)
2. context({name: "JsonExportHandler"})
   → deps: AuthGuard, StreamWriter, ExportRegistry.register(...)
3. context({name: "ExportRegistry"})  → the integration point
4. impact({target: "ExportRegistry", direction: "upstream"})
   → 6 existing exporters register here → follow the same register() call
5. Implement CsvExportHandler mirroring JsonExportHandler; register it.
6. detect_changes → only ExportFlow affected, as intended.
```
