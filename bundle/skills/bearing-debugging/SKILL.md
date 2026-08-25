---
name: bearing-debugging
description: "Use when the user is debugging a bug, tracing an error, or asking why something fails. Examples: \"Why is X failing?\", \"Where does this error come from?\", \"Trace this bug\""
---

# Debugging with GitNexus

## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.


## When to Use

- "Why is this function failing?"
- "Trace where this error comes from"
- "Who calls this method?"
- "This endpoint returns 500"
- Investigating bugs, errors, or unexpected behavior

## Workflow

```
1. query({search_query: "<error or symptom>"})            → Find related execution flows
2. context({name: "<suspect>"})                    → See callers/callees/processes
3. READ bearing://repo/{name}/process/{name}                → Trace execution flow
4. trace({from, to})                                 → Shortest known A→B call path
5. pdg_query({mode: "controls"|"flows"})            → Guards / data flow when PDG exists
```

> Stale index → `npm run bearing:agent-refresh` (always includes `--embeddings`; an index
> without them counts as stale).

## Debugging Patterns

| Symptom              | GitNexus Approach                                          |
| -------------------- | ---------------------------------------------------------- |
| Error message        | `query` for error text → `context` on throw sites |
| Wrong return value   | `context` on the function → `pdg_query flows` for data flow |
| Intermittent failure | `context` → look for external calls, async deps            |
| Performance issue    | `context` → find symbols with many callers (hot paths)     |
| Recent regression    | `detect_changes` to see what your changes affect           |

## Tools

**query** — find code related to error:

```
query({search_query: "payment validation error"})
→ Processes: CheckoutFlow, ErrorHandling
→ Symbols: validatePayment, handlePaymentError, PaymentException
```

**context** — full context for a suspect:

```
context({name: "validatePayment"})
→ Incoming calls: processCheckout, webhookHandler
→ Outgoing calls: verifyCard, fetchRates (external API!)
→ Processes: CheckoutFlow (step 3/7)
```

**trace** — shortest path between two known symbols:

```javascript
trace({from: "webhookHandler", to: "validatePayment"})
```

**pdg_query** — guards and data flow inside a function/file:

```javascript
pdg_query({mode: "controls", target: "validatePayment"})
pdg_query({mode: "flows", target: "validatePayment", variable: "payload"})
```

**cypher** — custom graph traces:

```cypher
MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..2]->(b:Function {name: "validatePayment"})
RETURN [n IN nodes(path) | n.name] AS chain
```

## Example: "Payment endpoint returns 500 intermittently"

```
1. query({search_query: "payment error handling"})
   → Processes: CheckoutFlow, ErrorHandling
   → Symbols: validatePayment, handlePaymentError

2. context({name: "validatePayment"})
   → Outgoing calls: verifyCard, fetchRates (external API!)

3. READ bearing://repo/my-app/process/CheckoutFlow
   → Step 3: validatePayment → calls fetchRates (external)

4. Root cause: fetchRates calls external API without proper timeout
```
