# `.e2e` — a browser harness you finish yourself

Not a test framework. Playwright is the capability; this is the **shape, the contracts, and the
scars** — the part that took three projects and a lot of wrong green runs to learn.

Everything here runs plain Node. No test runner, no config file, no watch mode. A verifier is a
script that exits 0 or 1.

```
node .e2e/verify/smoke.js                       # works immediately, needs no session
BASE=https://staging.example.com node .e2e/verify/smoke.js
HEADED=1 SLOWMO=250 node .e2e/verify/smoke.js   # watch it happen
```

## What is real, and what is yours

| | |
| --- | --- |
| `core/report.js` | **works** — PASS/FAIL/SKIP, the tally, the exit code |
| `core/browser.js` | **works** — lifecycle + teardown, `HEADED`, `SLOWMO` |
| `core/wait.js` | **works** — poll for the thing; never sleep |
| `core/http.js` | **works** — watch requests/responses, and test a write without performing it |
| `core/shots.js` | **works** — screenshots keyed by view, freshest wins, self-cataloguing |
| `core/paths.js` | **works** — resolved once, so a script can move |
| `core/session.js` | **stub — throws until you write it.** How your app holds a session is the most app-specific thing about it |
| `verify/smoke.js` | the worked example. Copy its shape |
| `interact/` | yours: navigation, forms, tables, overlays — the vocabulary of *your* UI |

`npm install` inside `.e2e/` once, then `npx playwright install chromium`. The kit keeps its own
`package.json` on purpose: it is local-only, must not join a workspace, and pins
`"type": "commonjs"` so it behaves the same in an ESM app.

## The contracts

1. **A verifier exits 0 or 1, and the exit code is the product.** One `createReport`, one
   `finish()`.
2. **A skip is not a pass.** `check()` for something that ran, `skip(name, why)` for something that
   could not. A run where nothing passed exits 1 even with zero failures — see the first scar.
3. **Poll, never sleep.** `until`, `untilAtLeast`, `untilStable`. A `waitForTimeout` is a guess
   about latency that fails as a bug report.
4. **Assert on the body, not the status.** See the scars.
5. **Never perform a destructive write to see if the button works.** `blockWrites` records the
   payload and fulfils it locally. Write every verifier as if it were pointed at production,
   because one env var is usually all that stands between you and that.
6. **One shot per view, keyed by what it IS.** Freshest wins. These are documentation, not
   regression baselines — no diffing, no approval step, no `editor-final-2.png`.

## Scars — each of these produced a GREEN run over a real failure

- **A skipped check is not a passing one.** A report stored skips as `pass: true`. A verifier whose
  every check sat inside `for (const page of PAGES)` and skipped on "this tab is empty" — the
  ordinary state of a fresh environment — printed `0/0 passed` and exited 0. Its own docblock said
  skips were not passes. The comment was a claim the code did not honour.
- **A URL pattern does not identify one call.** `/api/thing` is the create *and* the list. A
  verifier read `responses[0].status` as the create's and got the list's 200 while the POST failed
  500. Pass `methods`, and prefer the last entry — order is arrival order, not call order.
- **A 2xx is not acceptance.** APIs return `{code, message, trace_id}` with a 200. A generated
  client runs it through `*FromJSON` and hands you a model with no `id`; every field is undefined
  and nothing errors. Use `acceptedWrite`, which checks status *and* body.
- **Blanket-blocking POST severs the session.** A token refresh is a POST. Fulfil it with `{}` and
  the app silently drops its session — the page renders empty, the probe finds no rows, and the
  verifier reports the feature as missing. A green-looking run that measured a harness bug, and a
  full debug cycle spent on an app that was fine. `NON_WRITE_POSTS` exists for this; extend it.
- **A fixed sleep reads as a broken feature.** A probe slept 1200ms, counted 0 options, and reported
  "0 options" for every query. Then it "proved" that scrolling loads more results — because by the
  time it scrolled, the first load had landed. Both readings wrong, both looked like data.
- **`Object.entries` over a query string iterates characters.** The loop matched nothing, so the
  check passed having inspected nothing. Use `paramsOf`; `Object.fromEntries(searchParams)` also
  silently keeps only the last value of a repeated param.
- **Injecting a re-stringified token authenticates as nothing.** If the app stores values raw, the
  token looks present and the app renders, empty. Verify how your app stores a session; do not
  assume.

## Growing this

When a verifier hits something the harness handled badly — a wait that should be a helper, a
selector strategy that keeps reappearing, a trap that cost you an hour — **append it to the scars
list above, then keep going**. Fix it at the next milestone, not mid-run: editing the harness
while it is running means your results came from a harness that no longer exists.

The list is the point. A harness that only grows helpers gets bigger; one that grows scars gets
harder to fool.
