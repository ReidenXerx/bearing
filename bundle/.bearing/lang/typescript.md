# TypeScript / JavaScript — the traps that compile

**Ships with bearing. Applies to every TS/JS project.** Numbered `TS-#` — cite the number when a
rule decides a choice.

**If this repo has `.bearing/northstars.md`, those `NS-#` outrank this file** — a project's own
invariant is more specific than a language rule, so on conflict the `NS-#` wins and you say which
one and why. Where this file and a repo's lint
config disagree, the repo's config wins — it is enforced, this is advice.

**This file is bearing's, not yours.** `bearing update` overwrites it — project rules belong in
`.bearing/northstars.md`, which bearing never touches.

---

**Every rule here is a property of the *language*, not a lesson from one codebase** — each is a
construct that **type-checks, lints clean, and is still wrong at runtime**. There is
deliberately nothing here about formatting, naming, or `const` over `let` — your linter already has
those, and a rule your tooling enforces costs context and changes nothing.

The test each rule had to pass: **would `tsc --noEmit` and a standard ESLint config both stay
silent?** If the compiler catches it, it is not in here.

---

## The type system tells you what you asserted, not what is true

- **TS-1** — **`as` verifies nothing.** A type assertion silences the compiler; it does not test the
  value. `const user = (await res.json()) as User` compiles, and `user.email` is `undefined` at
  runtime — with no error at the point the wrong shape entered, which is the only place the bug is
  cheap to find. At any boundary — network, `JSON.parse`, `process.env`, a DB row, a message queue,
  a file — the value is `unknown` until something checks it **at runtime**: a type guard, or a
  schema parse. Reserve `as` for what you genuinely know and the compiler cannot: a `const` object's
  literal type, a DOM node's concrete class.

- **TS-2** — **`unknown` at the boundary, never `any`.** `any` disables checking *outward*: every
  value derived from it is also unchecked, so one `any` where data enters silently un-types the call
  chain downstream of it. `unknown` is the same "I don't know yet" with the opposite propagation —
  it forces a narrow at the point where you actually do know. Same for `catch`: see TS-11.

- **TS-3** — **A union without an exhaustiveness check is a silent fallthrough waiting for the next
  variant.** Add a `never` assignment on the default branch:

  ```ts
  default: {
    const _exhaustive: never = kind;   // adding a variant becomes a COMPILE error here
    throw new Error(`unhandled: ${String(kind)}`);
  }
  ```

  Without it, a new member of the union compiles everywhere and does nothing at every site that
  should have handled it. This is the single highest-value TS pattern that is easy to omit.

- **TS-4** — **`satisfies` when you want the check without losing what you wrote.** `const cfg:
  Config = {...}` widens the value to `Config`, so `cfg.mode` is `string` and the literal is gone.
  `const cfg = {...} satisfies Config` checks the same constraint and **keeps** the literal types.
  Annotate to constrain a value you will reassign; `satisfies` to constrain one you will read.

- **TS-5** — **Index access lies by default.** `arr[i]` is typed `T`, but is `undefined` when `i` is
  out of range, and `record[key]` is typed `V` for keys that were never set. `tsc` reports neither
  unless `noUncheckedIndexedAccess` is on, and it is off in the default config and in most repos.
  Check the result before using it — or turn the flag on and let the compiler find every site.

- **TS-6** — **Excess-property checking only fires on a fresh object literal.** `fn({ a: 1, typo: 2
  })` is an error; assigning that same object through a variable first is not. So the check that
  caught your typo disappears the moment the literal is extracted into a `const` — the refactor that
  looks like it changed nothing.

- **TS-7** — **A type is not a validator, and neither is a generic.** `getJson<User>(url)` reads as
  though it checked something. It cannot: the type argument is erased before the code runs. If a
  function's return type is chosen by its caller, the caller is asserting, not verifying (TS-1).

## Values that are not what they look like

- **TS-8** — **`??` for defaults, not `||`.** `||` also replaces `0`, `""`, `false` and `NaN` — the
  values a caller uses to say something *deliberate*. `const retries = opts.retries || 3` turns an
  explicit `0` into `3`, defeating the exact intent it was written to express. Use `||` only when
  you mean "any falsy value", and say so.

