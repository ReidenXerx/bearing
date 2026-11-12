---
name: bearing-astgrep
description: "Search and rewrite code by its SHAPE with ast-grep instead of a regex — and prove the pattern before trusting its answer. Use when the question is structural (every call to X without Y, every catch that swallows, every handler not wrapped in Z, every function with N arguments), when a regex would have to span lines or skip comments and strings, before writing an ast-grep rule with not/has/inside, and before applying a decided rewrite at many sites. Examples: \"find every fetch without a timeout\", \"which handlers don't call withAudit\", \"rename this call shape everywhere\", \"is this ast-grep pattern right?\", \"why did ast-grep find nothing?\"."
---

# ast-grep — search and rewrite by code shape

ast-grep matches the **syntax tree**. A pattern is a piece of code with holes in it, so
`fetch($$$ARGS)` finds every call to `fetch` — including one split over three lines — and never
the word `fetch` in a comment or a string. That is the whole reason to use it, and also the whole
risk: when a pattern is wrong, it does not error. It finds less, and says so with the same calm
`[]` it uses for "there are none".

So this skill is two things: **when** the tree is the right question, and **how to prove** a
pattern before you trust its count.

## 1. When — shape, not text

| The question | Tool |
| --- | --- |
| Every call to `x` that does not pass `y` | ast-grep (a rule with `not: has:`) |
| Every `catch` with an empty body; every `await` inside a loop | ast-grep |
| Every route handler not wrapped in `withAudit(…)` | ast-grep (`not: inside:`) |
| A decided rewrite of one call shape at many sites | ast-grep `-r`, previewed, then `-U` |
| Does this call mention **the caught variable**; is this **the same symbol**; is this value **of type T** | the language's compiler API — **not ast-grep** (§1a) |
| A name in comments, docs, config, logs, SQL strings | grep |
| "Where is this error message produced?" | grep |
| One known file, one obvious edit | just edit it |

If you would need a regex that spans lines, or a regex plus "but not in comments", the question is
structural.

### 1a. Shape is not bindings — where ast-grep is the wrong tool

ast-grep sees syntax. It does not know which declaration a name refers to, and **a rule cannot carry
a name from one part of itself to another**: a `$E` captured in `inside:` is a fresh wildcard again
inside `not: has:`, so `not: { has: { pattern: $E } }` excludes *everything* — each half of such a
rule matches on its own, and together they return `[]`. The fallback agents reach for, a `regex:` on
the node's text, is worse: it counts `errorMemory` as a mention of `error`, and the word inside
`'Unknown error'` too.

This was measured, not guessed. On a real 650-file backend, agents using ast-grep for "error logs in a
`catch` that never mention the caught variable" missed 2–3 of 28 sites in every trial. Agents that
parsed the code with the TypeScript compiler and compared identifiers got all 28, every time.

So when the question turns on **which variable, which symbol, or which type** — "does it reference
the parameter", "is this the same `logger`", "every call whose argument is a `Date`" — write a short
script against the language's own parser instead. For TypeScript/JavaScript: `ts.createSourceFile`
and a walk, comparing `Identifier.text` within the right scope; for types, `ts.createProgram` and its
type checker. ast-grep can still FIND the candidates; the binding check is the compiler's job.

## 2. Running it

```bash
ast-grep run -p 'fetch($$$ARGS)' src            # installed
npx -y -p @ast-grep/cli ast-grep run -p 'fetch($$$ARGS)' src   # not installed — downloads once
```

- Plain `npx @ast-grep/cli …` **fails** ("could not determine executable to run"): the package
  ships two binaries and neither has its name. Use `-p @ast-grep/cli ast-grep`.
- Avoid the `sg` alias: on Linux `sg` is `setgroups`, and ast-grep itself now marks it deprecated.
- **Leave `-l` out on a mixed tree.** Each file is parsed by its own extension, so one run covers
  `.ts`, `.tsx`, `.js` and `.jsx`. **`-l ts` skips every `.tsx` file**, even one you name
  explicitly, and says nothing. Use `-l` only with `--stdin` or `--inline-rules`, which need it.
