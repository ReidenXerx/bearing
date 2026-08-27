---
name: bearing-tsjs
description: "Write and review TypeScript/JavaScript that is not merely type-correct — the traps that compile clean, lint clean, and are still wrong at runtime. Use when writing or editing non-trivial .ts/.tsx/.js/.jsx, when reviewing a TS/JS diff, when data enters the program (fetch, JSON.parse, env, DB row, message), when reaching for `as` or `any` to make an error go away, when adding a member to a union, or when async work is involved. Examples: \"is this `as` safe?\", \"any or unknown here?\", \"why is this undefined at runtime when it type-checks?\", \"review this TypeScript\", \"handle this API response\"."
---

# TypeScript / JavaScript — the traps that compile

The rules live in **`.bearing/lang/typescript.md`**, numbered `TS-1` … `TS-17`. Read it before
non-trivial TS/JS work and cite the number when it decides something. This skill is *when* and
*how* to apply them; the file is *what* they are.

**Every rule in that file passes `tsc --noEmit` and a standard ESLint config.** That is the entry
requirement. If the compiler or the linter already catches it, it is not in the file and it is not
your job to remember it — which is why this is short.

## The habit that subsumes half the list

**Know where the boundary is, and check exactly once, on the way in.**

A program has an inside and an outside. Outside is anything you did not construct in this process:
an HTTP response, `JSON.parse`, `process.env`, a database row, a queue message, a file, a
`postMessage`, a third-party callback. Inside, types are true because the compiler kept them true.
Outside, a type is a hope.

Almost every runtime `undefined` in a typed codebase is the same failure: **the outside was labelled
instead of checked** (`TS-1`), usually with `as`, sometimes with a generic that reads like
validation (`TS-7`).

So:

1. **Is this contract already typed here?** Before declaring anything, look for a generated type
   (OpenAPI, GraphQL, Prisma, a schema's inferred type), then for an existing hand-written one —
   searched by the FIELDS and the endpoint, not by the name you would have given it (`TS-19`).
2. Type the entry point `unknown` (`TS-2`), never `any` — `any` un-types everything downstream of it.
3. Convert it with something that **runs**: a type guard, or a schema parse. One place, at the edge.
4. After that, the value is trusted and the compiler does the rest. Do not re-check it in nine
   functions — that is the sign the boundary was drawn in the wrong place.

If you are reaching for `as` anywhere other than the edge, ask what would happen if the value were
not what you just claimed. If the answer is "an `undefined` three call-frames later, with no clue
where it entered", that is `TS-1` and the assertion is the bug.

## Writing

Before you write, decide the boundary (above). Then, in order of how often it costs something:

- **Adding a variant to a union?** The `never` check (`TS-3`) is what makes the compiler show you
  every place that must now handle it. Without it, nothing fails and every switch silently falls
  through. Add the check when you *create* the union, not when it bites.
- **Writing a default?** `??`, not `||` (`TS-8`) — unless you truly mean "any falsy value". `0`,
  `""` and `false` are the values a caller uses to say something on purpose.
- **Calling something async?** Await it, return it, or handle it with `.catch()` (`TS-12`). And if
  the calls in a loop are independent, they belong in `Promise.all` (`TS-13`).
- **Cleanup that must happen?** `finally` (`TS-14`). Code after an `await` does not run on rejection.
- **Config or a lookup table?** `satisfies` (`TS-4`) keeps the literal types that an annotation
  would widen away.
- **About to declare a type for a response or a row?** Search first (`TS-19`) — and if you cannot
  establish the shape from a schema, a sample or the producer's source, do not invent fields. Keep
  it `unknown`, narrow what you use, and say what you could not establish.
- **About to write a `switch`?** If every branch just *returns a value*, it is a lookup function —
  an object plus a fallback, where the `default` becomes the returned value (`TS-18`). If the
  branches narrow a discriminated union, keep the `switch`: that is the case where it beats a map.

## Reviewing

The compiler already read the diff. Read it for what the compiler *cannot* see — go looking for
these specifically, in this order:

| Look for | Rule | The question that settles it |
|---|---|---|
| `as`, `as unknown as`, non-null `!` | `TS-1` | What runs to make this true? If nothing, it's a hope. |
| `any` — especially a parameter or a return | `TS-2` | What is un-typed *downstream* of this? |
| `switch`/`if` chain over a union | `TS-3` | Add a variant — does anything fail to compile? |
| `arr[i]`, `record[key]` used directly | `TS-5` | Is `noUncheckedIndexedAccess` on? If not, can it be empty? |
| `||` supplying a default | `TS-8` | Is `0`, `""` or `false` a meaningful value for this? |
| A call to an async fn with no `await`/`return` | `TS-12` | Where does the rejection go? |
| `catch (e)` touching `e.message` | `TS-11` | What if a string was thrown? |
| A new `import` used only in a signature | `TS-16` | Should be `import type`. |
| A new `interface` for an API response, DB row or message | `TS-19` | Is it generated somewhere? Did the existing fetcher already type it? |
| A type whose fields nobody could have observed | `TS-19` | What evidence names these fields? If none, it should be `unknown`. |
| A `switch`/`else if` whose branches only return values | `TS-18` | Does any branch narrow a union or do work? If not, it is a table. |
| A table lookup falling back with `\|\|` | `TS-18`, `TS-8` | Can a real entry be `0`, `""` or `false`? |
| `table[key]` where `key` came from outside | `TS-18` | What does `table["constructor"]` return? |

A finding here is worth stating even when the code "works today" — every one of these is a bug that
is already written and simply has not been reached yet.

## Citing

Cite the number when a rule decides a choice:

> Parsing the response instead of asserting it — per `TS-1`, `as User` would put the failure three
> frames from where the bad shape entered.

**Where this repo has north-stars, `NS-#` outranks `TS-#`.** A project invariant is more specific
than a language rule; say which and why rather than averaging them. And where the repo's own lint config disagrees with a `TS-#`, the
config wins — it is enforced, this is advice.

## Anti-patterns

- **Reciting the file.** These are decision rules, not a checklist to paste into a PR description.
  Cite the one that changed the code.
- **Fixing a type error by widening.** `as any`, `as unknown as T`, a non-null `!` — all three make
  the message go away and keep the defect. The error was information.
- **Re-validating inside the boundary.** Defensive checks in every function mean nobody knows where
  the value became trustworthy. Check once, at the edge.
- **Treating a green `tsc` as evidence the code works** (`TS-17`). It is evidence the declarations
  do not contradict each other. Run it.
