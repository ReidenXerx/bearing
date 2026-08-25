---
name: bearing-feature-dev
description: "Use when ADDING new code — implement a feature, add an endpoint/handler, wire in a new module. The graph finds existing patterns to reuse and the right place to integrate. Examples: \"add a feature that does X\", \"where do I wire this in\", \"implement X like the existing Y\", \"add a new endpoint\"."
---

# Feature development with GitNexus

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


Refactoring changes existing code; **this is about adding it well** — reuse the codebase's patterns instead of reinventing, and wire into the *right* place. The graph is how you find both.

## Workflow

```
1. query({search_query: "<similar existing feature>", goal: "pattern to reuse"})  → find prior art
2. READ gitnexus://repo/{name}/clusters                                           → pick the right functional area
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
