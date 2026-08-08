<!-- GENERATED from scripts/contract/enforcement-contract.md by scripts/gen-contract.mjs — edit there, run `npm run gen:contract`. -->

# bearing — always-on instructions

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

<!-- feature: gitnexus -->
## North star

> **GitNexus is the default reasoning layer for every task — not a fallback when code is unfamiliar.** Prefer graph + embeddings when the index is fresh. Use `query` to orient (BM25 + vectors). Use `cypher` for precise structural graph questions. Refresh autonomously when stale or embeddings are missing. Classical tools only **after refresh fails** or GN is wrong — say why.

**Model tiers:** the graph + gates improve **every** agent — budget/local models gain the most *relative* lift; flagship models waste fewer tokens and follow the same enforced loop. Local LLM / zero API cost: rebuild context freely; do not skip gates for speed.

<!-- feature: gitnexus -->
## A graph ZERO is not evidence of absence

The graph is authoritative about what it **finds**, never about what it **fails to find**. `impact`, `context`, `query` and `cypher ACCESSES` return **empty for things that demonstrably exist** — production callers reported as test-only, `ACCESSES` with 0 rows for a field read on every request, an exported const showing no references on a *fresh* index.

- A **positive** result is strong evidence: what it found is really there. Use it.
- A **zero is not a finding.** Never conclude "dead code", "no callers", "unused field", "nothing reads this" or "safe to delete" from an empty graph result alone.
- Before any such conclusion, **confirm classically** — a `Grep` scoped to the owning file or directory, a route/registration/DI search, a string search for the name — and **say which check you ran**. A scoped grep is explicitly allowed for this; it is not a gate violation.
- When the graph and a classical check disagree, the **classical check wins on existence**, and the disagreement is a defect worth reporting: `npm run bearing:fallback -- "context returned 0 callers for X but grep finds N at <file:line>"`.

A confident zero is worse than no answer, because it *looks* like knowledge. Treat it as "unknown", not "none".

<!-- feature: gitnexus -->
## Every task (not “unfamiliar code only”)

Use the graph for **all** agent work — explore, debug, fix, refactor, review, rename, commit — not only architecture questions.

| Task type | Graph role |
| --- | --- |
| Answer / explain / debug | `query` → `context` → `cypher` if structural → Read offset/limit |
| Field / property data flow | READ schema → `cypher` (`ACCESSES` read/write) |
| N-hop call chains, overrides, process steps | READ schema → `cypher` |
| Statement-level data/control flow, taint | `pdg_query` / `explain` / `trace` (see deep precision) |
| Edit runtime source (any size) | `impact` upstream before Write/StrReplace |
| Refactor / rename / shared code | `impact` + `rename` dry_run OR `context` on hub symbols |
| Review / “what did I change?” | `detect_changes`; `query` to orient |
| Session start | `agent-brief` or repo context; confirm kit health |

**Anti-patterns:** reserving GitNexus for big exploratory prompts; grep/read from memory on “familiar” files; grepping field names instead of `cypher`; **StrReplace/find-and-replace for symbol renames** instead of `rename` dry_run; skipping `impact` on “small” edits; jumping to `context`/`impact`/`grep` without `query` first (skips embeddings). `SemanticSearch` is blocked — use `query`.

<!-- feature: gitnexus -->
## Graph + embeddings + cypher (layered)

| Need | Tool | Why |
| --- | --- | --- |
| Orient — any fuzzy or grounding step | `query` | Hybrid BM25 + **embedding** vectors (RRF) |
| One symbol, callers, 360° | `context` | Structural graph (canned API) |
| **Precise structural graph questions** | **`cypher`** | Raw traversals the canned tools don't express |
| Pre-edit blast radius | `impact` | Graph traversal |
| Pre-commit / done | `detect_changes` | Diff → processes |

### When to escalate to `cypher` (after `query` / `context`)

READ `bearing://repo/__GITNEXUS_REPO__/schema` before ad-hoc Cypher.

| Question | Cypher edge / pattern |
| --- | --- |
| Who reads/writes field/property X? | `ACCESSES` with `reason: read` / `write` |
| Custom N-hop call chain | `CALLS` variable-length path |
| Method override chain | `METHOD_OVERRIDES` |
| Ordered steps in a process | `STEP_IN_PROCESS` + `r.step` |
| All methods on a class | `HAS_METHOD` |
| Diamond / multi-inheritance | `EXTENDS` multi-path MATCH |

