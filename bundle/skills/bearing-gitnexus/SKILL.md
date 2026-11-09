---
name: bearing-gitnexus
description: Use ONLY when the user explicitly asks for GitNexus or the code graph — "use gitnexus", "use the graph", "check with the knowledge graph", "what does the graph say", /bearing-gitnexus — or asks for a graph-based blast radius, callers, or change-impact analysis, or asks to refresh, rebuild or check the GitNexus index ("refresh the gitnexus index", "is the graph up to date?", /bearing-gitnexus refresh). Do NOT load it for ordinary searching, reading or editing; Grep and Read are the defaults and nothing here replaces them.
---

# GitNexus — the code graph, when the user asks for it

GitNexus indexes this repository into a graph of symbols, calls, imports, fields and execution
flows, served over MCP as `mcp__gitnexus__*` tools. bearing does not push you to it: the user
invoked this skill because they think the graph will help here. Use it for that question, read its
answers carefully, and say plainly when it cannot help.

## 1. Check scope FIRST

The index is ONE checkout at ONE commit — not the repository (NS-26). Run:

```bash
node .bearing/lib/index-scope.mjs
```

It prints whether this session is inside the indexed tree and how far behind HEAD the index is.
Linked git worktrees, other branches and PR refs, other repos, uncommitted files, `node_modules`,
`.e2e/` and `.bearing/` are NOT indexed. There, "not found" means "not indexed", not "absent" —
tell the user, and use Grep/Read instead.

If the index is behind and the question depends on recent code, **say how far behind it is and ask
whether to refresh** — do not refresh on your own. Nothing refreshes the index automatically, by
design: on a large repo a refresh takes minutes and holds a lock, so when it runs is the developer's
call. How to run one: *Refreshing the index*, below. Every tool takes `repo: "__GITNEXUS_REPO__"`.

## Refreshing the index — when the user asks

No hook, commit or CI job refreshes the index; the developer does, usually by asking you
("refresh the gitnexus index", `/bearing-gitnexus refresh`). Then:

| Ask | Run |
| --- | --- |
| Is it current? | `node scripts/bearing-agent.mjs status` |
| Refresh it | `node scripts/bearing-agent.mjs refresh` — diagnoses first, then does the least that fixes it: nothing, an incremental pass, or a rebuild only where one is required |
| Rebuild from scratch | `node .bearing/lib/refresh-cli.mjs . --force` |
| Build the PDG / taint layer too | `node .bearing/lib/refresh-cli.mjs . --pdg` |

These work in every install, stealth included; `npm run bearing:agent-status` and
`npm run bearing:agent-refresh` are the same commands where the npm scripts exist. Report what the
refresh did — the tier it chose and why, or the error — and if it failed, say the graph may be stale
rather than carrying on as if it were current.

## 2. Where the graph earns its keep

- **Blast radius of a plain function or method across modules** — `impact({target, direction: "upstream"})`.
  Measured 3× (234 files) to 13× (709 files) cheaper than grepping and reading every hit.
- **What a diff touches, including INDIRECT dependents** — `detect_changes({scope: "staged"})`. This is
  the case text search reliably misses: a page that depends on a changed constant only through two
  wrappers. In the eval it was the one task where the graph changed the answer.
- **Renaming across files** — `rename({symbol_name, new_name, dry_run: true})`. Review every
  `text_search` edit individually; those are regex matches, not graph-resolved.
- **Structural questions with no text form** — override chains, N-hop call paths, process steps, what
  a type contains: `cypher` (read `gitnexus://repo/__GITNEXUS_REPO__/schema` first).
- **Orienting in unfamiliar code** — `query` with a natural-language concept, not a keyword.

On a small repo, plain grep is often just as good and cheaper — say so rather than forcing the graph.

## 3. Where its count is a FLOOR — complete it with grep

| Shape | Why the graph misses some | The grep that completes it |
| --- | --- | --- |
| JSX component | rendered as `<Name/>`, through barrels and `as` aliases | `<Name`, plus any alias |
| Object-literal property | `helpers.fn` is a property read, not a resolved call | `.fn` |
| Injected store / context / props receiver | the receiver type is not resolved | `.method(` |
| Callback passed as a value | a value reference, not a call | the name |
| ORM column / table const | a plain-object property | the column name |

