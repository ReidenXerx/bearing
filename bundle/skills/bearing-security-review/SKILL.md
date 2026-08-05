---
name: bearing-security-review
description: >-
  Use for security-sensitive changes, taint/source-to-sink questions, injection risk,
  path traversal, XSS, command/code/sql injection, auth/input/file/db/exec reviews.
---

# GitNexus Security Review

Use this when a task touches untrusted input, auth/session data, file paths, shell/process execution, dynamic code, HTML rendering, database queries, or external webhooks.

## Workflow

```
1. query({ search_query: "<feature/security surface>", task_context, goal: "sources sinks validators" })
2. context({ name: "<entry or sink symbol>", repo: "__GITNEXUS_REPO__" })
3. gitnexus_explain({ target: "<file-or-symbol>", repo: "__GITNEXUS_REPO__" })
4. gitnexus_pdg_query({ mode: "flows", target: "<function-or-file>", variable: "<inputVar>", repo: "__GITNEXUS_REPO__" })
5. gitnexus_pdg_query({ mode: "controls", target: "<function-or-file>", repo: "__GITNEXUS_REPO__" })
6. impact({ target: "<changed symbol>", direction: "upstream", mode: "pdg", repo: "__GITNEXUS_REPO__" }) when PDG layer exists
7. detect_changes({ scope: "unstaged", repo: "__GITNEXUS_REPO__" }) before done
```

If PDG/taint returns “no layer”, do **not** call the code safe. Say the repo needs `npm run bearing:pdg` / pre-commit PDG refresh, then fall back to graph + targeted reads.

## Checklist

- [ ] Identify untrusted sources: request params/body/headers, env, files, queue/webhook payloads.
- [ ] Identify sinks: SQL, shell/process, file path, dynamic eval/codegen, HTML/DOM/template output.
- [ ] Run `gitnexus_explain` for persisted taint findings on touched file/symbol.
- [ ] Run `pdg_query flows` for suspicious input variables.
- [ ] Run `pdg_query controls` to verify guards/validators dominate the sink path.
- [ ] Confirm sanitizer is real transformation/validation, not just a comment or type.
- [ ] Use `trace` when you know source and sink symbols and need the shortest call path.
- [ ] Report false-positive caveats: taint is over-approximated; absent findings are not proof of safety.

## Tool routing

| Question | Tool |
| --- | --- |
| “Any taint findings here?” | `gitnexus_explain({ target })` |
| “Where does variable X flow?” | `gitnexus_pdg_query({ mode: "flows", target, variable })` |
| “What guard controls this sink?” | `gitnexus_pdg_query({ mode: "controls", target })` |
| “How can source A reach sink B?” | `gitnexus_trace({ from, to })` |
| “What is affected by changing this validator/sink?” | `impact({ mode: "pdg", direction: "upstream" })` |

## Reporting

Summarize:

1. Source(s) and sink(s) reviewed.
2. Taint findings found or “no taint layer / no persisted findings” with caveat.
3. Guards/sanitizers verified by PDG/control flow or source read.
4. Residual risk and tests to run.
