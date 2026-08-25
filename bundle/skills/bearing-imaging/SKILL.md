---
name: bearing-imaging
description: >-
  Graph-first mental models for pipelines, call chains, and cross-module flows.
  Use when explaining architecture, tracing business flows, mapping functional areas, or
  answering "how does X connect to Y?" — never reconstruct structure from grep.
---

# GitNexus Imaging (graph-first thinking)

## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.

Use this when the task needs **structure in your head**, not a single symbol lookup.

**Output contract:** cite a **process** or **cluster** for any cross-module flow. If none is found,
or the result looks wrong, say so, verify classically, and say why in one sentence.

## Thinking modes → tools

| Mental model | Tool | Instead of |
| --- | --- | --- |
| Business flow ("request → handler → storage") | `query` → **processes** | reading five files linearly |
| Call chain ("who calls X?") | `context` (incoming CALLS) | `Grep("X")` |
| Module map ("what lives in area Y?") | `READ clusters` → `cluster/{Area}` | a broad Glob on `src/` |
| Pipeline step trace | `READ process/{name}` | following imports by hand |
| Blast radius | `impact` + `detect_changes` | grepping for callers |
| Field / data flow | `cypher` with `ACCESSES` | grepping the field name |

Every recipe starts by READing `bearing://repo/__GITNEXUS_REPO__/context` for staleness. Stale →
refresh first (`bearing:agent-refresh`); hooks block runtime edits until it is fresh.

---

## Recipe 1 — explain a pipeline / business flow

**Trigger:** "How does X work?", "Explain the <feature> pipeline", "What happens when I run Y?"

```
1. query({ search_query: "<feature or pipeline name>",
           task_context: "<user question verbatim>",
           goal: "find execution flows and entry symbols" })
2. Pick the top 1–3 processes
3. READ bearing://repo/__GITNEXUS_REPO__/process/{name} for each
4. context({name}) on entry + hub symbols — 2–4 symbols, not every leaf
5. Read source ONLY at the lines context/process cited, with offset/limit
```

Answer as: flow name → entry symbol → steps → hub symbols → modules touched. Cite `file:line`.

---

## Recipe 2 — map a functional area

**Trigger:** "What's in area X?", "Map the <area> module"

```
1. READ .../clusters  →  READ .../cluster/{AreaName}
2. query({ search_query: "{AreaName} entry points", goal: "entry symbols" })
3. context on 2–3 entry symbols the cluster lists
```

`cohesion` measured 0.04–0.98 across one repo's clusters — a low-cohesion cluster is a naming
accident, not a module. Read it before you describe the area as one.

---

## Recipe 3 — trace a call chain

**Trigger:** "What calls X?", "Trace from CLI to core"

```
1. context({ name: "X" })
2. Walk incoming CALLS at depth 1 — do not grep
3. Note which processes each caller belongs to
4. READ process/{name} for step order
```

Stop at process / cluster boundaries, not every leaf. `trace` answers A→B in one call instead of
3–8 manual hops, and reports the furthest reachable node when no path exists.

---

## Recipe 4 — trace a data field

**Trigger:** "Who reads/writes `<field>`?", "Where is `<field>` consumed?"

```
1. READ .../schema (if unfamiliar with cypher)
2. cypher — ACCESSES edges with reason read/write on the field name
3. context on writers first, then readers
4. detect_changes if the field changed in WIP
```

`impact` excludes `ACCESSES` by default, so pass
`relationTypes: ["CALLS","IMPORTS","ACCESSES"]` when editing a field or "no callers" means "no
callers that aren't field reads".

---

## Recipe 5 — cross-module spine

**Trigger:** a change spanning several modules (entry → core → storage → client).

Discover the spines from the graph rather than guessing:

```
1. READ .../clusters    → top functional areas
2. READ .../processes   → longest / most-connected flows
3. query({ search_query: "<feature> end to end", goal: "spine processes" })
```

Then run `detect_changes` on the WIP: it surfaces cross-community blast that `impact` on a single
symbol misses. A `processType` of `cross_community` is where contracts break.

---

## Anti-patterns

- Describing a 3+ module flow from memory while the index is fresh.
- Reading whole adapter files before `query`.
- Skipping `process/{name}` when the question was "how does the flow work".
- Trusting `impact` alone on WIP — pair it with `detect_changes` for cross-module edits.

## Related

Master index `bearing-workspace` · checklists `bearing-scenarios` · HTTP routes
`bearing-api-routes`.