When the graph and grep disagree on whether something exists, grep wins — and the disagreement is
worth reporting: `node scripts/bearing-agent.mjs fallback -- "<tool> said X, grep finds Y at file:line>"`
appends it to the GitNexus failure log (`bearing:fallback-log`).

## A graph ZERO is not evidence of absence

The graph is authoritative about what it **finds**, never about what it **fails to find**. `impact`, `context`, `query` and `cypher ACCESSES` return **empty for things that demonstrably exist** — production callers reported as test-only, `ACCESSES` with 0 rows for a field read on every request, an exported const showing no references on a *fresh* index.

- A **positive** result is evidence *in proportion to its confidence*. A resolved edge (`CALLS`, `ACCESSES` at 0.85–1.0) is solid — use it. A near-0.5 edge is the indexer's best guess at something it could not resolve, and ~92% of `USES` edges are exactly that. **The graph is derived, not ground truth: it can be confidently wrong, not only silently empty.**
- A **zero is not a finding.** Never conclude "dead code", "no callers", "unused field", "nothing reads this" or "safe to delete" from an empty graph result alone.
- Before any such conclusion, **confirm classically** — a `Grep` scoped to the owning file or directory, a route/registration/DI search, a string search for the name — and **say which check you ran**.
- When the graph and a classical check disagree, the **classical check wins on existence**, and the disagreement is a defect worth reporting: `node scripts/bearing-agent.mjs fallback -- "context returned 0 callers for X but grep finds N at <file:line>"`.

A confident zero is worse than no answer, because it *looks* like knowledge. Treat it as "unknown", not "none".

**And the tool now tells you when it is guessing low — READ THOSE FIELDS.** `impact` returns
`epistemic`, `boundaries` and `causes` alongside the count. When `epistemic` is `"lower-bound"`, the
number is a floor, not a total, and `boundaries` says in words why — e.g. *"IDraft is an interface
with 14 interface-level consumers; callers that bind via the interface are not traced to the
concrete symbol — actual impact may be higher."* `causes` breaks it down: `dispatchBoundary`,
`receiverTyping`, `externalBoundary`.

Reporting `impactedCount` as the answer while the same response says *may be higher* is the confident
zero wearing a number. **Quote the boundary.** "20 affected, and a lower bound — 14 consumers bind
through the interface and are not traced" is the honest sentence; "20 affected" is not.

## Reading the tools — where each is silently wrong

Every subsection here is a way to be confidently wrong that the tool REPORTS in its own response and
you have to read. None of them is an error; each looks like an answer.

### When to escalate to `cypher` (after `query` / `context`)

READ `gitnexus://repo/__GITNEXUS_REPO__/schema` before ad-hoc Cypher.

| Question | Cypher edge / pattern |
| --- | --- |
| Who reads/writes field/property X? | `ACCESSES` with `reason: read` / `write` |
| **Who uses this interface / type?** | **`USES`** → `Interface` / `TypeAlias` |
| **What does this type contain?** | **`HAS_PROPERTY`** → `Property` |
| **Full path of a property** | `HAS_PROPERTY` (owner→property) + `ACCESSES` (property→reader, with `reason`) |
| Custom N-hop call chain | `CALLS` variable-length path |
| Method override chain | `METHOD_OVERRIDES` |
| Ordered steps in a process | `STEP_IN_PROCESS` + `r.step` |
| All methods on a class | `HAS_METHOD` |
| Diamond / multi-inheritance | `EXTENDS` multi-path MATCH |
| Circular file imports | `check({ cycles: true })` — a tool, not a query |

**The TYPE layer is indexed, and it is most of a TypeScript codebase.** Nodes: `Interface`,
`TypeAlias`, `Property`, `Const`, `Variable` alongside `Function`/`Method`/`Class`. Edges: **`USES`**
(a function, method, class or file uses a type) and `HAS_PROPERTY` (a type owns a field). Measured on
one real repo: 23,018 `Property` nodes, 2,941 `Interface`, 7,280 `USES` edges, 17,910 `HAS_PROPERTY`,
35,511 `ACCESSES` — the type and field layer is *larger* than the call graph. "Who uses this
interface" and "where does this property actually get read" are graph questions, and asking them by
grep throws that away.

**But EDGES CARRY A `confidence`, and it is not decoration.** Measured on the same repo:

