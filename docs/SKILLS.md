# bearing — agent skills

Each skill is a playbook that loads when its moment comes. The canonical store is installed into target
repos at `.bearing/skills/` and linked into `.claude/skills/` (Claude Code) and `.agents/skills/` (Zed),
depending on the runtime. A skill ships only with the module that owns it.

| Skill | Module | Loads when |
| --- | --- | --- |
| `bearing-northstars` | northstars | reading, citing or maintaining the project's authoritative fixed points (`NS-#`) |
| `bearing-taskcore` | taskcore | edits pile up since the save-state was written, at a milestone, or on recovery after compaction |
| `bearing-microscope` | microscope | a milestone — feature done, pre-ship, a shared-code refactor — or "audit / is this solid?" |
| `bearing-pr` | microscope | opening a pull request or writing its description |
| `bearing-consult` | consult | deciding whether to ask the human or just decide |
| `bearing-minions` | minions | wide mechanical GATHERING — every call site, every file on the old API |
| `bearing-invasive-minions` | minions | applying a DECIDED, mechanical change across many independent sites |
| `bearing-tsjs` | tsjs | writing or reviewing non-trivial TypeScript/JavaScript |
| `bearing-frontend` | frontend | building UI structure, or editing a shared component |
| `bearing-react` | react | react-hook-form and other React traps that compile and are still wrong |
| `bearing-astgrep` | astgrep | a question about code SHAPE, writing an ast-grep rule, or a decided rewrite at many sites |
| `bearing-e2e` | e2e | verifying behaviour in a real browser, or taking a screenshot of a view |
| `bearing-gitnexus` | gitnexus (opt-in) | **only when you ask for it** — "use gitnexus", "use the graph", `/bearing-gitnexus` |

## GitNexus is opt-in, and you invoke it

GitNexus is not installed by default (`--features +gitnexus`, or say yes when the installer asks). When
it is installed, nothing pushes the agent towards it: there are no gates, no nudges, and no always-on
instructions. Mention it in your prompt when you think the graph will help — a cross-module blast
radius, the indirect dependents of a diff, a structural question with no text form — and the
`bearing-gitnexus` skill loads with the scope check, where the graph wins, and where its counts are
only a floor.

Why it works this way: `.bearing/northstars.md` NS-25, NS-28 and NS-29, and the eval in
`eval/teaching/REPORT.md`.
