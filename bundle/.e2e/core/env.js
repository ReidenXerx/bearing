/**
 * Which backend is this app ACTUALLY talking to — and refusing to run blind.
 *
 *   const seen = watchApiEnv(page, classify);
 *   await page.goto(BASE);
 *   const env = await guardEnv(seen, { declared: storage.__env });
 *   if (!env.ok) { report.check('safe to run here', false, env.reason); report.finish(); return; }
 *
 * ## Why this is not paranoia
 *
 * Staging and production are routinely served from the SAME origin — `npm start` and
 * `npm run start:prod` both serve localhost, and the only difference is which API host got baked
 * into the bundle. Nothing on the page says which one you got. Two consequences, neither of which
 * announces itself:
 *
 * 1. **A session export is environment-scoped but looks identical.** Same origin, same storage
 *    keys, same shape — only the token values differ. Inject a production token into a staging
 *    build and every call 401s, the app bounces to login, and the harness reports "the export has
 *    expired". That is a FALSE diagnosis, and chasing it means re-exporting a session that was
 *    never broken.
 * 2. **Production writes are real and have no undo.** A verifier that is safe against staging is
 *    not automatically safe against production, and the difference is invisible from inside the
 *    page.
 *
 * So: detect the backend from the requests the app actually makes — not from config, which is what
 * you already believed — compare it against what the export says, and require an explicit opt-in
 * before anything runs against production.
 *
 * ## You must supply `classify`
 *
 * It is the one app-specific part: `(host) => 'production' | 'staging' | null`, where null means
 * "not one of ours, ignore it". SCOPE IT TO YOUR OWN HOSTS FIRST. A classifier that keys off a
 * leading `api.` will label any third party that happens to match — one app calls `api.country.is`
 * for geolocation, which read as PRODUCTION and refused a perfectly good staging run. That failed
 * safe; the same loose latch reading `staging` off a third party WHILE POINTED AT PRODUCTION is the
 * direction that disarms the write guard.
 */

/**
 * Record which backend the app talks to, as it talks to it.
 *
 * Returns a LIVE object — read it after a navigation settles, not immediately. `.env` stays null
 * until a real request happens, and null means "have not seen one yet", never "no backend".
 *
 * @param {import('playwright').Page} page
 * @param {(host: string) => string|null} classify
 */
const watchApiEnv = (page, classify) => {
  const seen = { host: null, env: null, hosts: new Set(), classify: Boolean(classify) };
  page.on('request', (req) => {
    let host;
    try {
      host = new URL(req.url()).host;
    } catch {
      return;
    }
    seen.hosts.add(host);
    if (seen.env || !classify) return;
    const env = classify(host);
    if (env) {
      seen.env = env;
      seen.host = host;
    }
  });
  return seen;
};

/** Wait for the first classified request, or give up. Never hangs a run. */
const waitForApiEnv = async (seen, timeout = 20000) => {
  const started = Date.now();
  while (!seen.env && Date.now() - started < timeout) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return seen.env;
};

/**
 * The guard. Call it after the first navigation settles.
 *
 * `ok:false` is a HARD stop for the caller: either the session does not belong to this backend, or
 * this is production without an explicit opt-in.
 *
 * An UNCONFIGURED guard returns ok:true and says so. It must not block every run before anyone has
 * written a classifier (NS-5 — a false deny costs more trust than a missed gate), and it must not
 * report protection it is not providing either (GP-8), so it does neither silently.
 *
 * @param {object} seen from `watchApiEnv`
 * @param {{declared?: string, allowProd?: boolean, timeout?: number}} opts
 *   `declared` — what the session export says it was taken from, if it stamps that.
 */
const guardEnv = async (seen, { declared, allowProd = process.env.ALLOW_PROD === '1', timeout = 20000 } = {}) => {
  if (!seen.classify) {
    return {
      ok: true,
      env: 'unclassified',
      reason:
        'environment guard is INERT — no classify() was supplied, so this run is not protected ' +
        'against pointing at production. See core/env.js.',
    };
  }

  const env = await waitForApiEnv(seen, timeout);

  if (!env) {
    return {
      ok: false,
      env: null,
      reason:
        'Never saw a request to a host classify() recognises, so the backend is unknown. The app ' +
        `may not have booted, or the dev server is not running. Hosts seen: ${[...seen.hosts].slice(0, 8).join(', ') || 'none'}`,
    };
  }

  if (env === 'production' && !allowProd) {
    return {
      ok: false,
      env,
      reason:
        `Refusing to run against PRODUCTION (${seen.host}) without ALLOW_PROD=1. Writes there are ` +
        'real and have no undo. Re-run with ALLOW_PROD=1 only when that is genuinely what you ' +
        'intend, and only with blockWrites in place.',
    };
  }

  if (declared && declared !== 'unknown' && declared !== env) {
    return {
      ok: false,
      env,
      reason:
        `Session/backend MISMATCH — the export was taken from ${String(declared).toUpperCase()} but ` +
        `this build is calling ${env.toUpperCase()} (${seen.host}). The token will 401 and the app ` +
        'will bounce to login, which reads as "session expired" and is not. Either restart the dev ' +
        `server for ${declared}, or use the ${env} export.`,
    };
  }

  return { ok: true, env, reason: `${env} (${seen.host})` };
};

module.exports = { watchApiEnv, waitForApiEnv, guardEnv };
