/**
 * TEMPLATE — fill in WANTED, then paste the whole file into your browser console.
 *
 * NOT a node script, despite living in tools/. There is no way to read a logged-in browser's
 * storage from node: the session exists in a real browser profile, behind a hosted login you
 * should not be automating. So you log in as a human once, run this in the console of that tab,
 * and save what it copies as `.e2e/storage.json`.
 *
 *   1. log in at your app in a normal browser tab
 *   2. devtools → console → paste this whole file → Enter
 *   3. save the clipboard contents as .e2e/storage.json
 *
 * `core/session.js` injects that file before the app boots. See its header for the traps.
 *
 * ## Take the REFRESH token, not just the access token
 *
 * An access token is typically short-lived, so an export with only that is dead in an hour and
 * every run after it reports "session expired". Include whatever key lets the app renew itself and
 * one export lasts for weeks. Three separate projects learned this the same way.
 *
 * ## Name it per environment
 *
 * Staging and production usually share an origin, storage keys and shape — only the token values
 * differ, so the exports are INDISTINGUISHABLE by inspection. Save them as `storage-staging.json`
 * and `storage-prod.json` rather than overwriting one `storage.json`, and stamp `__env` so
 * `core/env.js` can catch a mismatch instead of letting it surface as a bogus "expired" error.
 *
 * ## This is a live credential
 *
 * It can reach real data as you. `.e2e/storage*.json` is gitignored by bearing; keep it that way,
 * and do not paste it into a ticket, a chat or an agent transcript.
 */
(() => {
  // ── FILL THIS IN ────────────────────────────────────────────────────────────────────────────
  // The storage keys your app needs to boot signed in. Find them by logging in, then reading
  // localStorage in this console. Exact names, or a predicate for apps that namespace their keys.
  const WANTED = ['token', 'refresh_token', 'account_id'];
  /** Some apps derive a key PREFIX from a client id, so it differs per environment and per role.
   *  Match by suffix there rather than hardcoding a prefix that silently misses the token. */
  const MATCH = (k) => WANTED.includes(k);
  /** The one key whose absence means "you are not actually logged in on THIS origin". */
  const REQUIRED = WANTED[0];
  // ────────────────────────────────────────────────────────────────────────────────────────────

  const take = (store) => {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (MATCH(k)) out[k] = store.getItem(k);
    }
    return out;
  };

  const out = { ...take(window.sessionStorage), ...take(window.localStorage) };
  // Stamped so core/env.js can tell a staging session from a production one — they are otherwise
  // identical. session.js STRIPS these before injection; they are the kit's, not the app's.
  out.__env = /localhost|127\.0\.0\.1/.test(location.host) ? 'local' : location.host;
  out.__exportedAt = new Date().toISOString();

  const json = JSON.stringify(out, null, 2);
  console.log(json);

  // A silent empty export is the failure mode here: you save {}, the run says "session expired",
  // and you go looking at the token instead of at this (GP-6).
  if (!out[REQUIRED]) {
    console.warn(
      `%cNo "${REQUIRED}" — are you actually signed in on THIS origin, and is WANTED right?`,
      'color:#c00',
    );
  }
  try {
    copy(json); // devtools-only helper
    console.log(`%cCopied ${Object.keys(out).length} keys: ${Object.keys(out).join(', ')}`, 'color:#0a0');
  } catch {
    console.log('%cSelect and copy the JSON above.', 'color:#c60');
  }
  return Object.keys(out);
})();
