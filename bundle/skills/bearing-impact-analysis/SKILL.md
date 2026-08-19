---
name: bearing-impact-analysis
description: "Use when the user wants to know what will break if they change something, or needs safety analysis before editing code. Examples: \"Is it safe to change X?\", \"What depends on this?\", \"What will break?\""
---

# Impact Analysis with GitNexus

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

## When to Use

- "Is it safe to change this function?"
- "What will break if I modify X?"
- "Show me the blast radius"
- "Who uses this code?"
- Before making non-trivial code changes
- Before committing — to understand what your changes affect

## Workflow

```
1. impact({target: "X", direction: "upstream"})  → What depends on this
   ↳ READ `epistemic`, `boundaries`, `causes` — not just `impactedCount`
2. READ bearing://repo/{name}/processes                   → Check affected execution flows
3. detect_changes()                               → Map current git changes to affected flows
4. Assess risk and report to user
```

> If "Index is stale" → run `node .gitnexus/run.cjs analyze` in terminal.

## Checklist

```
- [ ] impact({target, direction: "upstream"}) to find dependents
- [ ] For high-risk runtime/security/core edits: impact({target, direction: "upstream", mode: "pdg"}) if PDG layer exists
- [ ] Review d=1 items first (these WILL BREAK)
- [ ] Check high-confidence (>0.8) dependencies
- [ ] READ processes to check affected execution flows
- [ ] detect_changes() for pre-commit check
- [ ] Assess risk level and report to user
```

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

## Tools

**impact** — the primary tool for symbol blast radius. Use `mode: "pdg"` for high-risk changes after a PDG refresh:

```
impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3
})

impact({
  target: "validateUser",
  direction: "upstream",
  mode: "pdg"
})

→ d=1 (WILL BREAK):
  - loginHandler (src/auth/login.ts:42) [CALLS, 100%]
  - apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

→ d=2 (LIKELY AFFECTED):
  - authRouter (src/routes/auth.ts:22) [CALLS, 95%]
```

**detect_changes** — git-diff based impact analysis:

```
detect_changes({scope: "staged"})

→ Changed: 5 symbols in 3 files
→ Affected: LoginFlow, TokenRefresh, APIMiddlewarePipeline
→ Risk: MEDIUM
```

## Example: "What breaks if I change validateUser?"

```
1. impact({target: "validateUser", direction: "upstream"})
   → d=1: loginHandler, apiMiddleware (WILL BREAK)
   → d=2: authRouter, sessionManager (LIKELY AFFECTED)

2. READ bearing://repo/my-app/processes
   → LoginFlow and TokenRefresh touch validateUser

3. Risk: 2 direct callers, 2 processes = MEDIUM
```
