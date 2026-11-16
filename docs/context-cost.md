# What bearing costs your context

Measured on fresh installs into an empty repo, bearing 1.3.0, counted the way `npx bearing status`
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

**What used to be here.** The contract was once ~10,300 tokens, most of it graph rules every session
paid for; they moved into the opt-in `bearing-gitnexus` skill when the gates were retired (NS-25).
An earlier version of this page also claimed the graph answers *"what breaks if I change this?"* for
3–13× fewer tokens than grep. A later benchmark — five code-intelligence setups against grep, 107 runs
on a 650-file backend with a hand-checked answer key — found that nothing beat grep at that size, so
that claim is gone ([the report](../eval/codeintel/REPORT.md)). On a much larger repo the graph may
still pay for itself; measure it there with `npm run bearing:token-benchmark` (GitNexus module).

---

[← back to the README](../README.md)
