# Zed + Ollama setup

Install with:

```bash
./bin/install.sh /path/to/repo --runtime zed
# or interactive: ./bin/install.sh
```

## What you get

| Artifact | Purpose |
| --- | --- |
| `.agents/skills/*` | Symlinks → `.bearing/skills/` (20 playbooks incl. `gitnexus-local`) |
| `.zed/settings.json` | `context_servers.gitnexus` + **Zed + GitNexus** agent profile (grep off) |
| `AGENTS.md` | Always-on graph-first instructions |
| npm `gitnexus:*` gates | Same playbook as Cursor installs |

## First session in Zed

1. **Trust the worktree** — project skills in `.agents/skills/` load only on trusted repos.
2. Agent panel → **profile: Zed + GitNexus** (your Zed/Ollama model + gitnexus MCP; grep disabled).
3. Pick your model — for **Ollama**, use a entry with `"supports_tools": true` in `.zed/settings.json` (qwen2.5-coder pre-seeded).
4. Start chat → invoke `/gitnexus-enforcement` or `/gitnexus-local` on hard tasks.
5. Stale graph → `npm run gitnexus:agent-refresh` in terminal (agent should run this autonomously per `AGENTS.md`).

## Ollama models

The installer seeds example Ollama models with `supports_tools: true`. Edit `.zed/settings.json`:

```json
"language_models": {
  "ollama": {
    "available_models": [
      { "name": "qwen2.5-coder:14b", "supports_tools": true }
    ]
  }
}
```

Without tool support, the agent cannot call GitNexus MCP — the profile alone is not enough.

## Cursor + Zed same repo

```bash
./bin/install.sh /path/to/repo --runtime both
```

Skills are stored once; symlinks go to both `.cursor/skills/` and `.agents/skills/`. Cursor keeps hook hard enforcement; Zed uses the agent profile.
