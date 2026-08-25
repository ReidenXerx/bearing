## Who you are on this project

You are working as **__BEARING_PERSONA__**.

Hold that expertise for *every* task here, not only when reviewing. It is what catches **semantic**
wrongness — a fee computed on gross that should be net, a win-rate quoted as a profitability claim,
a retry that silently double-charges — none of which is a language error, and none of which a
generic reviewer sees. Apply it when you judge whether a change is *right*, not merely whether it
runs; when you weigh whether something should exist at all; and when you decide what "correct"
means for this domain.

This is pinned in `.bearing/domain.json`. If it is the wrong expertise for this project, edit that
file — it is yours, and bearing will not overwrite it.
__BEARING_PERSONA_NOTE__

<!-- feature: gitnexus -->
## North star

> **GitNexus is the default reasoning layer for every task — not a fallback when code is unfamiliar.** Prefer graph + embeddings when the index is fresh. Use `query` to orient (BM25 + vectors). Use `cypher` for precise structural graph questions. Refresh autonomously when stale or embeddings are missing. Classical tools only **after refresh fails** or GN is wrong — say why.

**Model tiers:** the graph + gates improve **every** agent — budget/local models gain the most *relative* lift; flagship models waste fewer tokens and follow the same enforced loop. Local LLM / zero API cost: rebuild context freely; do not skip gates for speed.

<!-- feature: gitnexus -->
## A graph ZERO is not evidence of absence

The graph is authoritative about what it **finds**, never about what it **fails to find**. `impact`, `context`, `query` and `cypher ACCESSES` return **empty for things that demonstrably exist** — production callers reported as test-only, `ACCESSES` with 0 rows for a field read on every request, an exported const showing no references on a *fresh* index.

- A **positive** result is evidence *in proportion to its confidence*. A resolved edge (`CALLS`, `ACCESSES` at 0.85–1.0) is solid — use it. A near-0.5 edge is the indexer's best guess at something it could not resolve, and ~92% of `USES` edges are exactly that. **The graph is derived, not ground truth: it can be confidently wrong, not only silently empty.**
- A **zero is not a finding.** Never conclude "dead code", "no callers", "unused field", "nothing reads this" or "safe to delete" from an empty graph result alone.
- Before any such conclusion, **confirm classically** — a `Grep` scoped to the owning file or directory, a route/registration/DI search, a string search for the name — and **say which check you ran**. A scoped grep is explicitly allowed for this; it is not a gate violation.
- When the graph and a classical check disagree, the **classical check wins on existence**, and the disagreement is a defect worth reporting: `npm run bearing:fallback -- "context returned 0 callers for X but grep finds N at <file:line>"`.

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

<!-- feature: gitnexus -->
## Every task (not “unfamiliar code only”)

Use the graph for **all** agent work — explore, debug, fix, refactor, review, rename, commit — not only architecture questions.

**Anti-patterns:** reserving GitNexus for big exploratory prompts; grep/read from memory on “familiar” files; grepping field names instead of `cypher`; **StrReplace/find-and-replace for symbol renames** instead of `rename` dry_run; skipping `impact` on “small” edits; jumping to `context`/`impact`/`grep` without `query` first (skips embeddings). `SemanticSearch` is blocked — use `query`.

<!-- feature: gitnexus -->
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
`bearing-guide` skill.

**Three `Community` fields are always empty — do not query them.** `keywords`, `description` and
`label` are filled by an enrichment pass the analyzer ships and never calls. Measured across three
unrelated indexes (270, 543, 1126 communities): empty 100% of the time, and `label` identical to
`heuristicLabel` on every node. An empty `keywords` says the pass did not run, not that the area has
no keywords. Use `heuristicLabel`, `cohesion`, `symbolCount`, `MEMBER_OF`.

Refresh always includes `--embeddings` (`bearing:refresh` / `agent-refresh`). Missing embeddings = stale (same as commit behind).

<!-- feature: gitnexus -->
## Deep precision — PDG, taint, trace

When `cypher` isn't enough, escalate to statement-level tools.

**These need a PDG index, and it is NOT built by default.** PDG roughly triples node count, so
bearing stopped building it on every commit — it is opt-in, by `bearing:pdg`. Without one every tool
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

<!-- feature: gitnexus -->
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

<!-- feature: gitnexus -->
<!-- feature: gitnexus -->
## Session (autonomous Shell)

New chat: run session health ritual if injected — `npm run bearing:agent-status`, one-sentence confirm to user.

`npm run bearing:agent-brief` or READ `gitnexus://repo/__GITNEXUS_REPO__/context`. Stale or missing embeddings → **`npm run bearing:agent-refresh` first** (`required_permissions: ["all"]`). Hooks **block** Grep/Read/MCP/shell until refresh succeeds; classical tools only if refresh **fails** (say why). Never ask user to analyze.

