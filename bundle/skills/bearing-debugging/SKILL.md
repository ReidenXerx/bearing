---
name: bearing-debugging
description: "Use when the user is debugging a bug, tracing an error, or asking why something fails. Examples: \"Why is X failing?\", \"Where does this error come from?\", \"Trace this bug\""
---

# Debugging with GitNexus

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->

Debugging is the case where this bites hardest: "nothing else calls this" is the premise a wrong root
cause is built on.

## Workflow

```
1. query({search_query: "<error or symptom>"})     → related execution flows
2. context({name: "<suspect>"})                    → callers / callees / processes
3. READ gitnexus://repo/{repo}/process/{name}       → the flow, in step order
4. trace({from, to})                               → shortest A→B path, in one call
5. pdg_query({mode: "controls"|"flows"})           → guards / data flow (needs PDG)
```

> Stale index → `npm run bearing:agent-refresh` (always includes `--embeddings`; an index
> without them counts as stale).

## Symptom → approach

| Symptom | Approach |
| --- | --- |
| Error message | `query` the error text → `context` on throw sites |
| Wrong return value | `context` on the function → `pdg_query flows` for the data |
| Intermittent failure | `context` → look for external calls and async deps |
| Recent regression | `detect_changes` — what your own edits affect |

## Worked example — "payment endpoint returns 500 intermittently"

```
1. query({search_query: "payment error handling"})
   → Processes: CheckoutFlow, ErrorHandling
   → Symbols:   validatePayment, handlePaymentError

2. context({name: "validatePayment"})
   → Incoming: processCheckout, webhookHandler
   → Outgoing: verifyCard, fetchRates   ← external API

3. READ gitnexus://repo/my-app/process/CheckoutFlow
   → step 3/7: validatePayment → fetchRates (external)

4. Root cause: fetchRates calls an external API with no timeout.
```

Two things that response tells you and a grep never would: `validatePayment` sits at step 3 of a
named flow, and one of its callees leaves the indexed program. `causes.externalBoundary` counts those
— a non-zero value means calls left the program and this view does not list them, which is the
difference between "nothing else happens here" and "we stopped looking here".

## Custom traces

When the canned tools do not express the question:

```cypher
MATCH (a)-[:CodeRelation {type:'CALLS'}]->(m)-[:CodeRelation {type:'CALLS'}]->(b:Function {name:"validatePayment"})
RETURN a.name AS caller, m.name AS via, b.name AS target
```

A property map does NOT combine with a variable-length hop here — `-[:CodeRelation {type:'CALLS'}*1..2]->`
is a parser error, not a slow query. Spell the hops out, or drop the map and filter in `WHERE`.

`pdg_query` is intra-function and needs the PDG layer; without it you get zero rows, which is not an
answer.
