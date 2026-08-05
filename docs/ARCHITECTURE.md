# Architecture — why agents ignore GitNexus (and how this kit fixes it)

GitNexus builds the knowledge graph. **gitnexus-agent-kit** is the agent layer for **Cursor, Zed, and Ollama**: hooks (Cursor), agent profiles (Zed), shared symlinked skills, MCP wiring, and install UX so the graph participates in **every task** — not only when code feels unfamiliar.

Production-hardened across real repositories. Proposed upstream integration: `gitnexus init --cursor-kit`.

---

## Model tiers — who gains what

**Core product thesis:** better agent job results by **offloading repo reasoning to the graph** and **forcing a proven tool loop** via hooks — for **every model tier**, with the **largest relative lift on low-cost and local models**.

Expensive models still grep-first, skip `impact`, and burn tokens on full-file reads. They *can* recover with more retries — budget models usually can't. **The kit fixes the workflow for both:**

```mermaid
flowchart LR
  subgraph alone["Any model, no kit"]
    P[Prompt] --> G[Grep / read / guess]
    G --> A[Act — hit or miss]
  end

  subgraph kit["Any model + gitnexus-agent-kit"]
    P2[Prompt] --> H[Hooks enforce gate loop]
    H --> GN["query → context → cypher"]
    GN --> I[impact / detect_changes]
    I --> A2[Act on graph-backed facts]
  end
```

| Who | Primary gain |
|-----|----------------|
| **Budget / fast / local** | Viable for serious repo work — graph holds structure the model lacks |
| **Flagship / expensive** | Same enforced loop — **fewer tokens**, fewer sloppy edits, model effort goes to reasoning not spelunking |

| Capability models often “simulate” | What the kit provides instead |
|-------------------------------------|-------------------------------|
| Remembering callers across the repo | `context` + `impact` on the graph |
| Fuzzy “where is X implemented?” | `query` (BM25 + embeddings) |
| Field / N-hop structural questions | `cypher` (ACCESSES, CALLS, overrides) |
| Safe refactors | `rename` dry_run + pre-edit `impact` |
| Knowing when to stop exploring | Fixed gates; hooks block tool spam |

**Positioning for GitNexus authors / buyers:** not “replace your flagship model” — **(a)** downgrade tier without losing repo quality, **(b)** keep flagship and waste less, **(c)** local/zero-API paths with the same gates. Index + embeddings amortize across all tiers.

The enforcement rule explicitly supports **local LLM / zero API cost** paths: rebuild graph context freely; do not skip gates for speed.

---

## 0. Optional sidecar vs graph in every task

**Problem:** Without enforcement, GitNexus is a tool agents *may* use. They grep familiar files, patch from memory, and skip `impact` on “small” edits — the graph sits idle unless the prompt screams “explore this codebase.”

**Our fix:** A fixed **reasoning loop** on every session and every task type — session brief → orient (`query`) → drill (`context`) → structural precision (`cypher` when needed) → pre-edit (`impact`) → pre-done (`detect_changes`). Hooks block classical shortcuts when fresh so the graph participates in bugfixes, refactors, and reviews — not just architecture tours.

```mermaid
flowchart TB
  subgraph sidecar["Typical GitNexus adoption"]
    T1["Any task — fix, edit, review, explore"]
    T1 --> C1["grep / Read / SemanticSearch"]
    C1 --> A1[Act on text matches]
    T1 -.->|only when lost| GN1["GitNexus (optional)"]
  end

  subgraph every["gitnexus-agent-kit — every task"]
    T2["Any task — fix, edit, review, explore"]
    T2 --> B2[session brief + health]
    B2 --> G2{Graph fresh?}
    G2 -->|yes| Loop["query → context → cypher → impact → detect_changes"]
    Loop --> A2[Act with graph-backed reasoning]
    G2 -->|stale| R2[agent-refresh → Loop]
  end
```

## 1. Grep-first blind spots (on familiar code too)

**Problem:** Agents reach for `Grep` / `Glob` / `SemanticSearch` on **every** task — even code they “already know” from context window. Text search misses indirect callers, execution flows, and cross-repo links.

**Our fix:** When the index is **fresh**, `preToolUse` hooks **deny** lazy search tools and inject copy-paste MCP calls (`context`, `query`).

```mermaid
flowchart LR
  subgraph without["Without kit"]
    U1["Fix bug / rename / review PR"] --> G1[Grep / SemanticSearch]
    G1 --> M1[Text matches only]
    M1 --> X1[Missed callers & flows]
  end

  subgraph with["With kit — graph fresh"]
    U2["Fix bug / rename / review PR"] --> H2{grep-guard hook}
    H2 -->|deny| Q2["query (BM25 + embeddings)"]
    Q2 --> C2[context on symbols]
    C2 --> A2[Graph-grounded action]
  end
```

## 2. Wrong tool — graph skipped even when agents “try GitNexus”

