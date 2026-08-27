---
name: bearing-frontend
description: "Structure UI as reusable components, and treat editing a shared one as the multi-screen change it is. Use when about to write layout markup that encloses other content — a table, a bordered panel, a card, a modal shell, a toolbar — when deciding whether an existing component fits, or when a change to a shared component would alter what existing callers render. Examples: \"add a table to this page\", \"wrap this in a bordered box\", \"can I add a prop to Panel?\", \"is there already a component for this?\", \"build the settings layout\"."
---

# Frontend — structure, and what it costs to change it

The rules live in **`.bearing/stack/frontend.md`**, numbered `UI-1` onward. Read it before writing
layout and cite the number when it decides something. This skill is *when* and *how*; the file is
*what*.

**Nothing here names a framework.** Your team picked one; the rules are about what a shared piece of
layout costs to change, which is the same in all of them.

## The asymmetry the whole thing rests on

**You see a diff. The user sees every screen.**

Editing a shared component looks like a five-line change and lands on every page that renders it.
You cannot open those pages, and the person reviewing the diff usually will not either — they will
read the five lines and agree with them. That is why the boundary is drawn at *what existing callers
render*, not at how large the change looks.

## Before you write layout

1. **Name what it renders, not what it is for.** "A bordered container with a heading" — not
   "a settings box". The first is searchable; the second is what only you call it.
2. **Search by shape** (`UI-1`): the element, the border/radius class, a wrapper taking children.
   Then search by the props you would need. Two or three searches. The near-duplicate you are about
   to write is always cheaper than this search — that is precisely why the search is the rule.
3. **Does it read the value, or just position it?** A component that hands a value onward —
   `renderItem`, `onChange`, `options` — should be generic so the type flows to the call site
   (`UI-2`). One that reads fields of the value wants the concrete type; a constraint naming every
   field it touches is a concrete type in generic syntax.
4. **Decide which of the three outcomes you are in** — fits / fits with an additive optional prop /
   needs a real change. Only the third is a question for a human.

## Editing a shared component

Run this before touching it, in order:

| Ask yourself | If yes |
|---|---|
| Does any existing caller **render differently** after this? | Stop — this is the ask (`UI-1`). |
| Is the new prop **required**? | Stop — every caller must change. |
| Does an existing prop change meaning or name? | Stop — silent breakage, worst kind. |
| Optional prop, default preserves today's output? | Decide it. Say what you added, in one line. |

**Count the call sites before you ask.** "Panel has 14 call sites" is a fact the human can act on;
"Panel is used in a few places" moves your uncertainty onto them, which is the opposite of the job.

## Writing the ask

Three parts, in this order, and the second is the one that gets skipped:

1. **What and how many** — the component, the counted call sites.
2. **What changes on screen** — in rendered terms. *"The settings panel and the billing panel lose
   their divider"*, not *"I removed the `divider` default"*. The person answering is picturing the
   product, not the props.
3. **Your alternative** — what you would build instead if the answer is no, so they can reply with
   one word instead of designing it for you.

## Anti-patterns

- **Writing the near-duplicate because the search was hard.** It is always found later, by someone
  who has to reconcile two components that do the same thing.
- **Wrapping instead of asking.** A new `<PanelWithDivider>` around `<Panel>` avoids the
  conversation and leaves two components where one belonged.
- **A boolean prop per caller.** `<Panel bordered dense compact flush>` is a set of branches spread
  across every caller instead of one file. If the variants are real, name them; if they are not,
  they are duplication.
- **Extracting in anticipation.** One caller and no second in sight is not a component yet.
- **Asking about everything.** An optional prop whose default preserves the current rendering is
  yours to decide. Asking for that is how the useful asks start getting ignored.
