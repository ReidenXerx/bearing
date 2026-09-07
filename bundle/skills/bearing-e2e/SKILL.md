---
name: bearing-e2e
description: "Use when verifying app behaviour in a real browser, or when the user asks for a screenshot of a page/view. Covers writing a verifier in .e2e/, testing a destructive write without performing it, and capturing shots. Examples: \"check the payer editor works\", \"screenshot the dashboard\", \"does this button send the right payload\", \"verify the fix end to end\"."
---

# The `.e2e` harness

`.e2e/` is a browser harness the project FINISHES. bearing ships the substrate (`core/`), the
contracts, and the scars; the app-specific parts are yours to build and to grow.

**Read `.e2e/README.md` before writing a verifier.** Its scars list is the point of the whole
module — every entry is a green run over a real failure.

## When to reach for it

| Situation | Do |
| --- | --- |
| "does this actually work in the browser?" | write a verifier in `.e2e/verify/` |
| "does this button send the right payload?" | `blockWrites` — assert the payload, never perform the write |
| user wants to SEE a page | `shots.take(page, '<view-key>')`, then read the png |
| a fix needs proving, not describing | a verifier that FAILS before the fix and passes after (NS-9) |
| the app is not running / no session | `skip(name, why)` — never a `check` that is a skip in disguise |

Not for unit-testable logic. A browser is the slowest way to test a pure function.

## Writing one

Copy `verify/smoke.js`. The shape:

```js
withBrowser(async (browser) => {
  const report = createReport('<what this verifies>');
  // ... check() what ran, skip(name, why) what could not
  report.finish();          // exit code IS the product
});
```

Four rules that are not negotiable, each earned:

1. **A skip is not a pass.** A run where nothing passed exits 1 even with zero failures.
2. **Poll, never sleep.** `until` / `untilAtLeast` / `untilStable`. A `waitForTimeout` is a guess
   about latency that fails as a bug report.
3. **Assert on the body, not the status** — `acceptedWrite`, because a 2xx can carry an error
   envelope and a URL pattern usually matches both the create and the list.
4. **Never perform a destructive write to see if the button works.** Write every verifier as if it
   were pointed at production.

## Screenshots

`shots.take(page, key, {note})`. The key is what the shot IS (`payers/editor`), not a filename —
the next capture of that view REPLACES it. Freshest wins, deliberately: these are documentation,
not regression baselines. Do not add diffing, do not add approval, do not write `-v2`.

Always pass `note`. A png whose meaning lives only in your head is not a catalogue entry.

## Evidence you do not have to remember to collect

Wire it once, in the verifier, next to the context:

```js
const context = await browser.newContext({ ...recording.contextOptions() });
const page = await context.newPage();
recording.adopt(context, page, shots);
```

From then on: **every failed `check` photographs the page it failed on**, an uncaught throw
photographs itself before the process dies, and the whole run is on video. `SHOTS=key` drops the
video and keeps the frames; `SHOTS=off` silences both — use it for a check that MEASURES timing,
where the shutter itself would move the number.

This exists because a verifier otherwise only captures moments someone predicted, and nobody
predicts where a failure lands. **Do not add automatic frames inside interaction helpers** — that
was tried, and it took a 28-assertion verifier to 5 of 6, because callers race those helpers
against the network and a frame on either side eats the event.

## Fixtures a run creates

`core/seeds.js` ledgers anything the page creates, by watching responses rather than your own API
helper — a verifier that builds fixtures by driving the UI never calls the helper. A clean run
releases its own entries, so **what survives on disk is the leak**, and
`node .e2e/tools/sweep-seeds.js --dry` says what a killed run left behind.

Leftover fixtures do not fail the run that made them. They fail the next one, looking like a bug in
the app.

## Auditing the verifiers themselves

`node .e2e/tools/audit-checks.js` reads `verify/` for shapes that have reported something untrue —
a `check(name, true)` that cannot fail, Playwright selector syntax inside `page.evaluate`, a report
that never calls `finish()`, fixtures created with no delete. Run it before trusting a green suite.

## Growing the harness — bounded

When you hit something the harness handled badly, **append it to `README.md`'s scars section and
keep going.** Do not edit `core/` mid-run: results from a harness that no longer exists are not
results. Fix it at the next milestone, and say in your report that you did.

Add a helper only on the THIRD time you write the same thing. Two is a coincidence.

## Anti-patterns

- A verifier that cannot fail. Run it against the broken state first, or you have tested nothing.
- Reporting "verified" from a run whose checks all skipped — read the tally, not the exit line.
- Growing `core/` with app-specific selectors. That is what `interact/` is for.
- Reaching for the browser when reading the code would answer it.