| Edge | Typical confidence | Read it as |
| --- | --- | --- |
| `ACCESSES` | 1.0 (26,175) · 0.85 (6,162) | resolved — trust it |
| `CALLS` | 0.85 (20,031) · 0.7 (5,573) | resolved — trust it |
| `USES` | **0.53 (3,561) · 0.51 (2,426)** · 0.85 (599) | **a lead, not proof** — ~92% sit near 0.5 |

So a `USES` answer is a strong place to look and a weak thing to conclude from. Ninety-two percent of
those edges are the indexer's best guess at a type reference it could not fully resolve. Filter when
you need certainty — `impact` takes `minConfidence`, and `cypher` can compare `r.confidence` directly
— and when you report a type's consumers without filtering, say the list is inclusive rather than
exact. `CALLS` and a resolved `ACCESSES` are a different class of evidence and can be stated plainly.

### Line numbers: raw Cypher is 0-BASED, the tools are 1-BASED

`startLine` / `endLine` are tree-sitter rows. **Raw `cypher` returns them 0-based; `context`, `query`,
`impact`, `explain` and `pdg_query` present them 1-based** — so the same symbol comes back with
different numbers depending on how you asked, and nothing warns you.

Verified: `cypher` reports a function at `startLine: 149`; line 149 of that file is ` */`, the close
of its docblock. The function is on 150.

- From **raw cypher** → read `(startLine+1)..(endLine+1)`, e.g. `sed -n '150,228p' file`.
- From **context / query / impact** → use the numbers as given.
- `content` holds the exact symbol span if you would rather not do arithmetic at all.

Off by one, silently, on every jump from a cypher result into a file. BasicBlock and PDG statement
lines are separately 1-based.

### `impact` on a hub symbol — the parameters that stop it truncating

A hub symbol returns hundreds of affected symbols, and a truncated impact result is a blast radius
that looks smaller than it is — the dangerous direction. The tool has escapes; use them rather than
letting the answer get cut:

| Parameter | Use |
| --- | --- |
| `summaryOnly: true` | counts, risk, affected processes and modules — no per-symbol list. The right first call on anything central. |
| `limit` / `offset` | page through `byDepth` when you do need the names |
| `kind: "Interface"` | disambiguate a common name instead of guessing which match it took |
| `relationTypes: [...]` | narrow the traversal — `ACCESSES` is excluded by default, so ask for it explicitly to trace field usage |
| `minConfidence` | drop the near-0.5 guesses when you need certainty rather than leads |
| `includeTests: true` | tests are excluded by default; include them before deleting anything |

`epistemic` comes back `"exact"` too, not only `"lower-bound"` — when it says exact, state the number
plainly. That is the point of reading the field rather than assuming either way.

### `context` carries the same envelope — and `causes` COUNTS WHAT IT LOST

`context` returns `epistemic` / `boundaries` / `causes` exactly like `impact`, and the `causes` fields
are counts of **missing things**, not descriptions:

- `causes.receiverTyping: 14` — the analyzer **dropped 14 call sites** on this name because it could
  not type the receiver. They exist; this view does not list them.
- `causes.externalBoundary: n` — that many calls left the indexed program (`fetch`, stdlib, a
  framework). Not a gap in the code, a gap in what is indexed.
- `causes.dispatchBoundary: n` — bound through an interface or dynamic dispatch, not traced to the
  concrete symbol.

So "no callers" from `context` with `receiverTyping > 0` is not "no callers" — it is "we lost this
many". That is the most concrete form of the graph being wrong rather than empty, and it is sitting
in the response.

**Ambiguous `context`: read `totalCandidates`, not `candidates.length`.** When several symbols share
a name the reply carries ranked candidates, and the array is a WINDOW — `candidatesTruncated: true`
and a "(showing M)" suffix. `totalCandidates` is the real number. Disambiguate with `kind` and
`file_path`, or pass the `uid` from any earlier result for a zero-ambiguity lookup; every result
carries one, so re-resolving by name is a step you rarely need.

### Defaults that quietly narrow the answer

| Tool | Default | Consequence |
| --- | --- | --- |
| `query` | `limit: 5` processes, `max_symbols: 10` | one call is a SLICE, not a survey — raise them before concluding "that is all there is" |
| `impact` | tests excluded, `ACCESSES` excluded | "no callers" means "no non-test callers, ignoring field access" |
| `context` / `query` | `include_content: false` | names and locations only; ask for content instead of a second Read round trip |
| all three | `maxTokens` | cap the response deliberately rather than discovering the cap by truncation |

