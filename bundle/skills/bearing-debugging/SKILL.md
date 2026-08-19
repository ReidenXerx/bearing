---
name: bearing-debugging
description: "Use when the user is debugging a bug, tracing an error, or asking why something fails. Examples: \"Why is X failing?\", \"Where does this error come from?\", \"Trace this bug\""
---

# Debugging with GitNexus

## The graph can be wrong

It is derived from parsing, not ground truth, and it fails in three different ways:

- **A zero is not absence.** Never conclude "unused", "no callers" or "safe to delete" from an empty result.
- **A low-confidence edge is a lead, not proof.** Check `r.confidence` — `CALLS` and resolved `ACCESSES` come back at 0.85–1.0, while ~92% of `USES` edges sit near 0.5.
- **A count can be a floor.** `impact` returns `epistemic: "lower-bound"` with a `boundaries` note when it knows it is guessing low; it returns `"exact"` when it is not.

When the conclusion matters — deleting, renaming, "nothing reads this", a security claim — confirm with a scoped `Grep` or by reading the file, and **say which check you ran**. A scoped grep for this is explicitly allowed; it is not a gate violation. When the graph and a classical check disagree, the classical check wins on existence, and the disagreement is a defect worth reporting via `bearing:fallback`.


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

> If "Index is stale" → run `node .gitnexus/run.cjs analyze` in terminal.

## Checklist

```
- [ ] Understand the symptom (error message, unexpected behavior)
- [ ] query for error text or related code
- [ ] Identify the suspect function from returned processes
- [ ] context to see callers and callees
- [ ] Trace execution flow via process resource if applicable
- [ ] cypher for custom call chain traces if needed
- [ ] Read source files to confirm root cause
```

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
