/**
 * CONTRACT STUB — bearing ships the shape and the scars; you write the body.
 *
 * This is the one file that cannot be shipped working, because how an app holds a session is the
 * most app-specific thing about it. What IS universal is the approach and the traps.
 *
 * ## The approach: export a real session, inject it — do not automate login
 *
 * Driving a hosted login (OAuth + PKCE, SSO, an MFA prompt) from a verifier is slow, brittle, and
 * frequently against the identity provider's terms. Instead: log in once as a human, export the
 * browser's storage to a JSON file, and inject it before the app boots. `tools/export-storage.js`
 * is the companion that produces it — a console snippet you paste, not a script you run.
 *
 * BEFORE the app boots is load-bearing — `page.addInitScript`, not `page.evaluate` after
 * `goto`. An app that reads its token during module init has already decided it is logged out by
 * the time `goto` resolves, and you get a login screen with a perfectly good token sitting in
 * localStorage.
 *
 * ## Find out how your app stores a session. Do not assume. Three traps, all observed:
 *
 * 1. **The key names may not be constants.** One app derived its storage prefix from the OAuth
 *    client id, so the keys differed between environments and between user roles. Carry whatever
 *    keys the real export had; do not hardcode a prefix.
 * 2. **Values may be stored RAW.** If the app writes the string it was given and never JSON-parses
 *    on the way out, injecting a re-stringified value produces a token that LOOKS present and
 *    authenticates as nothing — the worst failure mode, because the app renders, empty.
 * 3. **Writers and readers can disagree.** One app's setter wrote both sessionStorage and
 *    localStorage while its getter read localStorage only. Write both, so the injected state
 *    matches what the app itself would have produced.
 *
 * ## "Is this session alive?" is a SEQUENCE, not a response
 *
 * Whatever you write to answer that — an `isSignedIn`, a skip guard, anything deciding whether the
 * run is worth continuing — has to read the whole exchange, because a healthy boot commonly
 * CONTAINS a failure. An app holding a stale access token and a good refresh token does this:
 *
 *     401  GET   <identity probe>     <- looks fatal, is not
 *     200  POST  <token refresh>      <- the app rescues itself
 *     200  GET   <identity probe>     <- signed in
 *
 * Judge on the first line and you report a working export as expired, skip every check beneath it,
 * and send someone off to re-export a session that was never broken — the same false diagnosis the
 * `__env` stamp exists to prevent, reached from the opposite direction. Classify instead: only the
 * REFRESH being rejected is final, because it is the last credential the export carries. A success
 * outranks an earlier failure. A timeout with a failure that never got rescued is a real failure.
 *
 * Do not expect the token to tell you. Opaque tokens carry no `exp` to read, so behaviour is the
 * only signal available — which is also why the export stamps `__exportedAt` rather than trying to
 * compute a lifetime.
 *
 * The other workable strategy, when the refresh endpoint can be called directly, is to renew the
 * token BEFORE opening the browser and never see the 401 at all. Either is fine. Choosing neither
 * is what produces the false negative, and it is easy to choose neither by accident, because
 * nothing about the 401 announces that it is routine.
 *
 * ## Kit metadata must be stripped
 *
 * Stamp your export with `__env` / `__apiHost` / `__exportedAt` so a sandbox session is
 * distinguishable from a production one — they are otherwise identical, same origin and same key
 * names, and that distinction is the difference between a test and an incident. Then STRIP the
 * `__` keys before injection: writing them into the page puts junk in the app's own namespace.
 *
 * ## Implement these
 *
 *   loadStorage({ storage })   -> the parsed export, or throw with the path it looked for
 *   applySession(context)      -> inject before boot; throw if there is nothing to inject
 *   accountIdOf(storage)       -> whatever identifies "who am I logged in as", for the log line
 *
 * Each MUST throw rather than return empty. A verifier that silently runs logged-out does not fail
 * — it reports every feature as missing, which reads exactly like a broken app.
 */
const fs = require('fs');
const { storageFile } = require('./paths');

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');

const notImplemented = (fn) => {
  throw new Error(
    `.e2e/core/session.js: ${fn}() is not implemented yet.\n` +
      `  This is a bearing contract stub — it throws on purpose, because a harness that silently\n` +
      `  runs logged-out reports every feature as missing and looks like a broken app.\n` +
      `  See the header of this file for the approach and the three traps, then implement it.`,
  );
};

/** Read the exported session. Throw — loudly, with the path — when it is absent. */
const loadStorage = ({ storage = process.env.STORAGE } = {}) => {
  const file = storageFile(storage || 'storage.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      `No session export at ${file}.\n` +
        `  Create one: log in in a browser, then paste .e2e/tools/export-storage.js into its\n` +
        `  console and save what it copies here. It is a console snippet, NOT a node script —\n` +
        `  node cannot read a logged-in browser's storage.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

/**
 * Inject the session into a fresh context BEFORE the app boots.
 *
 * NOT `async`, deliberately, even though your implementation will be. An async stub returns a
 * REJECTED PROMISE instead of throwing, so a caller that forgets to `await` gets an unhandled
 * rejection and carries on running logged-out — the silent no-op this whole file is written to
 * prevent. A synchronous throw stops both awaited and un-awaited callers.
 */
// eslint-disable-next-line no-unused-vars
const applySession = (context, opts = {}) => notImplemented('applySession');

/** Who this session belongs to — printed so a run says which account it measured. */
// eslint-disable-next-line no-unused-vars
const accountIdOf = (storage) => notImplemented('accountIdOf');

/**
 * Headers that authenticate a request made from INSIDE the page, or `{}` if cookies already do.
 *
 * ⚠ NOT A THROWING STUB, because cookies are a complete answer for plenty of apps — but not for the
 * one this file's own docblock describes at length, which keeps a token in `localStorage`. A
 * `fetch(..., {credentials: 'include'})` sends cookies and nothing else, so for a token app every
 * request the harness makes outside the app's own HTTP client goes out anonymous and comes back
 * 401 — which reads as "the object could not be deleted" rather than "I never authenticated".
 *
 * `tools/sweep-seeds.js` is the caller today. Return e.g.
 * `{ Authorization: `Bearer ${JSON.parse(storage['auth']).accessToken}` }`.
 */
// eslint-disable-next-line no-unused-vars
const authHeaders = (storage) => ({});

module.exports = { BASE, loadStorage, applySession, accountIdOf, authHeaders };
