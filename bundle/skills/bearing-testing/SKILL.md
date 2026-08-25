---
name: bearing-testing
description: "Use when deciding WHAT to test or checking coverage. The graph turns blast radius into a precise test target list and surfaces untested symbols. Examples: \"what should I test for this change\", \"is this covered\", \"write tests for X\", \"which flows need tests\"."
---

# Test targeting with GitNexus

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


Don't guess what to test — let the graph turn a change's **blast radius into the exact test surface**, and find the symbols with no test coverage.

## Workflow

```
1. impact({target: "<changed symbol>", direction: "upstream"})   → everything that could break = the test surface
2. READ gitnexus://repo/{name}/processes (or detect_changes)     → which execution FLOWS the change touches → integration tests
3. cypher: callers of <symbol> that live in test files          → existing coverage vs gaps
4. query({search_query: "<feature> tests", goal: "test pattern"}) → mirror the repo's existing test style
5. write tests for: d=1 callers (unit) + each affected process (integration) + the gap symbols
6. detect_changes({scope: "staged"}) after → confirm every affected process has a test
```

> Stale index → `npm run bearing:agent-refresh` (autonomous).

## Blast radius → test plan

| Graph result | Test to write |
| --- | --- |
| `impact` d=1 callers (WILL BREAK) | Unit test each caller's contract with the changed symbol |
| Affected **processes** (from `impact` / `detect_changes`) | One integration test per flow end-to-end |
| Changed symbol itself | Unit tests for new/changed branches (pair with `pdg_query controls` to enumerate guards) |
| HIGH/CRITICAL risk path | Regression test before the change; assert behavior is preserved |

## Coverage gaps (find untested code)

```cypher
// Symbols with callers but NONE from a test file → likely untested
MATCH (s:Function)
WHERE NOT EXISTS {
  MATCH (t)-[:CodeRelation {type:'CALLS'}]->(s)
  WHERE t.filePath CONTAINS 'test' OR t.filePath CONTAINS 'spec'
}
RETURN s.name, s.filePath
```

(READ `gitnexus://repo/{name}/schema` first — adapt node/edge names to this repo.)

## Example: "what should I test after changing computeDiscount?"

```
1. impact({target: "computeDiscount", direction: "upstream"})
   → d=1: CheckoutTotal, InvoiceBuilder ; processes: CheckoutFlow, BillingFlow
2. pdg_query({mode:"controls", target:"computeDiscount"})
   → 3 guards (member?, coupon?, minSpend?) → 3 branch cases to cover
3. cypher → CheckoutTotal has tests; InvoiceBuilder has NONE (gap)
4. Write: unit for the 3 discount branches, integration for CheckoutFlow + BillingFlow,
   and fill the InvoiceBuilder gap.
```
