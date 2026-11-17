# What bearing costs your context

Measured on fresh installs into an empty repo, bearing 2.0.0, counted the way `npx bearing status`
counts: characters ÷ 4. That is an estimate, not a tokenizer.

**Every session, before you type anything:**

| Install | Contract block (`CLAUDE.md` / `AGENTS.md`) | Skill descriptions | Total | Of a 200k window |
|---|---:|---:|---:|---:|
| Default (7 modules) | ~2,900 | ~1,000 | **~3,900** | 2% |
| Every module (16) | ~5,000 | ~2,400 | **~7,400** | 4% |

A skill's **body** loads only when the skill is used; until then the agent sees its one-line
description. `npx bearing status` prints the contract share for your own install.

**GitNexus, only if you install it.** Its MCP server's 17 tool schemas are ~17,200 tokens
(68,762 characters). They are not bearing's text: they are present whenever that server is
connected, with or without bearing. A client that defers MCP schemas until they are searched for —
Claude Code can — does not pay them up front.

**Whether the graph pays for itself** depends on the repo: at ~650 files grep answered as well
([the benchmark](../eval/codeintel/REPORT.md)). On a much larger repo, measure it on yours with
`npm run bearing:token-benchmark` (GitNexus module).

---

[← back to the README](../README.md)