- **TS-9** — **`?.` guards the link it is attached to, and nothing after it.** In `a.b?.c.d`, a null
  `a.b` short-circuits the whole chain, but a null `a` throws before the `?.` is ever reached, and a
  null `c` throws after it. Put the `?.` on the link that is actually optional. `a?.()` is the same
  rule for calls: it tests `a`, not the result.

- **TS-10** — **Object key iteration loses the key union.** `Object.keys(o)` is `string[]` and
  `Object.entries(o)` is `[string, V][]` — deliberately, because a value may hold more keys than its
  type declares (structural typing). Casting the result back to `(keyof T)[]` re-asserts something
  that may be false at runtime (TS-1). If you need the declared keys, iterate a `const` array of
  them, which also gives you a compile error when the type gains a member.

- **TS-11** — **`catch (e)` binds `unknown`, because anything can be thrown.** `throw "nope"` and
  `throw { code: 500 }` are legal JS, so `e.message` is both a type error and a real
  `undefined`. Narrow with `instanceof Error` and keep a fallback for the rest — and when you
  rethrow, pass `{ cause: e }` rather than discarding the original stack.

## Async

- **TS-12** — **A promise you neither await nor return is a bug you will not see.** The rejection
  never reaches the caller's `try/catch` — it surfaces as an `unhandledRejection` at top level,
  detached from the code that caused it, often after the request that owned it has finished. Every
  call to an async function must be awaited, returned, or explicitly discarded with a `.catch()`
  that handles it. `void p` documents intent but handles nothing.

- **TS-13** — **`await` in a loop serialises work that had no reason to be sequential.** Ten
  independent 200 ms calls take 2 s in a `for` loop and 200 ms under `Promise.all`. Keep the loop
  only when each iteration genuinely depends on the previous one, or when you are deliberately rate
  limiting — and when you are, say which. Note `Promise.all` rejects on the first failure;
  `allSettled` when you need every result.

- **TS-14** — **An `async` function's `try/finally` is the only cleanup that runs.** A `finally` is
  reached on rejection; code placed after an `await` is not. Anything that must be released — a
  lock, a handle, a transaction — belongs in `finally`, not on the happy path.

## Modules and runtime

- **TS-15** — **In ESM the import specifier is a runtime path, not a module name.** From a `.ts`
  file compiled to ESM you import `./util.js` — the path the *output* will resolve — even though the
  file on disk is `util.ts`. Omitting the extension type-checks and fails at run time with
  `ERR_MODULE_NOT_FOUND`, which is why it survives every pre-commit check that does not execute.

- **TS-16** — **`import type` for anything used only as a type.** It is erased, so it cannot create
  an import cycle, cannot pull a module in for its side effects, and cannot keep a dev-only package
  in the runtime graph. A plain `import` of something you only reference in a signature does all
  three.

- **TS-17** — **`tsc --noEmit` passing is a claim about types, not about behaviour.** It proves no
  contradiction in what you *declared*. Every rule above is a way for a program to be
  fully type-correct and wrong, so "it compiles" is never the evidence that it works — running it
  is.

## Shapes that make the compiler do the work

**These are not traps — the alternative compiles and runs.** Each rule here earns its place by
making the **compiler** catch something it otherwise would not, so each ends in a `Cashes out as:`
line naming what changes at compile time or run time. A rule that cannot say that is a style
preference, and a style preference in this file is how a rulebook stops being read.

