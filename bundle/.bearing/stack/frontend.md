# Frontend — structure, and what it costs to change it

**Ships with bearing. Applies to any project with a rendered UI.** Numbered `UI-#` — cite the number
when a rule decides a choice.

**If this repo has `.bearing/northstars.md`, those `NS-#` outrank this file** — a project's own
invariant is more specific than a general rule, so on conflict the `NS-#` wins and you say which one
and why. Where this file and the repo's own component conventions disagree, the repo wins; this is
advice, those are the thing itself.

**This file is bearing's, not yours.** `bearing update` overwrites it — project rules belong in
`.bearing/northstars.md`, which bearing never touches.

---

**Nothing here names a framework or a styling library.** Those turn over every couple of years, and
your team has already picked theirs. What does not turn over is that a shared piece of layout has
more than one caller, and that the person editing it sees a diff while the user sees every screen at
once.

Each rule says what it costs to get wrong, because that cost is the whole reason the rule is not
"prefer reusable components", which everyone already agrees with and nobody acts on.

---

## Structure

- **UI-1** — **A structural unit is a component, and a shared component's edit surface is every
  screen that renders it.**

  **When:** you are about to write markup whose job is *shape* rather than content — a table, a
  bordered panel, a card, a modal shell, a toolbar, a list wrapper. Anything that encloses content
  it does not own.

  **Search before you write, and search by SHAPE, not by name.** The component you want is rarely
  called what you would call it: you look for `UserTable`, the repo has `<DataGrid>`; you look for
  `BorderedBox`, it is `<Panel>`. Search for what it **renders** — the `<table>` element, the border
  or radius class, a wrapper that takes children — and for the props you would need. Two or three
  searches, not one. Writing a near-duplicate is cheaper than searching for the original, which is
  exactly why it keeps happening, and why the second one is always found in review rather than
  before it.

  **Three outcomes, and only two of them are yours to decide:**

  - **It fits** → use it. Do not wrap it in a new component just to add a class or rename a prop.
  - **It fits with a new OPTIONAL prop whose default preserves the current rendering** → additive
    and reversible. Decide it yourself, and say in one line what you added and what the default is.
  - **Anything else** — a changed default, a new required prop, different markup, a renamed or
    repurposed prop → **stop and ask.** Not because the design is unclear, but because you are
    editing every call site at once and you cannot see what any of them look like on screen.

  **The ask carries, in this order:**

  1. the component, and the **counted** number of call sites — count them, do not estimate;
  2. what changes for existing users in **rendered** terms, not code terms — "the settings panel
     loses its divider", not "I removed the `divider` default";
  3. what you would build instead if the answer is no, so the answer can be a sentence.

  **Not when:** the shape has one caller and no second in sight — extract on the second use, not in
  anticipation of one. A wrapper that only forwards its props to another component is a rename, not
  a component. And a "reusable" component that grows one boolean prop per caller is a `switch`
  wearing a costume: that is duplication with extra steps, and the branches are now spread across
  every caller instead of sitting in one file where they could be read.

  **Costs when ignored:** a near-duplicate is found in review and costs a rewrite; a silent edit to
  a shared component is found in production, by a user, on a screen nobody thought to open.

- **UI-2** — **A component that passes a value through is generic; one that reads the value is not.**

  **When:** you are writing a component whose props carry a value it hands onward rather than
  inspects — a list, a table, a select, a field wrapper, anything with a `renderItem`, `onChange` or
  `options` prop.

  Parameterise it so the type **flows**: the call site infers the element type from the data prop,
  and every callback prop is checked against it.

  ```ts
  // The component never looks inside T. It positions, it does not read.
  type ListProps<T> = { items: T[]; renderItem: (item: T) => ReactNode; onPick?: (item: T) => void };
  ```

  **Not when — and these are the three that produce generics worth less than the concrete type:**

  - **The component reads fields of the value.** Then it needs a constraint, and if the constraint
    names every field the component touches, you have written a concrete type in generic syntax.
    Take the concrete type.
  - **There is one call site.** A generic with a single instantiation is ceremony. Make it generic
    on the second caller, when you can see what actually varies between them.
  - **The parameter would be unconstrained and then narrowed inside the component.** An `unknown` or
    bare `T` that the body immediately asserts into a shape is an assertion wearing a type
    parameter, and it is worse than the honest concrete type because it reads as if it were checked.

  **Costs when ignored:** the loose version is `items: any[]`, which un-types the render callback and
  every field read inside it, so a renderer written for the wrong element compiles and fails on a
  user's screen.

  **Cashes out as:** the element type flows from the data prop into the callbacks, so handing the
  component a renderer for a different shape is a compile error **at the call site** — the one place
  that knows what the data actually is.