**Order:** `query` (orient) → `context` (symbol) → **`cypher`** (structural precision) → `impact` (before edits). Do not start with `cypher` for fuzzy questions — that's what `query` + embeddings are for.

Refresh always includes `--embeddings` (`bearing:refresh` / `agent-refresh`). Missing embeddings = stale (same as commit behind).

<!-- feature: gitnexus -->
## Deep precision — PDG, taint, trace

When `cypher` isn't enough, escalate to statement-level tools (require a PDG index — `bearing:pdg`):

| Need | Tool |
| --- | --- |
| Statement-level blast radius (control + data) | `impact` with `mode: "pdg"` |
| What predicate controls a line / why does it run? | `pdg_query` (`mode: "controls"`) |
| Where does a variable's value flow / reach? | `pdg_query` (`mode: "flows"`) |
| Source → sink path between two symbols | `trace` |
| Taint review — injection, path traversal, XSS | `explain` |

<!-- feature: gitnexus -->
## Full tool surface — reach for the right one

Know every tool and *when* it wins (single-repo; cross-repo `group_*` is out of scope for this kit). Don't stop at `query`/`context` — the advanced tools answer in one call what takes many manual hops.

| Tool | Reach for it when |
| --- | --- |
| `query` | Orient — "how does X work?", find the execution flow for a concept (BM25 + vectors). Always first for fuzzy work. |
| `context` | 360° on ONE symbol — callers, callees, categorized refs, the processes it's in. After `query`, or when the symbol is known. |
| `cypher` | Precise structural questions the canned tools don't express — field `ACCESSES`, N-hop `CALLS`, `METHOD_OVERRIDES`, `STEP_IN_PROCESS`. READ schema first. |
| `impact` | BEFORE editing a symbol — upstream blast radius + risk + affected processes. `mode: "pdg"` for statement-level (control+data) precision. |
| `trace` | "How does A reach B?" — shortest call/member path between two symbols in ONE call (replaces 3–8 manual `context` hops). |
| `pdg_query` | "What condition gates this line?" (`mode: "controls"`) / "where does this variable flow?" (`mode: "flows"`). Intra-function; needs PDG. |
| `explain` | Security review — taint source→sink (command/code/sql injection, path-traversal, XSS), intra- AND inter-procedural. Needs PDG. |
| `detect_changes` | BEFORE commit / "what did my edits affect?" — diff → affected symbols/processes/risk. `scope`: unstaged \| staged \| all \| compare. |
| `rename` | Coordinated multi-file symbol rename — `dry_run: true` first. Never find-and-replace identifiers. |
| `api_impact` | BEFORE changing an HTTP route handler (framework router) — consumers, response-shape mismatches, middleware chain, risk. |
| `route_map` | Map routes → consumers + handler + middleware; find orphaned routes. (Custom router → `context` on the dispatcher instead.) |
| `shape_check` | Detect API response-shape drift — keys a route returns vs keys consumers access (flags MISMATCH). |
| `tool_map` | Map MCP/RPC tool definitions → handler files + descriptions (tool-API work, impact of a tool-contract change). |
| `check` | Structural integrity — detect circular File `IMPORTS` cycles (health / CI gate). |
| `list_repos` | Only when multiple repos are indexed — discover/disambiguate before passing `repo:` to other tools. |

Cheap resource reads (prefer before heavy tools): `READ bearing://repo/__GITNEXUS_REPO__/{context|schema|clusters|processes|process/<name>}`.

<!-- feature: gitnexus -->
## MCP defaults (generous — local LLM)

Run hook copy-paste calls verbatim; expand freely when needed:

| Tool | Default | Notes |
| --- | --- | --- |
| `context` | `include_content: false` | Need body → Read offset/limit |
| `query` | `limit: 5`, `max_symbols: 12` | Phrase `search_query` as a natural-language **concept** ("where tokens are validated"), not a keyword — that feeds the embedding ranker; always pass `task_context` + `goal`. Known symbol name → use `context` instead. |
| `cypher` | READ schema first | Use `$params` for symbol/field names |
| `impact` | `summaryOnly: false`, `limit: 100` | Full blast radius before edits; `mode: "pdg"` for statement-level |
| `pdg_query` | `mode: "controls"` / `"flows"` | Statement-level control/data dependence |
| `trace` / `explain` | source → sink | Path between symbols; taint analysis |
| `rename` | `dry_run: true` first | Coordinated multi-file symbol rename |
| `detect_changes` | `scope: unstaged` | Pre-commit → `staged`; PR → `compare` |

