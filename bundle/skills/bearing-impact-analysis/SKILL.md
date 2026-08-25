---
name: bearing-impact-analysis
description: "Use when the user wants to know what will break if they change something, or needs safety analysis before editing code. Examples: \"Is it safe to change X?\", \"What depends on this?\", \"What will break?\""
---

# Impact Analysis with GitNexus

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


## The count is a floor, not a total

`impact` reports its own limits and the fields are easy to skim past:

```json
"impactedCount": 20,
"epistemic": "lower-bound",
"boundaries": ["IDraft is an interface with 14 interface-level consumers; callers that
                bind via the interface are not traced — actual impact may be higher."],
"causes": { "receiverTyping": 0, "dispatchBoundary": 14, "externalBoundary": 0 }
```

When `epistemic` is `"lower-bound"`, saying "20 things are affected" contradicts the same response,
which said *may be higher*. **Quote the boundary**: "20 affected, and that is a floor — 14 consumers
bind through the interface and are not traced." Then close the gap the boundary names, with a scoped
grep or a `USES` query, and say which one you ran.

`risk: "UNKNOWN"` is the same thing in a different field: unresolved, not low.

## Hub symbols: ask for the summary first

A central symbol returns hundreds of rows, and a truncated impact result is a blast radius that reads
smaller than it is. Start with `summaryOnly: true` — counts, risk, affected processes and modules,
no per-symbol list — then page with `limit`/`offset` only if you need the names.

Other escapes worth knowing: `kind` disambiguates a common name, `relationTypes` narrows the walk
(`ACCESSES` is excluded by default — ask for it to trace field usage), `minConfidence` drops the
near-0.5 guesses, and `includeTests: true` before you delete anything, since tests are excluded by
default and "no callers" without them is not the same claim.

## Changing a type or interface

`impact` follows the type layer, so it works on an `Interface` or `TypeAlias` directly — pass
`kind: "Interface"` when the name is ambiguous. For the exact consumer list rather than a count:

```
cypher: MATCH (a)-[:CodeRelation {type:'USES'}]->(t {name:'IDraft'}) RETURN a.name, a.filePath
```

`USES` is the type-usage edge — function/method/class/file → interface/type alias. On a TypeScript
codebase this layer is *larger* than the call graph, so a type change whose blast radius you checked
only through `CALLS` was not checked.

## Workflow

```
1. impact({target: "X", direction: "upstream"})  → What depends on this
   ↳ READ `epistemic`, `boundaries`, `causes` — not just `impactedCount`
2. READ gitnexus://repo/{name}/processes                   → Check affected execution flows
3. detect_changes()                               → Map current git changes to affected flows
4. Assess risk and report to user
```

> Stale index → `npm run bearing:agent-refresh` (always includes `--embeddings`; an index
> without them counts as stale).

## Understanding Output

| Depth | Risk Level       | Meaning                  |
| ----- | ---------------- | ------------------------ |
| d=1   | **WILL BREAK**   | Direct callers/importers |
| d=2   | LIKELY AFFECTED  | Indirect dependencies    |
| d=3   | MAY NEED TESTING | Transitive effects       |

## Risk Assessment

| Affected                       | Risk     |
| ------------------------------ | -------- |
| <5 symbols, few processes      | LOW      |
| 5-15 symbols, 2-5 processes    | MEDIUM   |
| >15 symbols or many processes  | HIGH     |
| Critical path (auth, payments) | CRITICAL |

## Worked example — "what breaks if I change `validateUser`?"

```
1. impact({ target: "validateUser", direction: "upstream",
            minConfidence: 0.8, maxDepth: 3 })

   → epistemic: "exact"                     ← read this BEFORE the count
   → d=1 (WILL BREAK):
       loginHandler   src/auth/login.ts:42      [CALLS, 100%]
       apiMiddleware  src/api/middleware.ts:15  [CALLS, 100%]
   → d=2 (LIKELY AFFECTED):
       authRouter     src/routes/auth.ts:22     [CALLS, 95%]

2. READ gitnexus://repo/{repo}/processes
   → LoginFlow and TokenRefresh both touch validateUser

3. detect_changes({ scope: "staged" })
   → Changed: 5 symbols in 3 files
   → Affected: LoginFlow, TokenRefresh, APIMiddlewarePipeline
   → Risk: MEDIUM

4. Report: 2 direct callers, 2 processes → MEDIUM, and say `epistemic` was exact.
```

`mode: "pdg"` narrows this to statement level for a high-risk change, but needs the PDG layer and a
`line` anchor inside the symbol — a `line` that is not a statement returns an empty slice next to a
populated count, and only `epistemic` tells you which you got.
