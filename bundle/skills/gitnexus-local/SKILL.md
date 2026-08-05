---
name: gitnexus-local
description: >-
  Compressed GitNexus playbook for local/Ollama models in Zed — graph-first with
  minimal context overhead. Use when running qwen/deepseek/llama via Ollama.
disable-model-invocation: false
---

# GitNexus — local model playbook

## Rules (short)

1. **Orient:** `query({ search_query, task_context, goal, repo: "__GITNEXUS_REPO__", limit: 3, max_symbols: 8 })`
2. **Symbol:** `context({ name, repo: "__GITNEXUS_REPO__", include_content: false })`
3. **Before edit:** `impact({ target, direction: "upstream", repo: "__GITNEXUS_REPO__", summaryOnly: true })`
4. **Path:** `trace({from, to})` when both endpoints are known
5. **Control/data:** `pdg_query({mode: "controls"|"flows"})` when relevant
6. **Structural:** READ schema → `cypher` (field ACCESSES, overrides, process steps)
7. **Security:** `explain({target})` for taint findings; absence is not proof of safety
8. **Stale:** `npm run bearing:agent-refresh` — never grep instead of refresh

## Zed profile

Use agent profile **Zed + GitNexus** (grep off, gitnexus MCP on). Do not fall back to project-wide grep when profile disables it — use MCP.

## Anti-patterns

- Full-file reads of large sources — Read offset/limit only for edit lines
- Skipping `impact` on "small" edits
- Symbol rename via search-replace — use `rename` dry_run