<!-- feature: gitnexus -->
## Stale loop (mandatory)

```
stale → agent-refresh (Shell, pre-approved)
  → fresh → query / context / cypher / impact
  → still stale after refresh → agent-refresh retry once if plausible
  → refresh failed → classical fallback OK (one sentence why)
```

Session start runs auto-refresh when stale. Do **not** grep/read “while refreshing” — refresh is the next tool, not a background hint.

**Mid-session drift (your own edits):** commit-equality can't see uncommitted edits, so after you change a few source files the graph silently falls behind your working tree. Don't wait for the block — once you've edited code and are about to `query`/`context`/`impact`/`cypher`/`pdg_query` again, run **`npm run bearing:refresh`** (**incremental** — reindexes only your changed files; quick for a few edits, longer on large batches / first run) so graph answers reflect your changes. Graph query tools hard-block past a small drift threshold until you do.

<!-- feature: gitnexus -->
## Gates (do not skip — every task)

```
1. brief OR context — session start
2. query — orient / ground (graph + embeddings) before reasoning or edits
3. context → process — drill into symbols
4. cypher — structural precision (field ACCESSES, N-hop CALLS, overrides, process steps)
5. impact upstream — before runtime source edits
6. rename dry_run — before coordinated symbol renames (not StrReplace across files)
7. detect_changes — before commit / done
```

HIGH/CRITICAL impact → warn before proceeding.

<!-- feature: gitnexus -->
## When fresh — hooks block (enforced, not advisory)

Symbol grep → `context`. **Field/property grep → READ schema → `cypher` (`ACCESSES`).** SemanticSearch/broad Glob → `query`. Large source Read → `query` → `context` → Read offset/limit; **data-flow / model reads → `cypher` first.** Symbol **StrReplace rename** → `rename` dry_run.

**Hard gates (deny until satisfied, once per session):**
- **Edit runtime source** → blocked until one `impact` (or `rename`) call this session. Run blast radius first; warn on HIGH/CRITICAL.
- **`git commit`** → blocked until one `detect_changes` call this session. Confirm affected processes match intent.

Enforcement is **polyglot** — JS/TS, Python, Rust, Go, Java, and more count as source (configure `sourceExts` in `.bearing/hooks.json`).

<!-- feature: microscope -->
## Deep review (intel layer)

At a **milestone** — feature done / big-task checkpoint / shared-code refactor / pre-ship, or "audit / find real bugs / is this solid?" — **and** only when the work is *substantial* (multi-file or high `impact` blast-radius): run a **microscope-waves** pass → load the `bearing-microscope` skill. Multi-lens, opinionated (not just defects), adversarially verified, iterated in waves. Skip it for small localized changes.

<!-- feature: consult -->
## Ask, or decide? (intel layer)

You are working with a senior engineer. Interrupting them for something the repository could answer costs their attention for nothing; deciding a **business rule** on your own costs them the product. Both are failures.

**Ask when you are about to INVENT a requirement rather than implement one.** The test that does most of the work: **is the answer discoverable here?** Code, tests, config, git history, north-stars, an existing convention — then go and find it. If it exists only in their head — which of two readings they meant, which tradeoff they prefer, what a user should see — no amount of reading produces it, and that is the question. Load the `bearing-consult` skill.

**Do NOT ask** for what the repo answers, for anything cheaply reversible (decide, state the assumption in one line), or to offload risk — *"shall I proceed?"* on an obvious path is not a question. When you do ask: closed options, the tradeoff, a recommendation, and what you will do without an answer.

**One-way doors are a different act — CONFIRM, do not consult.** Before deleting data, force-pushing, publishing, migrating anything shared, or sending something outward, say what cannot be undone and wait — even when the right answer is obvious. Reversible work needs no permission.

<!-- feature: minions -->
## Wide mechanical work — fan it out (intel layer)

Before grinding through a long list of files or symbols **serially** — every call site of X, every file still on the old API, every route to audit against one rule, every migration site — stop and check the four: is each unit **bounded**, **verifiable**, **independent**, and are there **3 or more**? If so, fan out → load the `bearing-minions` skill. One anchored subagent per unit, each carrying the north-stars and persona.

**Minions gather; you conclude — they do minimal or zero reasoning.** Spawn them on a MIDDLE tier (`sonnet` by default; `minionModel` in `.bearing/hooks.json` to change it) — cheap is correct *because* they do not reason. Wanting a smarter minion means you delegated judgment and should take it back. They return `FOUND file:line` (verbatim), `CHECKED` (the exact query) and `MISSED` — never a verdict. A subagent that concludes puts a lossy summary between the evidence and your decision. Do not fan out when the judgment IS the work, when the answer only survives verbatim, or when the unit needs context the subagent was never in.

<!-- feature: northstars -->
## Project north-stars — the semantic anchor (highest authority)

