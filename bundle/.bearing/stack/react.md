# React — the parts the library's own types do not catch

**Ships with bearing. Applies to projects built on React.** Numbered `REACT-#` — cite the number
when a rule decides a choice.

**If this repo has `.bearing/northstars.md`, those `NS-#` outrank this file** — a project's own
invariant is more specific than a general rule, so on conflict the `NS-#` wins and you say which one
and why. Where this file and the repo's own conventions disagree, the repo wins.

**This file is bearing's, not yours.** `bearing update` overwrites it — project rules belong in
`.bearing/northstars.md`, which bearing never touches.

---

**The bar: the library's own types must stay silent.** Every rule here describes something that
type-checks against the library, runs, and is still wrong — usually by going quiet rather than by
failing. There is nothing here about how hooks work or when to use state; the docs cover that, and a
rule you can look up costs context and changes nothing.

Rules naming a specific library say so in the heading, so a repo that does not use it can skip the
rule rather than wonder whether it applies.

---

## Forms — react-hook-form

- **REACT-1** — **A form field component owns its `Controller`. Callers pass `name` and `control`,
  never a `render`.**

  **When:** you are building an input meant to be used inside a react-hook-form form — a text field,
  a select, a date picker, any wrapper around a controlled input.

  ```tsx
  export function FormTextField<T extends FieldValues>(
    { name, control, ...rest }: { name: FieldPath<T>; control: Control<T> } & InputProps,
  ) {
    return (
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState }) => (
          <Input {...rest} {...field} error={fieldState.error?.message} />
        )}
      />
    );
  }
  ```

  The caller writes `<FormTextField name="email" control={control} />` and never sees a `Controller`.
  A `render` prop repeated at every call site is the same wiring copied N times, and the copies are
  where the next two rules go wrong one at a time.

  **Spread `field`; do not destructure it.** `{...field}` carries `onChange`, `onBlur`, `value`
  **and `ref`**. Take the first three by hand and focus-on-error silently stops working: a failed
  submit scrolls nowhere and highlights nothing, on a form that otherwise behaves. Nothing fails,
  nothing logs, and the library's types are perfectly happy — the `ref` was optional to pass.

  **One registration per field.** A field driven by `Controller` must not also be `register`ed, and
  a wrapper that both spreads `field` and calls `register` inside is registering twice. The second
  registration wins, the first field's state stops updating, and the form submits a stale value.

  **Not when:** the input is a plain uncontrolled native element with no third-party wrapper —
  `register` is lighter and re-renders less. `Controller` earns its cost on controlled components,
  not on every `<input>` in the codebase.

  **Costs when ignored:** the wiring is duplicated at every call site, so each of the failures above
  gets fixed in one place and stays broken in the others.

- **REACT-2** — **A field `name` typed as `string` is a value that can vanish from the submitted
  form without one error anywhere.**

  **When:** any prop that names a form field — on a wrapper, a helper, or a call to `setValue`,
  `watch` or `getValues`.

  Type it against the form's own shape, which is what the generic on the component is *for*:

  ```ts
  { name: FieldPath<T>; control: Control<T> }   // not { name: string }
  ```

  With `string`, renaming a field in the schema — or simply mistyping it — leaves a component that
  compiles, renders, validates as untouched, and contributes **nothing** to the submitted payload.
  There is no error, no warning, and no failing test unless one already asserts on that exact key.
  The bug is found by a user reporting that their data did not save.

  With `FieldPath<T>` the same rename is a compile error at every site that named the old field,
  which is the entire reason the wrapper is generic rather than concrete.

  **Not when:** the form shape genuinely is not known at compile time — a schema built at runtime
  from server-driven config. Then say so at the boundary and keep the unchecked name in one adapter,
  rather than letting `string` names spread through every component.

  **Cashes out as:** a field rename becomes a compile error at every consumer instead of a silently
  missing key in the payload.