**Problem:** Agents reserve GitNexus for big exploratory prompts. On everyday work they jump to `context` / `impact` / grep without `query`.

**Our fix:** Enforcement rule + prompt router apply the same orient → drill → act loop to **all** reasoning.

```mermaid
flowchart TD
  T["Any task"] --> Fresh{Index fresh?}
  Fresh -->|yes| Block[Deny Grep / SemanticSearch / full Read]
  Block --> Query["query — hybrid graph + vectors"]
  Query --> Drill[context on hit symbols]
  Drill --> Cy{Structural precision?}
  Cy -->|field / N-hop / overrides| Cypher["cypher — READ schema first"]
  Cy -->|standard| Impact[impact before edits]
  Cypher --> Impact
  Impact --> Slice[Read offset/limit if needed]
  Slice --> DC[detect_changes before done]
  Fresh -->|stale| Refresh[agent-refresh mandatory]
  Refresh --> Retry[retry graph tools]
  Retry -->|failed| Classic[classical fallback OK]
  Refresh --> Query
```

## 3. Stale graph — wrong answers or abandoned MCP

**Problem:** Index behind recent commits or missing embeddings → graph tools lie or fail.

**Our fix:** Embeddings required for “fresh”. Session primer auto-refreshes on new chat; shell/edit guards block work while stale.

```mermaid
flowchart TB
  subgraph session["Every new chat"]
    SS[sessionStart] --> P[session-primer]
    P --> S{Stale? commits or embeddings}
    S -->|yes| AR["agent-refresh (autonomous)"]
    S -->|no| OK[Graph ready]
    AR --> OK
  end

  subgraph live["During the session"]
    SH[Shell] --> SG[shell-staleness-guard]
    SG -->|stale + enforce| D[Deny until refresh]
    ED[Write / StrReplace] --> EG[edit-guard → run impact]
    GC["git commit"] --> AC[afterShell → re-index hint]
  end
```

## 4. Nobody knows if the kit is actually working

**Problem:** Hooks and MCP are invisible. Users think the agent is “broken” when grep is blocked.

**Our fix:** Session health hooks on every new chat — audit kit, tell the **agent** to confirm on first reply, show the **user** a one-time status line.

```mermaid
sequenceDiagram
  participant User
  participant Cursor
  participant Primer as session-primer
  participant Health as session-health
  participant Agent

  Cursor->>Primer: sessionStart (new chat)
  Primer->>Primer: clear flags, auto-refresh if stale
  Cursor->>Health: sessionStart
  Health->>Health: audit hooks, MCP, rule, graph, embeddings
  Health->>Agent: additional_context — health ritual required
  User->>Cursor: first message
  Cursor->>User: user_message — kit active + status
  Agent->>Agent: npm run gitnexus:agent-status
  Agent->>User: one line — GitNexus kit ready
```

## 5. Edits without blast-radius checks

**Problem:** Agents patch shared code without asking what depends on it.

**Our fix:** `edit-guard` injects `impact` upstream before writes; `detect_changes` before commit / “am I done?”.

```mermaid
flowchart TD
  Edit[Agent edits runtime source] --> G[edit-guard preToolUse]
  G --> I["impact upstream (MCP)"]
  I --> R{Risk level?}
  R -->|HIGH / CRITICAL| W[Warn user before proceeding]
  R -->|LOW / MEDIUM| Go[Proceed]
  Done[Before commit or done] --> DC[detect_changes]
  DC --> Report[Affected processes & symbols]
```

## 6. Scattered wiring — install once, enforce everywhere

**Problem:** Rules, hooks, MCP, skills, npm scripts, and index build are separate steps — teams skip pieces.

**Our fix:** One installer copies the bundle, **migrates legacy cursor-gitnexus-kit layouts**, materializes a canonical skill store, symlinks into IDE paths, merges gated scripts + MCP (Cursor) or Zed profile, builds the index, runs verification.

```mermaid
flowchart TB
  I["bin/install.sh"] --> M[migrate legacy skills/manifest/zed profile]
  M --> B[Copy bundle]
  B --> SK[".bearing/skills + symlinks"]
  SK --> MC[Merge Cursor hooks + MCP]
  SK --> MZ[Merge Zed profile + AGENTS.md]
  MC --> S[gitnexus-setup.sh]
  MZ --> S
  S --> IDX["Build .gitnexus/ + embeddings"]
  IDX --> V["gitnexus:verify"]
  V --> R[Restart IDE]
  R --> H["gitnexus:health"]
  H --> C[New Agent chat]
```

## 7. High-level tools miss structural graph questions

**Problem:** Agents grep field names or guess at N-hop call chains — those need **raw graph traversals**.

**Our fix:** **`cypher`** is a first-class tier — field grep routed to `ACCESSES`, prompt-router detects structural intents.

