# audit-fixtures

The negative control for `tools/audit-checks.js`. **A detector nobody has watched fire is not known
to work** — and this tool's first version shipped without these, having never been seen to fire.

    AUDIT_DIR=.e2e/tools/audit-fixtures node .e2e/tools/audit-checks.js

- `dirty.js` — one instance of every rule. All five must fire.
- `clean.js` — the correct form of each. Nothing may fire.
- `traps.js` — code that *looks* like each smell and is not: `:has()` is standard CSS,
  `page.check()` is Playwright's, a comment describing a vacuous assertion is not one, a string
  containing `/*` is not a comment, and a `finish()` reached through `?.` still counts.
  **Every line in here was a false positive in a real version of this tool.**
- `suppressed.js` — the ignore comment, which must work on the line and the line above.

`lib/kit.test.mjs` asserts exactly which rule ids fire on which file, so a rule that stops working
fails the build rather than going quiet.