Phrase `query`'s `search_query` as a natural-language **concept** ("where tokens are validated"),
not a keyword — that is what feeds the embedding ranker; pass `task_context` + `goal`. A known symbol
name is a `context` call, not a `query`.

`detect_changes` also takes **`worktree`** — an absolute path to a linked git worktree. The server
detects the common case itself, but when it was started somewhere other than the worktree you are
editing, an unstaged diff comes back empty and nothing says why.

### `rename` mixes two kinds of evidence — read the tag on every edit

`rename` is the right tool and it is **not** all graph. Every edit is tagged:

- `confidence: "graph"` — resolved through the knowledge graph. Safe to accept.
- `confidence: "text_search"` — a REGEX match. This is find-and-replace, labelled.

Measured on a real rename: 7 edits, **4 graph and 3 text_search** — 43% regex. Those three landed on
an object-literal key in a spec file that happened to share the name. Correct there; in another
codebase the same pattern hits an unrelated key with the same spelling.

So `dry_run: true` (the default) is not a formality. Read `graph_edits` vs `text_search_edits`,
review every `text_search` line individually, and never accept a preview wholesale because the tool
is "safer than find-and-replace" — part of it *is* find-and-replace. Run `detect_changes` after.

### `trace` tells you where the chain broke

When no path exists, `trace` reports the **furthest reachable node** — so a failed trace is a
diagnosis, not a dead end: that is where the chain stops. Check `truncated: true` before believing
it, though; that means a traversal cap was hit, so "no path" is really "gave up". `maxDepth`
defaults to 10 (max 30) and `includeTests` is false.

Each hop carries its own edge type and confidence in `edges[]`, so a path that is technically
connected through one weak hop is visible as such rather than reading as solid.

### `explain`: an absent flow is not proof of safety

Taint findings need `--pdg`; without it you get a clear "no taint layer" note rather than an error —
and an empty result then means *nothing was checked*. Cross-function matching is by callee **name**
and context-insensitive, so a flow into one of two same-named callees over-attributes to both.
`totalFindings` is the true count; the page you got may be `truncated`.

### One query for a file's contents

`DEFINES` (File → symbol) is the largest edge type after the obvious ones and answers "what is in this
file" without reading it — 277 symbols in one result on a real repo. Cheaper than a Read for
orientation, and it gives you names to feed `context`.

### Symbol properties worth querying

Nodes carry more than a name — `returnType`, `parameterCount`, `isAsync`, `visibility`,
`annotations`, `declaredType` on symbols; `cohesion` and `symbolCount` on a `Community`; `processType`
and `stepCount` on a `Process`. Signature-shaped searches are one query instead of reading every file.
`cohesion` measured 0.04–0.98 on one repo, so read it before trusting an area name. Full list: the
schema resource, `gitnexus://repo/__GITNEXUS_REPO__/schema`.

**Three `Community` fields are always empty — do not query them.** `keywords`, `description` and
`label` are filled by an enrichment pass the analyzer ships and never calls. Measured across three
unrelated indexes (270, 543, 1126 communities): empty 100% of the time, and `label` identical to
`heuristicLabel` on every node. An empty `keywords` says the pass did not run, not that the area has
no keywords. Use `heuristicLabel`, `cohesion`, `symbolCount`, `MEMBER_OF`.

A graph with symbols but no embeddings counts as stale: semantic `query` ranking needs them, and only
a rebuild adds them — `refresh` detects that and rebuilds (*Refreshing the index*, above).

## Deep precision — PDG, taint, trace

When `cypher` isn't enough, escalate to statement-level tools.

**These need a PDG index, and it is NOT built by default.** PDG roughly triples node count, so
bearing does not build it by default — ask for it (`refresh-cli.mjs . --pdg`, under *Refreshing the index*). Without one every tool
below returns **zero rows, which is not an answer**: build it first, or say plainly you could not
check. Keeping it fresh is the user's call, not something to trigger mid-task.

| Need | Tool |
| --- | --- |
| Statement-level blast radius (control + data) | `impact` with `mode: "pdg"` — add **`line`** to anchor it |
| What predicate controls a line / why does it run? | `pdg_query` (`mode: "controls"`) |
| Where does a variable's value flow / reach? | `pdg_query` (`mode: "flows"`) |
| Source → sink path between two symbols | `trace` |
| Taint review — injection, path traversal, XSS | `explain` |

