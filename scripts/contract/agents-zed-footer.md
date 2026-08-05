<!-- feature: gitnexus -->
## Zed + local models (Ollama)

- Select the **Zed + GitNexus** agent profile (grep disabled; gitnexus MCP enabled).
- Invoke `/bearing-enforcement` or `/bearing-workspace` when starting a hard task.
- Local models: keep MCP calls small (`query` limit 5, `impact` summaryOnly when exploring).

<!-- feature: gitnexus -->
## npm gates

Run gated scripts from `package.json` when hooks remind you: `bearing.__gate.*` — they document the enforced playbook for this repo.
