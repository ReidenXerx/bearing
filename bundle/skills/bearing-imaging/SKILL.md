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


Use this skill when the task needs **structure in your head** — not a single symbol lookup.

**Output contract:** Cite a GitNexus **process** or **cluster** for cross-module flows when the index is fresh. If none found or results look wrong, say so and use classical Read/Grep to verify — tell the user why.

## When to fall back to classical tools

| Situation | Action |
| --- | --- |
| Index stale | Hooks allow Grep/Read/Search; prefer refresh before edits |
| 0 callers on known hub | Retry `context({uid})`, then scoped Grep in the file GN named |
| impact vs detect_changes conflict | Trust detect_changes; verify in source |
| Cannot cite any process after query | Say index may be stale or GN incomplete; verify with Read |

Always tell the user in one sentence when bypassing graph-first imaging.

## When to use (vs other skills)

| Question type | Skill |
| --- | --- |
| "How does feature X flow end-to-end?" | **bearing-imaging** (this) |
| "What calls `<symbol>`?" | `bearing-exploring` / `context` |
| "Safe to change X?" | `bearing-impact-analysis` |
| "Why is this failing?" | `bearing-debugging` |
| Pre-commit / PR checklist | `bearing-scenarios` |

## Thinking modes → tools

| Mental model | Tool | Bad habit |
| --- | --- | --- |
| Business flow ("request → handler → storage") | `query` → **processes** | Read 5 files linearly |
| Call chain ("who calls X?") | `context` (incoming CALLS) | `Grep("X")` |
| Module map ("what lives in area Y?") | `READ clusters` → `cluster/{Area}` | Broad Glob on `src/` |
| Pipeline step trace | `READ process/{name}` | Follow imports manually |
| Blast radius | `impact` + `detect_changes` | Grep callers |
| Field/data flow | `cypher` with `ACCESSES` | Grep field name |

## Mandatory prep

```
READ bearing://repo/__GITNEXUS_REPO__/context   → staleness first
```

If stale → **Cursor agents:** `npm run bearing:agent-refresh` autonomously. **Humans/CI:** `npm run bearing:refresh` (`bearing:full-pdg` for pre-commit precision). Hooks block runtime edits until fresh.

---

## Recipe 1 — Explain a pipeline / business flow

**Trigger:** "How does X work?", "Explain the <feature> pipeline", "What happens when I run Y?"

```
1. READ context (staleness)
2. query({
     search_query: "<feature or pipeline name>",
     task_context: "<user question verbatim>",
     goal: "find execution flows and entry symbols",
     repo: "__GITNEXUS_REPO__"
   })
3. Pick top 1–3 processes from results
4. READ bearing://repo/__GITNEXUS_REPO__/process/{name} for each
5. context({name}) on entry + hub symbols (2–4 symbols max)
6. Read source ONLY at lines cited by context/process — use offset/limit
```

**Deliverable format:**

```markdown
## Flow: {ProcessName}
Entry: `symbol` → … → exit
Steps: (from process trace)
Hub nodes: symbols with most callers
Modules touched: (cluster names from the graph)
```

---

## Recipe 2 — Map a functional area

**Trigger:** "What's in area X?", "Map the <area> module"

```
1. READ bearing://repo/__GITNEXUS_REPO__/clusters
2. READ bearing://repo/__GITNEXUS_REPO__/cluster/{AreaName}
3. query({ search_query: "{AreaName} entry points", task_context: "area map", goal: "entry symbols" })
4. context on 2–3 entry symbols listed in cluster
```

---

## Recipe 3 — Trace a call chain (depth)

**Trigger:** "What calls X?", "Trace from CLI to core"

```
1. context({ name: "X", repo: "__GITNEXUS_REPO__" })
2. Walk incoming CALLS (d=1) — do not grep
3. For each caller, note which processes include it
4. Optional: READ process/{name} to see step order
```

Stop at process / cluster boundaries, not every leaf.

---

## Recipe 4 — Trace a data field

**Trigger:** "Who reads/writes `<field>`?", "Where is `<field>` consumed?"

```
1. READ bearing://repo/__GITNEXUS_REPO__/schema  (if unfamiliar with cypher)
2. cypher — ACCESSES edges with reason read/write on field name
3. context on writers first, then readers
4. detect_changes if field changed in WIP
```

Widen impact with `relationTypes: ["CALLS","IMPORTS","ACCESSES"]` when editing fields.

---

## Recipe 5 — Cross-module spine

**Trigger:** A change spanning several modules (e.g. entry → core → storage → client).

Discover the repo's high-value spines from the graph instead of guessing:

```
1. READ bearing://repo/__GITNEXUS_REPO__/clusters   → top functional areas
2. READ bearing://repo/__GITNEXUS_REPO__/processes  → longest / most-connected flows
3. query({ search_query: "<feature> end to end", task_context: "cross-module change", goal: "spine processes" })
```

After `query`, run `detect_changes` on WIP — it often shows cross-community blast that `impact` on a single symbol misses.

---

## Worked example (generic)

```
1. READ context
2. query({
     search_query: "<top feature> workflow",
     task_context: "explain the <feature> pipeline",
     goal: "processes and hub symbols",
     repo: "__GITNEXUS_REPO__"
   })
   → expect a process with the entry symbol + a few hubs
3. READ process/{top process name}
4. context({ name: "<entry symbol from the process>" })
5. Summarize with process name + hub symbols — then cite file:line for details
```

---

## Anti-patterns

- Describing a 3+ module flow from memory when index is fresh and GN was not tried
- Reading entire adapter files before `query`
- Skipping `process/{name}` when user asked "how does the flow work"
- Trusting `impact` alone on WIP — pair with `detect_changes` for cross-module edits
- Bypassing GN without a stated reason when index is fresh

## Related

- Master index: `bearing-workspace`
- Structured checklists: `bearing-scenarios`
- HTTP routes: `bearing-api-routes` (framework `api_impact` or custom dispatcher)
