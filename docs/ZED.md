# Zed + local models

Install with:

```bash
npx bearing install /path/to/repo --runtime zed
# or interactive: npx bearing
```

## What you get

| Artifact | Purpose |
| --- | --- |
| `AGENTS.md` (bearing block) | The always-on contract for the modules you installed — north-stars, task-core, review rules |
| `.agents/skills/*` | Symlinks → `.bearing/skills/`; Zed loads them on a trusted worktree |
| `.zed/settings.json` — **GitNexus module only** | `context_servers.gitnexus`, and two Ollama models seeded with `supports_tools` |

Zed has no tool-interception hooks, so nothing fires by itself here: the north-stars are read at session start but not re-anchored mid-session, and the task-core is written when you ask for it. The rules themselves are the same as on Claude Code.

## First session in Zed

1. **Trust the worktree** — project skills in `.agents/skills/` load only on trusted repos.
2. With the GitNexus module there is no profile to pick: Zed's default **Write** profile enables every context server, so the gitnexus tools are already there. (Older versions added a "Zed + GitNexus" profile that turned out to have no file tools — Zed profiles are allowlists. `bearing update` removes it unless you enabled tools in it yourself.)
3. Pick your model — for **Ollama**, use an entry with `"supports_tools": true` in `.zed/settings.json`.
4. Describe the task. When you want the graph, say so ("use gitnexus to find what calls this") — GitNexus is opt-in and used when you ask.
5. Index behind? Run `npm run bearing:agent-refresh` (or `node scripts/bearing-agent.mjs refresh` in a stealth install).

## Ollama models

With the GitNexus module, the installer seeds two Ollama models with `supports_tools: true` — `qwen2.5-coder:14b` and `deepseek-r1:14b`. Uninstall removes only those two; your own models stay. Edit `.zed/settings.json` to add more:

```json
"language_models": {
  "ollama": {
    "available_models": [
      { "name": "qwen2.5-coder:14b", "supports_tools": true }
    ]
  }
}
```

Without tool support the model cannot call the GitNexus MCP server — the profile alone is not enough.

## Zed and Claude Code in the same repo

```bash
npx bearing install /path/to/repo --runtime zed,claude
```

Skills are stored once and symlinked into both `.agents/skills/` and `.claude/skills/`. Claude Code also gets the hooks; Zed gets the same contract through `AGENTS.md`.
