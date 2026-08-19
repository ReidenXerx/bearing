---
name: bearing-layered-systems
description: "Use when WORKING IN a complex, multi-layered architecture — trace a request through layers (controller→service→repo→model), change at the right layer, and respect boundaries/contracts between layers. For monoliths, hexagonal/onion, and monorepos with packages. Examples: \"trace this request through the layers\", \"which layer should I change\", \"what crosses this boundary\", \"change the DTO between service and API safely\"."
---

# Working across layered systems

## The graph can be wrong

It is derived from parsing, not ground truth, and it fails in three different ways:

- **A zero is not absence.** Never conclude "unused", "no callers" or "safe to delete" from an empty result.
- **A low-confidence edge is a lead, not proof.** Check `r.confidence` — `CALLS` and resolved `ACCESSES` come back at 0.85–1.0, while ~92% of `USES` edges sit near 0.5.
- **A count can be a floor.** `impact` returns `epistemic: "lower-bound"` with a `boundaries` note when it knows it is guessing low; it returns `"exact"` when it is not.

When the conclusion matters — deleting, renaming, "nothing reads this", a security claim — confirm with a scoped `Grep` or by reading the file, and **say which check you ran**. A scoped grep for this is explicitly allowed; it is not a gate violation. When the graph and a classical check disagree, the classical check wins on existence, and the disagreement is a defect worth reporting via `bearing:fallback`.


Layered systems (controller → service → repository → model; or hexagonal/onion; or monorepo packages) defeat grep because a single feature is **smeared vertically across layers** and behind interfaces. The graph re-connects them: `trace` and process flows turn "how does the HTTP handler reach the DB write?" into one answer, and cross-layer `impact`/`cypher` keep a change from silently breaking a *different* layer.

This is the *operate* counterpart to `bearing-architecture-review` (which *judges* structure).

## When to Use

- "Trace this request/event through the layers end-to-end"
- "Which layer should this change go in?"
- "What crosses this boundary (interface / DTO / port)?"
- "Change the contract between two layers safely"
- Monorepo: "what depends on this package across the others?"

## Workflow

```
1. Map the layers:
   READ bearing://repo/{name}/clusters        → functional areas ≈ layers/modules
   (HTTP? check .bearing/gitnexus-api-profile.json → framework vs custom router)
2. Trace one feature top-to-bottom:
   query({search_query:"<feature>"}) → READ process/<flow>   → the cross-layer chain + step order
   trace({from:"<entry/controller>", to:"<sink/repo/model>"}) → exact path through every layer
3. Locate the right layer to change:
   context({name:"<symbol>"})  → its module/area = its layer; change at the layer that OWNS the concern
4. Check what crosses the boundary BEFORE changing an interface/DTO/port:
   impact({target:"<boundary symbol>", direction:"upstream", relationTypes:["CALLS","IMPORTS","ACCESSES"]})
   cypher: who in OTHER layers/areas CALLS or ACCESSES it
   (HTTP boundary → api_impact + shape_check ; field/DTO boundary → cypher ACCESSES on its fields)
5. Edit at the owning layer; detect_changes → confirm the ripple stayed within intended layers.
```

> Stale index → `npm run bearing:agent-refresh` (autonomous). PDG/taint steps need `analyze --pdg`.

## Moves for layered work

| Need | Tool | Note |
| --- | --- | --- |
| See a feature across ALL layers | READ `process/<flow>` | The ordered cross-layer chain — the single best layered-systems read |
| "How does controller reach the DB?" | `trace({from, to})` | One call vs 5–8 manual `context` hops up/down the stack |
| Which layer owns a symbol | `context` → its `module`/community | Change the concern where it lives; don't leak logic up/down |
| What crosses a boundary (interface/port) | `impact` widened + `cypher` cross-area `CALLS`/`ACCESSES` | The other layers depending on this seam |
| Layer contract = HTTP response | `api_impact` → `shape_check` | Consumers in the client layer + shape mismatches |
| Layer contract = a DTO/model field | `cypher` `ACCESSES` (read vs write) on the field | Every layer reading/writing the field |
| Cross-package deps (monorepo) | `cypher` `IMPORTS` across areas + `check({cycles:true})` | Package coupling + import cycles between packages |

## Anti-patterns (layered)

- Editing a symbol without knowing its layer → logic leaks into the wrong tier. `context` first.
- Changing an interface/DTO/port from one side only → the other layer breaks silently. `impact` widened across layers BEFORE editing.
- Re-implementing a lower-layer concern in a higher layer because grep didn't surface it → `query` for the existing lower-layer logic and call down instead.
- Treating a cross-layer change as local → `detect_changes` to confirm which layers actually moved.

## Example: "add a `currency` field end-to-end"

```
1. clusters → layers: api / service / repo / model
2. query("order total currency") → READ process/CheckoutFlow
   trace({from:"OrderController.create", to:"OrderRepo.insert"})
   → Controller → OrderService.build → OrderMapper.toRow → OrderRepo.insert
3. The field is a MODEL/DTO concern → owning layer = model + mapper.
4. Boundary check before touching the DTO:
   cypher ACCESSES on Order.fields → who reads/writes order shape across layers
   api_impact on POST /orders + shape_check → client consumers of the response
5. Add `currency` at model → mapper → repo → expose in API response; update the
   one client consumer flagged by shape_check. detect_changes → api+service+repo+model moved, as intended.
```