**`impact` with `mode: "pdg"` takes a statement anchor.** Pass `line` — 1-based, inside the symbol —
and the slice seeds on THAT statement; without it you get blunter whole-symbol reach. Measured: a
`line` on `const project = (job.rawJson ?? {})` returned 52 downstream statements, correctly
including a read eleven lines below.

**The trap: a `line` that is not a statement DEGRADES SILENTLY.** A blank line, comment or brace
returns `affectedStatements: []` *alongside a populated `byDepth` and a non-zero `impactedCount`* —
it reads as "this statement affects nothing", the most dangerous wrong answer this tool gives. Only
`epistemic` separates them: `pdg-intra-procedural` is a real slice, `pdg-no-block-at-line` means no
statement started at your line and the empty slice says nothing about the code. Check it every time.

Three more fields carry weight. `scope` (`"intra"`/`"inter"`) shows where the slice crossed a call.
`pdgEvidence.interprocedural: "callgraph-bridge"` means `byDepth` arrived by the ordinary call graph,
NOT statement dependence — do not present it as the latter. `pdgEvidence.ascent.returnFlowFound:
false` means callers depending on a callee's RETURN value are missing; out-parameter ascent,
callee-written shared variables and exception ascent are not modelled at all. `risk: "UNKNOWN"` is
this mode's contract, not a low-risk finding.

**Zero taint findings is not a clean bill of health.** `explain` returns `findings: []` on a
perfectly healthy layer — closure/callback, property/field and implicit flows are not modelled, and
the tool says so in its own `note`. Read it to tell "no flows found" from "no layer to look in", and
report the difference.

## Full tool surface — reach for the right one

Every MCP tool ships its own `WHEN TO USE` in its schema, and those schemas are already loaded — so
this is the surface, not a second description of it. Single-repo; cross-repo `group_*` is out of
scope for this kit.

Orient `query` · one symbol `context` · structural precision `cypher` · before an edit `impact` ·
before a commit `detect_changes` · symbol rename `rename` (dry_run) · A→B path `trace` · import
cycles `check` · MCP/RPC tool definitions `tool_map` · statement-level `pdg_query` · taint `explain` ·
HTTP routes `api_impact` / `route_map` / `shape_check` · multi-repo disambiguation `list_repos`.

**What the schemas do not tell you is where each one is silently wrong** — that is what the sections
above are for, and it is the reason to read them rather than trust a tool's own summary.

Cheap resource reads (prefer before heavy tools): `READ gitnexus://repo/__GITNEXUS_REPO__/{context|schema|clusters|processes|process/<name>}`.

<!-- feature: gitnexus -->
### The three route tools are only as good as `Route` node coverage — CHECK IT FIRST

`api_impact`, `route_map` and `shape_check` all read `Route` nodes, and route detection is
FRAMEWORK-DEPENDENT. Where the indexer does not recognise a framework they do not degrade politely —
they answer as if the API does not exist.

Measured: a NestJS backend with **33 `@Controller` classes and 210 route decorators** indexed **3**
`Route` nodes, none of them endpoints. `api_impact({route: "/venues"})` answers *"No routes found"*
for a live endpoint, and a not-found reads like a safe change — the most dangerous shape a wrong
answer can take. One query catches it:

```
MATCH (r:Route) RETURN count(*)
```

Near-zero against the handlers visible in source (`@Controller`, `router.get`, a `pages/api` tree)
means these three are blind here: say so, and use `query`/`context`/`cypher` on the controllers,
which do work. `shape_check` additionally needs `responseKeys` from `.json({...})` calls, so a
framework returning objects directly (NestJS, FastAPI) produces none — an empty result means nothing
was extracted, never that the shapes agree.

### `check` — cycles, and which ones actually matter

`check({cycles: true})` returns directed `IMPORTS` cycles between files, with
`enumeration: "complete"` when the list is exhaustive — read that field before treating a count as
the whole picture. On one real backend: 34 cycles across 5 components.

Read the result before reporting it. Cycles among ORM entity files are usually TYPE-position
imports and benign in TypeScript; cycles between DI module files (`x.module.ts` ↔ `y.module.ts`) are
the ones that force `forwardRef` and break initialisation order. Same count, very different
findings — the tool does not distinguish them, and neither does a raw number in a report.