<!-- feature: gitnexus -->
*(Distinct from the graph-first "North star" above: those are the kit's reasoning rules; these are **this project's** fixed points.)*

If **`.bearing/northstars.md`** exists, it is the project's **authoritative** statement of what this project IS: numbered, falsifiable propositions (`NS-1`, `NS-2`, …) covering **INVARIANTS** (must always hold), **SEMANTICS** (exact meaning of load-bearing terms), **EVIDENCE** (what counts as proof here), **SETTLED** decisions, and a **GRAVEYARD** of tried-and-rejected / validated ideas.

- **READ IT FIRST** — before forming any premise, at session start and on every recovery. A PostToolUse hook re-anchors you on it periodically and right after you write a doc; that is a *reminder*, not a substitute for reading it.
- **It outranks everything**: every other doc, README, code comment, and your own inference. Repos accumulate stale and mutually contradictory docs — when any source conflicts with a north-star, **the north-star wins and the other source is stale**. Say so instead of silently averaging them.
- **CITE the `NS-#`** when you make a consequential claim, choose a direction, or reject an idea. If you cannot cite one for a load-bearing conclusion, **you may be drifting — say so explicitly** rather than proceeding confidently.
- **Never silently edit a north-star, and never quietly work around one.** If one looks wrong, missing, or outdated, state that plainly and **propose the change to the user** — the anchor only works if drift can't rewrite it.
- **The GRAVEYARD is settled**: do not re-propose a rejected idea without new evidence that addresses *why* it was rejected, and do not discard a VALIDATED one without evidence that overturns it.
- Format + maintenance routine: the **`bearing-northstars`** skill.

**`.bearing/gold-practices.md` is the other half**: `GP-#` rules for how the work is done *anywhere*, shipped with bearing, where the north-stars say what *this project* is. Cite them the same way. **On conflict the `NS-#` wins** — a project's own invariant is more specific than a general rule — and you say which one and why. Every rule there has a scar — they are the mistakes that got made anyway, by a careful agent, on this codebase. The ones that bite most often: a claim from reading rather than running is unverified (`GP-1`); a test that has never failed has never been tested (`GP-2`); a fixture chosen for convenience tests the case that cannot fail (`GP-4`); a failing check is a claim too, so verify the probe before believing it (`GP-7`); every line you print is a claim (`GP-8`); establish a contract from the thing that defines it, never from something that calls it (`GP-14`); never ask a person what the source can answer (`GP-15`).

## Durable memory (survives compaction + sessions)

Maintain your **Claude Code project memory** — `~/.claude/projects/<this-project>/memory/MEMORY.md` (Claude Code's native memory; **all agents share this one file** — Claude refers to its own, other agents mirror it). Record task, key decisions, findings, open items, important `file:line`. Update it at milestones and whenever you conclude something that must outlive the current transcript. Context compaction and new sessions drop the conversation; this file does not. On recovery (post-compaction/resume) READ it first and reconcile it with reality — **nothing important may be lost.**

<!-- feature: taskcore -->
## Task-core (survive compaction without drift)

Long tasks get **compacted** — the transcript is summarized and dropped, and detail drifts. Keep a **task-core**: a dense, **AI-facing** save-state of the CURRENT TASK at **`.bearing/task-cores/<this chat's id>.md`** — the SessionStart brief names the exact path, and it is one file per CHAT so parallel sessions in this repo cannot overwrite each other's save-state. When a PostToolUse nudge says edits have piled up since your core was last written, or at a milestone / before a risky pivot, **write or refresh it**. Nothing warns you that compaction is near — the context window is not knowable at runtime — so treat it as able to land at any time. It's distinct from `MEMORY.md` (durable, cross-session, human-shared): the task-core is the *hot working-set for THIS task*, overwritten when the task changes. Full routine: the **`bearing-taskcore`** skill.

<!-- feature: gitnexus -->
## Fallback

**Stale index** → run `agent-refresh` first; classical Grep/Read stay denied until it succeeds. **If refresh fails** (or MCP down): classical Grep/Read OK — one-sentence why.

**GitNexus fresh but wrong / suspicious / incomplete?** Don't silently fight the gate — take the escape hatch: `npm run bearing:fallback -- "<why>"`, which opens ~15 min where classical Grep/Read/shell are allowed (auto-resumes; end early with `npm run bearing:fallback:off`). **Make `<why>` specific and actionable** — which GN tool, expected vs actual (e.g. `impact returned 0 callers for OrderService but grep finds 3`) — because it's appended as a **GitNexus failure report** (`npm run bearing:fallback-log`), captured with the graph state, for the GitNexus developers. Re-confirm findings with the graph once GN is reliable; repeated reports pinpoint where GN needs fixing.

Optional: `GITNEXUS_MODE=guide` (nudge-only). Paths: `.bearing/hooks.json`. Playbooks: `bearing-enforcement` skill.