<!-- feature: gitnexus -->
## Session (autonomous Shell)

New chat: run session health ritual if injected — `npm run bearing:agent-status`, one-sentence confirm to user.

`npm run bearing:agent-brief` or READ `bearing://repo/__GITNEXUS_REPO__/context`. Stale or missing embeddings → **`npm run bearing:agent-refresh` first** (`required_permissions: ["all"]`). Hooks **block** Grep/Read/MCP/shell until refresh succeeds; classical tools only if refresh **fails** (say why). Never ask user to analyze.

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
- Print them anytime: `npm run bearing:northstars`. Format + maintenance routine: the **`bearing-northstars`** skill.

## Durable memory (survives compaction + sessions)

Maintain your **Claude Code project memory** — `~/.claude/projects/<this-project>/memory/MEMORY.md` (Claude Code's native memory; **all agents share this one file** — Claude refers to its own, other agents mirror it). Record task, key decisions, findings, open items, important `file:line`. Update it at milestones and whenever you conclude something that must outlive the current transcript. Context compaction and new sessions drop the conversation; this file does not. On recovery (post-compaction/resume) READ it first and reconcile it with reality — **nothing important may be lost.**

<!-- feature: taskcore -->
## Task-core (survive compaction without drift)

Long tasks get **compacted** — the transcript is summarized and dropped, and detail drifts. Keep a **task-core**: a dense, **AI-facing** save-state of the CURRENT TASK at **`.bearing/task-cores/<this chat's id>.md`** — the SessionStart brief names the exact path, and it is one file per CHAT so parallel sessions in this repo cannot overwrite each other's save-state. When a PostToolUse nudge says context is filling (~90%), or at a milestone / before a risky pivot, **write or refresh it** — terse, for *you* not humans, no prose tax:

```
GOAL <what "done" is> · CONSTRAINTS <must/never> · DECISIONS <choice→why (settled)>
STATE done<✓+anchor> / now / NEXT<exact> / todo<ordered> · ANCHORS <file:line→what/why>
GOTCHAS <failed approaches, traps, non-obvious> · OPEN-Qs · USER-PREFS(this task)
```

On recovery **READ the task-core FIRST** and reconstruct from it — it's the one thing guaranteed to survive with full detail. It's distinct from `MEMORY.md` (durable, cross-session, human-shared): the task-core is the *hot working-set for THIS task*, overwritten when the task changes. Full routine: the **`bearing-taskcore`** skill.

<!-- feature: gitnexus -->
## Fallback

**Stale index** → run `agent-refresh` first; classical Grep/Read stay denied until it succeeds. **If refresh fails** (or MCP down): classical Grep/Read OK — one-sentence why.

**GitNexus fresh but wrong / suspicious / incomplete?** Don't silently fight the gate — take the escape hatch: `npm run bearing:fallback -- "<why>"`, which opens ~15 min where classical Grep/Read/shell are allowed (auto-resumes; end early with `npm run bearing:fallback:off`). **Make `<why>` specific and actionable** — which GN tool, expected vs actual (e.g. `impact returned 0 callers for OrderService but grep finds 3`) — because it's appended as a **GitNexus failure report** (`npm run bearing:fallback-log`), captured with the graph state, for the GitNexus developers. Re-confirm findings with the graph once GN is reliable; repeated reports pinpoint where GN needs fixing.

Optional: `GITNEXUS_MODE=guide` (nudge-only). Paths: `.bearing/hooks.json`. Playbooks: `bearing-enforcement` skill.

## Claude Code

- Skills live in `.claude/skills/` — load the one that matches the task.
- Hooks in `.claude/settings.json` run on every tool call: they re-anchor you on what matters and can block a wrong call outright.

<!-- feature: gitnexus -->
## Claude Code — GitNexus

- The `gitnexus` MCP server is configured in `.mcp.json` — approve it on first run.
- Hooks enforce the loop: symbol Grep → `gitnexus_context`, large source Read → `gitnexus_query`, edits gated on `gitnexus_impact`, `git commit` gated on `gitnexus_detect_changes`, and stale shell commands blocked until refresh.
- Invoke `/bearing-enforcement` or `/bearing-workspace` on hard tasks.
- Stale index or missing embeddings → run `npm run bearing:agent-refresh` (Bash, pre-approved); never ask the user to analyze.

<!-- feature: gitnexus -->
## npm gates

Run gated scripts from `package.json` when hooks remind you: `bearing.__gate.*` — they document the enforced playbook for this repo.
