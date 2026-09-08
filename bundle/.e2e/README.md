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
| `core/recording.js` | **works** — a frame for every failed check and every crash; `SHOTS=all` records video too |
| `core/seeds.js` | **works** — a ledger of what a run created, so litter is swept by record and not by memory |
| `tools/audit-checks.js` | **works** — audits your verifiers for shapes that have reported something untrue, with fixtures that prove each rule fires |
| `tools/sweep-seeds.js` | **works** — shows what a dead run left; deletes only with `--delete`, and never against production |
| `core/env.js` | **works, needs one function** — which backend am I actually talking to, and refuse production without an opt-in |
| `tools/export-storage.js` | template — paste it in a browser console to capture a session |
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
   regression baselines — no diffing, no approval step, no `editor-final-2.png`. A screenshot is
   EVIDENCE, never a check: an image nobody diffs cannot fail a build, so pair every shot with a
   `check()` that can.
7. **Know which backend you are on before you touch it.** `guardEnv` after the first navigation.
   Staging and production are routinely the same origin with different tokens, and nothing on the
   page says which you got.

## Scars — each of these produced a GREEN run over a real failure

- **A leftover fixture fails the NEXT run, and looks like a product defect.** One abandoned
  definition left a required field empty on every row, which correctly disabled a button, and the
  check that met it reported a plausible bug in the app. The defence used to be a filename prefix
  and a tool that grepped for it — which reported "0 leftovers" with live fixtures on the account
  **twice**, because a convention only protects the cases somebody remembered. `core/seeds.js`
  records what was actually created instead, and watches responses rather than the harness's own API
  helper, because a verifier that builds fixtures by driving the UI never calls that helper.
- **A ledger that guesses is a delete that guesses.** The first draft treated any 2xx POST returning
  an `id` as a creation. That fires on an idempotent create (`200 {id: <existing>}` — deleting a
  record with a history the run did not make), on a third-party call (a payments app POSTs to
  Stripe and Sentry on ordinary loads, and `DELETE /v1/customers/{id}` is a real route), and on a
  response this kit's own `blockWrites` faked — `route.fulfill()` produces a real `response` event,
  so the ledger recorded a phantom id and the sweeper would later delete a REAL object of it. Every
  default now errs toward under-tracking: a missed fixture is visible litter, an over-tracked one is
  an irreversible delete.
- **"It refused everything" and "it is broken" produce identical output.** The four refusals above
  were first verified with four passing assertions while `track()` was throwing on every call. An
  absence assertion needs a positive case beside it or it proves nothing.

- **A green assertion beside a blank picture.** A check read a delete dialog's icon colour off the
  DOM, got the right answer, and passed — while the screenshot filed as its evidence showed no
  dialog at all and a highlight ringing bare page. A UI kit animates a modal in over ~300ms, and
  `waitFor({state: 'visible'})` resolves the instant the node exists and is not `display:none`:
  at opacity 0, scaled to a fifth. The DOM was right and the camera was early. Whoever reviews the
  run looks at the picture, so a frame that contradicts a passing check destroys trust in the
  check. `shots.take` now passes Playwright's `animations: 'disabled'`, which fast-forwards finite
  animations to their end state and rewinds infinite ones, so a spinner cannot stall the shutter.
  (A hand-rolled wait-for-stillness loop did the same job at 312-377ms against the built-in's 43ms,
  wrote a global into the page under test, and had an unbounded path that could hang.)
- **The failure nobody photographed.** A verifier only ever captures moments someone thought, in
  advance, to capture — which is backwards, because the frame is worth most exactly where a check
  has just said something is wrong. `report.check` now photographs its own failures, and an
  uncaught throw photographs itself: the loudest failure was the one leaving no evidence at all.
- **An observability mode that changed the result.** Automatic frames were first injected into the
  interaction helpers, and took a 28-assertion verifier to 5 of 6. Callers race those helpers
  against the network — `await submit(page)` then `waitForResponse(...)` armed *after* the click —
  so a frame before the click spends a window already open and a frame after it swallows the
  response. There is no safe side. Video is passive and does not have this problem.
- **`process.exit` and `browser.close` both kill an in-flight screenshot**, and the browser is the
  earlier deadline. Draining before exit was not enough: a queued frame still vanished because the
  guard clause closed the browser first. When evidence is written asynchronously, every path that
  tears something down is a deadline.

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
- **A production token in a staging build reads as "session expired".** Same origin, same storage
  keys, only the values differ — so the export looks fine and the diagnosis is wrong. People re-export
  a session that was never broken. Stamp `__env` on the export and let `guardEnv` catch it.
- **A 401 on the identity probe is part of a HEALTHY boot.** An app carrying a stale access token and
  a good refresh token goes `401 GET <identity>` → `200 POST <refresh>` → `200 GET <identity>`. A
  guard that reads the first response calls a working export expired, skips every check below it, and
  again sends someone to re-export a session that was never broken. Only the refresh being rejected
  is final — it is the last credential the export holds. Opaque tokens carry no `exp` to inspect, so
  the sequence is the only evidence there is.
- **A host classifier that is not scoped to your own hosts will misread a third party.** One app
  calls `api.country.is` for geolocation; a rule keying off a leading `api.` read that as PRODUCTION
  and refused a good staging run. That failed safe — the same looseness reading `staging` off a third
  party while pointed at production is what disarms the write guard.
- **A full-page screenshot of a long list is unusable.** One came out 1600x109241 — no human opens
  it and no diff can use it. The viewport is what a person actually sees, so that is the default;
  pass `{full: true}` deliberately, for a short page.

## Growing this

When a verifier hits something the harness handled badly — a wait that should be a helper, a
selector strategy that keeps reappearing, a trap that cost you an hour — **append it to the scars
list above, then keep going**. Fix it at the next milestone, not mid-run: editing the harness
while it is running means your results came from a harness that no longer exists.

The list is the point. A harness that only grows helpers gets bigger; one that grows scars gets
harder to fool.

## Evidence for passes

`report.check(name, ok, detail, { evidence: true })` photographs the state a PASSING check rests on.
Failures are captured automatically; passes are not, because a frame per assertion is thousands of
files. Reach for it on the check whose verdict rests on something visible — a locator that stops
matching reports absence, which reads as a clean pass, and that is the failure with no picture.

`SHOTS=evidence` turns it on for every check; `SHOTS=off` disables all capture, including this.
