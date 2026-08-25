---
name: bearing-exploring
description: "Use when the user asks how code works, wants to understand architecture, trace execution flows, or explore unfamiliar parts of the codebase. Examples: \"How does X work?\", \"What calls this function?\", \"Show me the auth flow\""
---

# Exploring Codebases with GitNexus

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


## The type layer is indexed too

On a typed codebase most of the graph is not the call graph:

| Question | Query |
| --- | --- |
| Who uses this interface / type? | `USES` → `Interface` / `TypeAlias` |
| What fields does this type own? | `HAS_PROPERTY` → `Property` |
| Where is this property actually read or written? | `HAS_PROPERTY` then `ACCESSES` (carries `reason: read`/`write`) |
| Circular imports between files | `check({ cycles: true })` |

Measured on one real repo: 23,018 `Property` nodes and 7,280 `USES` edges against 27,611 `CALLS`.

**Raw cypher line numbers are 0-BASED; every other tool hands them to you 1-BASED.** A function
reported at `startLine: 149` begins on line 150 — 149 is the last line of its docblock. Jumping
straight from a cypher result into `Read`/`sed` lands one line early, every time, silently. Add 1 to
values that came from cypher; use `context`/`query`/`impact` numbers as given.

**Check `r.confidence` before you conclude.** `CALLS` and resolved `ACCESSES` come back at 0.85–1.0;
**~92% of `USES` edges sit at 0.51–0.55** — the indexer's best guess at a type reference it could not
fully resolve. Treat a `USES` result as where to look, not as the finding, and say so when you report
it. `cypher` can filter on `r.confidence`; `impact` takes `minConfidence`.

## Workflow

```
1. READ gitnexus://repo/{name}/context             → Codebase overview, check staleness
2. query({search_query: "<what you want to understand>"})  → Find related execution flows
3. context({name: "<symbol>"})            → Deep dive on specific symbol
4. cypher({statement, params})                → Field ACCESSES, N-hop chains, overrides (READ schema first)
5. READ gitnexus://repo/{name}/process/{name}      → Trace full execution flow
```

> Stale index → `npm run bearing:agent-refresh` (always includes `--embeddings`; an index
> without them counts as stale).

## Resources

| Resource                                | What you get                                            |
| --------------------------------------- | ------------------------------------------------------- |
| `gitnexus://repo/{name}/context`        | Stats, staleness warning (~150 tokens)                  |
| `gitnexus://repo/{name}/clusters`       | All functional areas with cohesion scores (~300 tokens) |
| `gitnexus://repo/{name}/cluster/{name}` | Area members with file paths (~500 tokens)              |
| `gitnexus://repo/{name}/process/{name}` | Step-by-step execution trace (~200 tokens)              |

## Worked example — "how does payment processing work?"

```
1. READ gitnexus://repo/{repo}/context      → 918 symbols, 45 processes
2. query({ search_query: "payment processing" })
   → CheckoutFlow: processPayment → validateCard → chargeStripe
   → RefundFlow:   initiateRefund → calculateRefund → processRefund
3. context({ name: "processPayment" })
   → Incoming: checkoutHandler, webhookHandler
   → Outgoing: validateCard, chargeStripe, saveTransaction
   → Processes: CheckoutFlow (step 2/5)
4. Read src/payments/processor.ts at the lines context cited — offset/limit, not the whole file
```

A grep gives you neither of the two things that matter here: the flow NAME each symbol belongs
to, and its position in it. "step 2/5" is what turns a list of callers into an order of operations.

`context` also carries `epistemic` / `causes`. A non-zero `causes.receiverTyping` means call sites
were dropped because the analyzer could not type the receiver — "no incoming" then means "we lost
this many", not "nothing calls it".
