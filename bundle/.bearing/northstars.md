# North-stars — __GITNEXUS_REPO__

**This file is AUTHORITATIVE.** It outranks every other doc, comment, and any agent's own
inference. When a source conflicts with a north-star, **the north-star wins and that source is
stale** — say so rather than silently averaging the two.

> **This file is a starter, and it is empty on purpose.** bearing cannot know what is true about
> your project, and a fabricated invariant would be worse than none — the contract above makes
> whatever is written here outrank reality. So the numbered entries are yours to write, and until
> at least one exists, the session primer and the re-anchor hook stay quiet rather than pointing
> at an empty promise.
>
> **Delete this blockquote once you add the first one.** Everything below it is format and
> guidance, not content.

---

## What earns a place here

A north-star is a fixed point someone would otherwise **re-litigate, re-derive, or contradict** —
and the cost of that is real. Four kinds earn a number:

- **Invariants** — what must always hold, and what breaks when it doesn't. The good ones name the
  incident: *"uninstall once deleted the user's own notes because the directory looked ours."*
- **Term meanings** — the word this project uses in a non-obvious way. If two people can read
  "active user" differently, one of them is writing the wrong query.
- **Settled decisions** — chosen, with the reason, so it stops being reopened every quarter.
- **Rejected ideas** — the graveyard. This is the half people skip and the half that pays: without
  it, a good-sounding idea that was already measured and killed comes back every six months.

**What does NOT earn one:** anything the code already says, anything a linter enforces, style
preferences, and anything you would happily change next week. A file of forty soft opinions
anchors nothing — the agent skims it and the real invariants drown.

## Format

Number them `NS-#`, one claim each, and lead with the claim itself:

```
- **NS-#** — **The headline claim, stated in one sentence.** Then the mechanism, the numbers, or
  the incident that makes it true. Cite what you measured, not what you assume.
```

Two rules make the difference between a doc and an anchor:

1. **Claim first.** The re-anchor hook re-injects only the opening sentence of each entry, so an
   entry that opens with background and buries the rule delivers a cliffhanger and nothing else.
2. **Never renumber.** A number is a citation; reusing one silently rewrites every reference to it.
   Retire an entry by moving it under a "Superseded" heading with a line saying what replaced it.

Group them under headings as they accumulate — invariants, evidence, settled, open, superseded.
The order does not matter to the tooling; it matters to the person reading at 2am.

## How they get used

- **Session start** — you are told to read this file before forming any premise.
- **Mid-session** — the anchor hook re-injects the claims every N tool calls and after you write a
  doc, because that is when a drifted premise gets written down and becomes "settled".
- **When work is delegated** — the relevant subset goes to every subagent, so a fan-out cannot
  quietly contradict a decision you already made.
- **In review** — a finding that cites a north-star is a finding you can act on without arguing.

## Writing the first few

You do not have to invent them. They already exist, as scar tissue:

- The last three bugs that were **the same bug** wearing different clothes.
- Whatever you explained twice in review this month.
- The decision you keep having to defend.
- The thing a new person always gets wrong in their first week.

Ask your agent to propose a set from the repository's own history — `git log` for the reverts and
the "actually, no" commits, the review threads, the incident notes — then **edit hard**. Something
proposed and never checked is not a fixed point, it is a guess with a number on it.

<!-- Add your first entry below. Delete the guidance above whenever you like — this file is yours,
     and bearing seeds it once and never overwrites it. -->

## Invariants — must always hold

## Settled — decided; do not relitigate

## Open

## Superseded — kept so old citations still resolve
