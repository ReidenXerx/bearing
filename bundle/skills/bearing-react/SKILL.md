---
name: bearing-react
description: "React specifics that type-check, run, and are still wrong — starting with react-hook-form, where a field component owns its Controller and a `name` typed as string can drop a value from the submitted form with no error anywhere. Use when building or reviewing a form input, wrapping a controlled component for a form library, naming a field in setValue/watch/getValues, or when a form submits without a field's value. Examples: \"add a text field to this form\", \"wrap this select for react-hook-form\", \"why is this field missing from the payload?\", \"review this form component\"."
---

# React — the parts the library's own types do not catch

The rules live in **`.bearing/stack/react.md`**, numbered `REACT-#`. Read it before building form
inputs and cite the number when it decides something. This skill is *when*; the file is *what*.

**The bar for that file:** the library's own types stay silent. If React or the form library already
errors on it, it is not in there — so nothing in the pack is something you would have caught by
reading the type error.

## Forms — react-hook-form

**One shape, and the callers never see `Controller`:**

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

Everything below is a way for that to look right and behave wrong.

| Check | Rule | Why it is silent |
|---|---|---|
| Is `name` typed `FieldPath<T>` rather than `string`? | `REACT-2` | A stale name compiles, renders, and contributes nothing to the payload. |
| Is `field` **spread**, not destructured? | `REACT-1` | Dropping `ref` kills focus-on-error; nothing throws. |
| Is the field registered exactly once? | `REACT-1` | A double registration submits a stale value. |
| Does a call site write its own `render`? | `REACT-1` | The wiring is now duplicated, and fixes land in one copy. |
| Is this a plain native input? | `REACT-1` | Then `register` is lighter — `Controller` is not a default. |

**The failure these share is silence.** A form that throws gets fixed the same day. A form that
submits without one field gets reported by a user, days later, as "it did not save" — and the
component looks correct in review, because it is correct in every way the compiler can see.

## When the form shape is not static

A schema assembled at runtime from server-driven config genuinely has no compile-time field union.
Keep the unchecked names in **one adapter** at that boundary and hand typed names outward from it.
Letting `string` names spread through the components trades one honest gap for an unbounded one.

## Anti-patterns

- **`Controller` on every input.** It is for controlled and third-party components. A native
  `<input>` with `register` re-renders less and needs no wrapper.
- **Destructuring `field` to "be explicit".** The explicit version is the one that drops `ref`.
- **`name={\`items.${i}.qty\`}` as a bare template string.** Field arrays have typed paths too; a
  hand-built string is `REACT-2` with an index in it.
- **Reaching for the pack when the type error already told you.** If the library errored, read that
  instead — the pack is only for what it cannot say.