- `--json=compact` gives one array of matches (`file`, `range.start.line` 0-based, `text`,
  `metaVariables`). The `=` is required.

**Pattern syntax.** `$A` is exactly one node; `$$$ARGS` is zero or more (in argument lists the
captured list includes the commas). `$_` matches without capturing. A pattern must be valid code
on its own: `fetch(` is not, and neither is a bare object key.

## 3. Prove the pattern — before you trust any count

**Exit codes do not tell you the pattern was right:**

| What happened | `run` exit | stdout | stderr |
| --- | --- | --- | --- |
| Matches | 0 | the matches | — |
| Valid pattern, no matches | **1** | `[]` | — |
| Pattern that does not parse (`fetch(`), **no `-l`** | **1** | `[]` | **nothing** |
| Pattern that does not parse, with `-l ts` | **0** | `[]` | a warning |
| Several statements in one pattern | 8 | — | an error |

`scan` exits 0 on no matches. Read the third row twice: run the way section 2 recommends — no
`-l` — a broken pattern is **byte-for-byte identical** to a clean codebase. No exit code, no
warning. The positive control below is not extra care; it is the only signal there is.

**The ritual:**

1. **Positive control.** Run the pattern on one snippet you KNOW should match, via `--stdin`:
   ```bash
   echo 'fetch("/a", { signal: s })' | ast-grep run -p 'fetch($$$A)' -l ts --stdin
   ```
   No match there means the pattern is wrong, not the codebase clean.
2. **Every sub-rule on its own.** A `not:` whose inner rule never matches excludes **nothing** —
   silently. This happened while writing this skill: `has: { pattern: signal }` never matches
   `{ signal: … }`, because a bare `signal` parses as an identifier and an object key is a
   `property_identifier`. The rule returned every `fetch`, including the ones it was meant to
   exclude. Test the inner rule alone on a snippet, exactly as in step 1.
3. **Find the node kind instead of guessing it:**
   ```bash
   ast-grep run -p '({ signal: $S })' -l ts --debug-query=ast
   ```
   prints the tree — here `pair` → `key: property_identifier`.
4. **Reconcile with grep.** `rg -c 'fetch\('` counts the text. ast-grep's number should be lower
   by exactly the hits in comments, strings and multi-line calls. A difference you cannot explain
   is a finding, not noise.

## 4. Rules — when one pattern is not enough

```bash
ast-grep scan --inline-rules '
id: fetch-no-signal
language: TypeScript
rule:
  pattern: fetch($$$ARGS)
  not:
    has:
      kind: property_identifier
      regex: ^signal$
      stopBy: end' src --json=compact
```

- **`stopBy: end`** — `has` and `inside` look ONE level away by default (`stopBy: neighbor`). The
  `signal` key sits inside an object inside the argument list, so without `stopBy: end` the rule
  above silently excludes nothing. Most `has`/`inside` rules want `stopBy: end`.
- `kind` + `regex` matches a node that cannot stand alone as a pattern (a key, a parameter name).
- `inside:` asks "within what" — `not: { inside: { pattern: withAudit($$$), stopBy: end } }` for
  "not already wrapped".
- `language:` in a rule is one language: `TypeScript` does not cover `.tsx`. Run the rule again
  with `language: Tsx` when the tree has both.

## 5. Rewrite — decided changes only

A rewrite is a decided change applied mechanically. If the right edit differs per site, this is
not the tool — and not the moment.

1. **Preview:** `ast-grep run -p 'console.error($E)' -r 'logger.error($E)' src` — `-r` without
   `-U` changes nothing and prints the diff. Read it: is every hunk a site you meant?
2. **Apply:** the same command with `-U`. It prints `Applied N changes`.
3. **Prove it:** run the search pattern again — it must return zero (exit 1, `[]`) — then run
   the project's tests. N from step 2 should equal the count from your search.

`-i` is interactive and will hang an agent; do not use it.

## 6. What to report

The pattern or rule you ran, verbatim; the count; the positive control that matched; and, for a
rewrite, the before count, `Applied N`, and the after count of zero. A number with no pattern
beside it cannot be checked by anyone, including you after a compaction.
