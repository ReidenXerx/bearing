---
name: bearing-pr-review
description: "Use when reviewing a pull request, understanding what a PR changes, assessing merge risk, or checking test coverage gaps. Examples: \"Review this PR\", \"What does PR #42 change?\", \"Is this PR safe to merge?\""
---

# PR Review with GitNexus

## The graph can be wrong

It is derived from parsing, not ground truth, and it fails in three different ways:

- **A zero is not absence.** Never conclude "unused", "no callers" or "safe to delete" from an empty result.
- **A low-confidence edge is a lead, not proof.** Check `r.confidence` — `CALLS` and resolved `ACCESSES` come back at 0.85–1.0, while ~92% of `USES` edges sit near 0.5.
- **A count can be a floor.** `impact` returns `epistemic: "lower-bound"` with a `boundaries` note when it knows it is guessing low; it returns `"exact"` when it is not.

When the conclusion matters — deleting, renaming, "nothing reads this", a security claim — confirm with a scoped `Grep` or by reading the file, and **say which check you ran**. A scoped grep for this is explicitly allowed; it is not a gate violation. When the graph and a classical check disagree, the classical check wins on existence, and the disagreement is a defect worth reporting via `bearing:fallback`.


## When to Use

- Reviewing a branch before merge
- Assessing risk of a teammate's changes
- Preparing PR description / test plan from actual blast radius

## Workflow

```
1. `npm run bearing:branch-status -- <base>` to confirm current branch/base and suggested MCP calls
2. gitnexus_detect_changes({ scope: "compare", base_ref: "main", repo: "__GITNEXUS_REPO__", branch: "<current-branch>" })
3. Review summary.risk_level, changed_symbols, affected_processes
4. For HIGH/CRITICAL or unexpected processes → impact on changed entry points with the same `branch`
5. For security/input/file/db/exec changes → `bearing-security-review` (`explain`, `pdg_query`, `trace`)
6. Recommend tests per affected process
```

## Checklist

```
- [ ] `npm run bearing:branch-status -- <base>` confirms branch/base refs
- [ ] detect_changes compare against main (or PR base branch) with `branch` when multi-branch index is available
- [ ] Risk level acceptable for change intent?
- [ ] affected_processes match PR description?
- [ ] Any surprise cross-community flows (changes spanning unrelated clusters)?
- [ ] Entry-point symbols get individual impact upstream
- [ ] HIGH/CRITICAL changes use PDG impact when available
- [ ] API payload changes paired with their client/consumer (shape_check)
- [ ] Config/fixture-only changes → relevant tests green
- [ ] Index was fresh during review (context resource)
```

## Risk interpretation

| detect_changes risk | Action |
| --- | --- |
| LOW | Spot-check affected processes + related tests |
| MEDIUM | Run all affected process test dirs |
| HIGH | Full integration tests; require explicit reviewer sign-off |
| CRITICAL | Treat as architectural change — verify every affected_process |

## What GitNexus adds over git diff

- Maps hunks to **symbols**, not just files
- Traces **execution flows** (processes) impacted
- Surfaces **cross-module** effects grep misses
- Gives **risk level** heuristic for prioritization
- With v1.6.8 layers, can add `trace`, PDG impact, and taint findings for risky changes

## Example

```
detect_changes({scope: "compare", base_ref: "main", branch: "feature/my-branch"})
→ 12 changed symbols, 8 affected processes
→ <entry symbols the diff touches, from the result>
→ Risk: CRITICAL

Follow-up:
→ impact upstream on each changed entry symbol
→ Recommend: tests covering the affected processes
→ Flag: change crosses multiple unrelated clusters — confirm intentional
```

## Related

- Scenario playbooks: `bearing-scenarios/SKILL.md`
- Impact depth: `bearing-impact-analysis/SKILL.md`
