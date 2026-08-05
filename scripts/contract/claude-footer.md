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
