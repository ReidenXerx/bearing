# GitNexus Cursor Guide — for your team

Plain-language guide for anyone using **Cursor Agent** on a repo with GitNexus + this kit installed.

## What you get

GitNexus builds a **knowledge graph** of your codebase (symbols, callers, execution flows, embeddings).

This kit makes Cursor agents **use that graph on every task** — explore, debug, edit, refactor, review — with hooks that **block** grep-first habits when the graph is fresh.

| You get | Why it matters |
|--------|----------------|
| **Strong results on cheaper models** | Hooks + graph enforce a flagship-style loop — biggest **relative** lift on fast/local tiers |
| **Less waste on expensive models** | Same gates — fewer grep retries, enforced `impact`, lower token burn even when the model is already capable |
| Graph in every task loop | Not optional “unfamiliar code” mode — orient, drill, **cypher**, edit, finish through the graph |
| Graph-first reasoning | Fewer missed callers and “grep-only” blind spots |
| Structural precision | Field data flow, N-hop chains, overrides → **`cypher`**, not field grep |
| Semantic search via `query` | Better answers to “how does X work?” |
| Pre-edit impact checks | Agent sees blast radius before changing shared code |
| Autonomous index refresh | Graph stays aligned with your latest commits |
| Enforced workflow | Not optional — hooks block lazy patterns when fresh |

## Model tier — what to expect

The kit helps **every model tier**. Messaging is honest about where the lift is largest:

| Tier | What you get |
|------|----------------|
| **Fast / budget / local** | Graph + hooks carry repo structure — serious work without needing the most expensive model |
| **Flagship / high-end** | Same enforced playbook — less spelunking, fewer missed callers, tokens spent on reasoning not blind reads |

**Practical tips (all tiers):**

- Prefer **Agent** mode with GitNexus MCP enabled — hooks only fire when the graph is fresh.
- If results feel shallow, run `npm run bearing:health` — stale or missing embeddings hurt every model equally.
- Local / zero-API models: rebuild graph context freely; don't skip gates for speed.

You're not paying for model memory of the codebase — you're paying (once) for an index the agent must use. A smarter model still benefits from being **forced** to use it.

## What you will notice in Agent chats

**New chat:** GitNexus runs a health check when the session starts. On your first message you may see a short notice that the kit is active. The agent’s first reply should confirm health in one sentence (graph fresh, enforcement on).

When the graph is **stale** (behind recent commits or missing embeddings), hooks **block** Grep, Read, MCP, and most Shell until the agent runs **`npm run bearing:agent-refresh`**. Classical search is allowed **only if refresh fails** — the agent should say why.

When the graph is **fresh**, the agent may say it was redirected from grep, SemanticSearch, or a full-file read. **That is expected.**

## Quick check after install

```bash
npm run bearing:health
```

Green = graph fresh + embeddings ready + hooks active.

## Good prompts (showcase the graph)

```
How does authentication work in this repo?
```

```
Who reads or writes the sessionToken field?
Trace the 3-hop call chain to validatePayment.
What overrides the base handler method in this codebase?
```

```
What calls UserService.updateProfile? Is it safe to change the signature?
```

```
I'm about to edit the payment webhook handler — what depends on it?
```

```
What did my local changes affect? Am I done?
```

## For team leads / maintainers

| Task | Command |
|------|---------|
| Install kit into a repo | `bearing/bin/install.sh /path/to/repo` |
| Update after kit release | `bearing/bin/update.sh /path/to/repo` |
| Human status | `npm run bearing:health` |
| Re-index (humans / CI) | `npm run bearing:refresh` |
| Agent re-index | `npm run bearing:agent-refresh` (agents run this autonomously) |

After install or update: **restart Cursor** on the project.

## Troubleshooting

| Situation | What to do |
|-----------|------------|
| Agent seems “blocked” on grep | Expected when graph is fresh — agent should use GitNexus MCP tools |
| Graph tools return stale/wrong data | Agent should run `bearing:agent-refresh`; or you run `bearing:refresh` |
| Hooks not firing | Restart Cursor; check Hooks enabled in settings |
| `bearing:health` shows missing embeddings | Run `npm run bearing:agent-refresh` or full `bearing:refresh` |

## Pitch line (for GitNexus + Cursor)

> **GitNexus gives the graph. This kit makes Cursor agents actually use it — on every task, every session, with enforcement.**
