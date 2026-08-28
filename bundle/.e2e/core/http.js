/**
 * Honest request readers, and a way to test a WRITE without performing it.
 *
 * `blockWrites` is the reason this file exists: intercept the mutation, record exactly what the
 * app tried to send, and fulfil it locally so nothing reaches the API. That turns "does this
 * button post the right payload" from an irreversible experiment into an ordinary assertion —
 * which is the only way to verify a destructive action (a merge with no undo, a hard delete, a
 * send that a customer receives) at all.
 *
 * Write verifiers as if they were always running against production, because one env var usually
 * is the only thing standing between you and that.
 *
 * EVERY function below exists because its absence produced a GREEN line over a FAILED write.
 * Read the traps before assuming a status code told you something.
 */

/** Record every request whose URL matches, with its parsed JSON body. */
const watchRequests = (page, pattern) => {
  const seen = [];
  page.on('request', (req) => {
    if (!pattern.test(req.url())) return;
    let body;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData() || undefined;
    }
    seen.push({ method: req.method(), url: req.url(), body });
  });
  return seen;
};

/**
 * Record RESPONSES, not just that a request went out.
 *
 * `waitForResponse` resolves for a 4xx exactly as it does for a 200, so a write the API rejected
 * still satisfies every request-shape assertion. Assert on the status too, or the check passes on
 * a broken feature.
 *
 * ## PASS `methods`. Two traps, both of which produced a green line over a failed write.
 *
 * 1. **A URL pattern does not identify one call.** `/api/thing` is usually the create AND the
 *    list — `?filter=…` matches the same regex. A verifier read `responses[0].status` as the
 *    create's status, got the LIST's 200, and reported "the server accepted the create" on a POST
 *    the server had rejected with a 500.
 * 2. **Order is arrival order, not call order.** Even filtered by method, the first entry is
 *    whichever landed first. Prefer the last, or clear the array before the action you are testing.
 */
const watchResponses = (page, pattern, { methods = null } = {}) => {
  const seen = [];
  page.on('response', (res) => {
    if (!pattern.test(res.url())) return;
    if (methods && !methods.includes(res.request().method())) return;
    const entry = {
      status: res.status(),
      url: res.url(),
      ok: res.ok(),
      method: res.request().method(),
      text: null,
    };
    // Read the body eagerly: the response is not readable later, and a 2xx can still carry an error.
    res
      .text()
      .then((t) => {
        entry.text = t;
      })
      .catch(() => {
        entry.text = '<unreadable>';
      });
    seen.push(entry);
  });
  return seen;
};

/**
 * Is this response body an ERROR ENVELOPE?
 *
 * **A 2xx is not acceptance.** Plenty of APIs answer failures with a 200 or a 500 carrying
 *
 *   { "trace_id": "...", "message": "Thing does not exist.", "code": "err.thing_not_found" }
 *
 * and a generated client that only throws on non-2xx will happily run that envelope through its
 * `*FromJSON` and hand you a model with no `id`. Every field is undefined and nothing reports a
 * problem. A verifier asserting `status < 400` therefore passes on a write that did not happen.
 *
 * This is a HEURISTIC — "looks like an error, does not look like an entity". Tune the field names
 * to your API; the shape of the mistake is the part that generalises.
 *
 * @returns null when the body is not an envelope, otherwise the parsed error.
 */
const isErrorEnvelope = (text) => {
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const looksLikeError = Boolean(parsed.code || parsed.message || parsed.trace_id || parsed.errors);
  const looksLikeEntity = Boolean(parsed.id);
  return looksLikeError && !looksLikeEntity
    ? { code: parsed.code, message: parsed.message, traceId: parsed.trace_id, errors: parsed.errors }
    : null;
};

/**
 * Did this write ACTUALLY succeed? Status AND body, because either alone lies.
 *
 * @param entry one element of a `watchResponses` array
 * @returns `{ok, reason}` — `ok:false` carries why, ready to hand straight to `check`.
 */
const acceptedWrite = (entry) => {
  if (!entry) return { ok: false, reason: 'no response observed for that call' };
  const env = isErrorEnvelope(entry.text);
  if (entry.status >= 400) {
    return { ok: false, reason: `HTTP ${entry.status}${env ? ` — ${env.code || env.message}` : ''}` };
  }
  if (env) {
    return {
      ok: false,
      reason: `HTTP ${entry.status} but the body is an error envelope — ${env.code || env.message}`,
    };
  }
  return { ok: true, reason: `HTTP ${entry.status}` };
};

/**
 * Endpoints that are POSTs but are not writes — blocking them breaks the SESSION, not the data.
 *
 * A token refresh is a POST. Fulfilling it with `{}` and a 200 hands the app an empty token
 * response, so it quietly drops its session and every later call returns nothing. **Nothing
 * errors.** The page renders empty, the row probe finds no rows, and the verifier reports the
 * feature as missing — a green-looking run that measured a harness bug, and a full debug cycle
 * spent on an app that was fine.
 *
 * Add your own session-critical POSTs here. Getting this list wrong is silent.
 */
const NON_WRITE_POSTS = /\/(oauth\/token|auth\/refresh|session\/renew)\b/i;

/**
 * Intercept matching mutations so they never leave the browser.
 *
 * Returns the array of attempts; `respond` shapes the fake success. Session-critical POSTs
 * (`NON_WRITE_POSTS`) are ALWAYS let through and recorded on `attempts.exempted`, so a run can say
 * so rather than silently differing from what its own log implies. Override with `except: null`
 * only if you genuinely mean to sever the session.
 */
const blockWrites = async (
  page,
  pattern,
  {
    respond = {},
    status = 200,
    methods = ['POST', 'PUT', 'PATCH', 'DELETE'],
    except = NON_WRITE_POSTS,
  } = {},
) => {
  const attempts = [];
  attempts.exempted = [];
  await page.route(pattern, async (route) => {
    const req = route.request();
    if (!methods.includes(req.method())) return route.continue();
    if (except && except.test(new URL(req.url()).pathname)) {
      attempts.exempted.push({ method: req.method(), url: req.url() });
      return route.continue();
    }
    let body;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData() || undefined;
    }
    attempts.push({ method: req.method(), url: req.url(), body });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(respond) });
  });
  return attempts;
};

/**
 * Every value for a repeated query param.
 *
 * `Object.fromEntries(searchParams)` keeps only the LAST value, so a filter that sends
 * `?status=A&status=B` reads back as a single status and a working filter looks broken.
 */
const paramsOf = (url) => {
  const out = {};
  for (const [k, v] of new URL(url).searchParams) (out[k] = out[k] || []).push(v);
  return out;
};

/**
 * The raw query STRING, `?a=1&b=2` — not parsed.
 *
 * If you want to inspect params you want `paramsOf`. Running `Object.entries` over this iterates
 * CHARACTERS, so a loop like
 *
 *   for (const [k, v] of Object.entries(queryOf(url))) if (k.startsWith('filter')) …
 *
 * never matches anything and the check passes without inspecting a thing — a green line reporting
 * a verification that never happened. That shipped in a real verifier.
 */
const queryOf = (url) => new URL(url).search;

/** Wait until at least `n` entries land, or give up — never hang a run. */
const waitForCount = async (arr, n = 1, timeout = 10000) => {
  const started = Date.now();
  while (arr.length < n && Date.now() - started < timeout) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return arr.length >= n;
};

module.exports = {
  NON_WRITE_POSTS,
  watchRequests,
  watchResponses,
  isErrorEnvelope,
  acceptedWrite,
  blockWrites,
  paramsOf,
  queryOf,
  waitForCount,
};