- **TS-18** — **A `switch` that only picks a value is a lookup function written longhand.** Replace
  it with a function that holds an object and returns from it; the `default` branch becomes the
  value returned when the key is not found.

  **When:** every branch of a `switch` or `else if` chain returns a value of the same type, and the
  branches differ only in *what value*, not in *what they do*.

  ```ts
  // Key is a closed union → the table IS the exhaustiveness check, and no default is reachable.
  const RATE = { standard: 1, express: 1.8 } as const satisfies Record<Tier, number>;
  export const rateFor = (tier: Tier) => RATE[tier];

  // Key arrives from outside → guard the lookup, then fall back. This is the `default` branch.
  const RATE: Record<string, number> = { standard: 1, express: 1.8 };
  export function rateFor(tier: string): number {
    return Object.hasOwn(RATE, tier) ? RATE[tier] : 1;
  }
  ```

  Three things bite in exactly this pattern, and all three compile:

  - **Fall back with `??`, never `||`** (`TS-8`). A table holding `0`, `""` or `false` is a table
    whose real entries the `||` replaces with the default — the one case the caller meant.
  - **Guard the lookup when the key comes from outside.** `RATE["constructor"]` returns a function
    rather than `undefined`, so `?? fallback` never fires and the function returns something absurd
    instead of the default. `Object.hasOwn`, a `Map`, or `Object.create(null)` as the table.
  - **The compiler will not remind you the fallback is needed**: `RATE[key]` is typed as the value
    type even for a key that was never set, unless `noUncheckedIndexedAccess` is on (`TS-5`).

  **Not when:** the branches **narrow a discriminated union**. `switch (e.kind)` gives each branch
  the payload type for that variant; a lookup keyed on `e.kind` hands every handler the whole union,
  and the naive fix is `HANDLERS[e.kind](e as ClickEvent)` — which is `TS-1`, and worse than the
  `switch` it replaced. Keep the `switch` there, or write the handler map as a mapped type over the
  union. Likewise when branches do different *work* (early return, throw, differing arity), or when
  the test is not equality — a table keys on a value, a chain tests a predicate.

  **Cashes out as:** with a closed-union key, adding a variant becomes **one compile error at the
  table** instead of a silent fallthrough at every site that should have handled it — the guarantee
  `TS-3` buys with a `never` branch, without needing the branch. And the `default` stops being
  control flow and becomes a value, which can be read, tested and overridden.

- **TS-19** — **A second hand-written type for one contract is a second source of truth, and only
  one of them will be updated.**

  **When:** you are about to declare an `interface` or `type` for data that crosses a boundary — an
  API response, a DB row, a queue message, a config file — or for anything another module in this
  repo already produces.

  **Look in this order, and stop at the first hit:**

  1. **A generated or schema-derived type** — an OpenAPI or GraphQL output, a Prisma model, the
     type inferred from a validation schema. Hand-writing a copy of something that *regenerates* is
     worse than ordinary duplication: the generator cannot update your copy, so it is stale from the
     producer's first change and nothing anywhere reports it.
  2. **An existing hand-written type, searched by SHAPE rather than by name.** You look for
     `UserResponse`; the repo calls it `ApiUser`. Search for two or three distinctive field names
     together, for the endpoint path, and for the function that already fetches this data — whoever
     wrote that almost certainly typed the result.
  3. **Only then write one.**

  **Write it only from evidence.** If you have the shape — a sample response, a schema, the
  producer's own source — declare it, and still parse at the boundary (`TS-1`, `TS-2`): a
  hand-written type is a claim about someone else's output, and the compiler cannot check it. If you
  do **not** have the shape, do not invent fields to fill the gap. Keep the value `unknown`, narrow
  the fields you actually use, and say what you could not establish. An invented type compiles,
  reads as authoritative, and is fiction; `unknown` is at least honest about what you know.

  **Put it where the next person will find it:** beside the function that produces or fetches the
  data, exported once. A type declared inside a component, or dropped into a `types.ts` grab-bag, is
  a type the next agent will fail to find and will write for a second time.

  **Not when:** the shape is genuinely local — a component's own props, a function's internal return
  value — which is not a contract and does not become one by being hoisted somewhere shared. And
  **sameness of shape is not sameness of contract**: two types with identical fields today, owned by
  different modules, will diverge, and having shared one turns that ordinary divergence into a
  conflict that has to be negotiated.

  **Cashes out as:** with one type, a change to the contract is a compile error at **every**
  consumer. With two hand-written copies, it is a compile error at one of them and silence at the
  rest, which keep compiling against a shape the producer no longer sends.