```mermaid
flowchart TD
  Q[query — orient with embeddings] --> C[context — drill symbol]
  C --> Need{Precise structure?}
  Need -->|field read/write| F["cypher ACCESSES"]
  Need -->|N-hop callers| H["cypher CALLS path"]
  Need -->|overrides / steps| O["cypher METHOD_OVERRIDES / STEP_IN_PROCESS"]
  Need -->|standard edit| I[impact upstream]
  F --> I
  H --> I
  O --> I
  I --> DC[detect_changes before done]
```

| Structural question | Cypher edge |
|--------------------|-------------|
| Who reads/writes field X? | `ACCESSES` + `reason` |
| Custom call chain depth | `CALLS` variable-length |
| Override / inheritance | `METHOD_OVERRIDES`, `EXTENDS` |
| Process step order | `STEP_IN_PROCESS` + `r.step` |

---

## Component map

| Agent failure mode | Kit component |
|-------------------|---------------|
| Budget model can't "hold the repo in head" | Enforced `query` → `context` → `cypher` loop |
| Graph only for “unfamiliar code” | Session gates + `00-gitnexus-enforcement.mdc` |
| Grep-first habits | `grep-guard`, `read-guard`, `prompt-router` |
| Skips embeddings | Blocks SemanticSearch → `query` |
| Stale / missing vectors | `check-staleness`, session-primer, shell/edit guards |
| “Is it working?” | `session-health`, `gitnexus:health`, `gitnexus:verify` |
| Unsafe edits | `edit-guard`, `impact`, `detect_changes` |
| Field/property grep | `cypher-helpers`, ACCESSES in `grep-guard` |
| Blind symbol renames | `rename` MCP + `edit-guard` |
| Install friction | `install.sh`, gated npm scripts, team guide |

## Cypher — raw graph queries

GitNexus high-level tools (`query`, `context`, `impact`) cover most tasks. **`cypher`** is for **precise structural questions** on the indexed graph.

| Use Cypher when you need | Example edge |
|--------------------------|--------------|
| Who reads/writes a field/property? | `ACCESSES` + `reason: read/write` |
| Custom call-chain depth | `CALLS` variable-length path |
| Method override / inheritance | `METHOD_OVERRIDES`, `EXTENDS` |
| Ordered steps in a process | `STEP_IN_PROCESS` + `r.step` |

Agents still **`query` first** for fuzzy work — Cypher is gate #4, not a grep replacement for symbols (those go to `context`).

## What gets installed

| Component | Purpose |
|-----------|---------|
| `.cursor/rules/00-gitnexus-enforcement.mdc` | North-star agent contract (Cursor always-on rule) |
| `.cursor/hooks.json` + hooks | Block lazy grep/read; staleness gate; session auto-refresh |
| `.zed/settings.json` + **Zed + GitNexus** profile | Zed agent profile — grep disabled, gitnexus MCP |
| `AGENTS.md` (kit block) | Always-on instructions for Zed agents |
| Session health hooks | New chat audit + agent confirms kit on first reply |
| Cypher integration | `cypher-helpers.mjs`; field grep → ACCESSES |
| `.bearing/skills/` + symlinks | Canonical skill store → `.cursor/skills/`, `.agents/skills/` |
| `scripts/gitnexus-*` | Setup, sync, agent CLI, pack, git hooks |
| `.githooks/pre-commit` | Full PDG re-index on commit (`gitnexus:full-pdg`) |
| `.cursor/mcp.json` | Merges `gitnexus` MCP server (Cursor) |
| Gated `package.json` scripts | `gitnexus:health`, `gitnexus:verify`, gate docs |

Per-target repo (built locally): `.gitnexus/` index, `.cursor/skills/generated/` area skills.

## IDE runtimes

| Runtime | Enforcement | Key paths |
|---------|-------------|-----------|
| **cursor** | Hard hooks deny grep/read when fresh | `.cursor/hooks`, `.cursor/skills` → store |
| **zed** | Profile + AGENTS.md (soft vs Cursor hooks) | `.zed/settings.json`, `.agents/skills` → store |
| **both** (default) | Cursor hard + Zed profile | All of the above |

**Update migration:** every `install` / `update` runs `migrateLegacyInstall` — removes old rsync'd skill copies, `.claude/skills/gitnexus*`, legacy `.cursor/gn-kit-manifest.json`, and renames Zed profile `gitnexus` → `zed-gitnexus`.

## Bundle layout

```
bundle/
├── skills/                 # canonical flat skill store (copied to .bearing/skills)
├── .cursor/rules/ hooks.json hooks/
│   └── hooks/lib/          # cypher, rename, verify, graph-smoke, …
├── templates/              # AGENTS.gitnexus.md fragment
├── docs/                   # GITNEXUS-CURSOR-GUIDE, TEAM-BUNDLE
├── scripts/
├── .githooks/
└── .gitnexusignore
```

Templates use `__GITNEXUS_REPO__` — substituted with the target repo name at install time.
