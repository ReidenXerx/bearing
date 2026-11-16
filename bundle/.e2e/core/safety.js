/**
 * The production write guard — an accident backstop for a run pointed at a backend whose writes are real.
 *
 *   const { armWrites, describeTarget } = require('../core/safety');
 *   const guard = await armWrites(context, { production: isProd, mode: 'allowlist', allow: [...] });
 *   console.log(describeTarget(BASE, isProd));
 *   // … the verifier …
 *   report.check('nothing irreversible was attempted', guard.blocked.length === 0, guard.blocked);
 *
 * Two projects wrote this on their own, and they reached OPPOSITE designs. Both were right for their
 * app, so the kit ships both and makes you choose — the choice is the point:
 *
 * - **`mode: 'allowlist'`** — every write is blocked except paths you checked AT THE BACKEND and found
 *   to only read. Choose it when one missed block is worse than a broken run: money moves, a message
 *   reaches a customer. A denylist fails open — next month's new order endpoint is not on it — so
 *   here the default must be "blocked until someone thought about it". Some reads are POSTs (a
 *   coverage check that fires on mount, a preview); those go on the list, each with why.
 * - **`mode: 'denylist'`** — DELETE and a short list of irreversible paths are blocked; ordinary
 *   saves, searches and auth go through. Choose it when blocking ordinary writes breaks the app you are
 *   verifying — the first blanket-POST block killed an OAuth token refresh and showed up as an
 *   expired session — and every irreversible action is known: merge, halt, void, submit, refund.
 *
 * Rules both projects learned:
 * - **Names lie about danger.** `POST …/test-stake` reads like a calculation and placed a real order.
 *   Check what an endpoint does in the backend before you allowlist it — never from its name or verb.
 * - **Abort, never stub.** A faked 200 lets the UI render success, and a verifier "proves" a write
 *   that never happened. (To check a write's PAYLOAD without sending it, use `blockWrites` in
 *   http.js — a different job, on purpose.)
 * - **Report both lists.** A blocked request in a read-only verifier is a finding about the verifier.
 * - **A net, not a guarantee.** It filters HTTP at the browser. A websocket message, or a GET the
 *   backend treats as a command, passes. Read it as "the obvious way to do damage is closed".
 * - **Screenshots can be the leak.** Where the data is sensitive (patients, customers, money), a shot
 *   of production is that data, and agents read shots back into transcripts and tickets. Gate them:
 *   `shotsAllowed({ production, sensitive: true })`.
 */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A string matches as a substring of the URL; a RegExp as a pattern. */
const matches = (rules, url) =>
  rules.find((r) => (r.pattern ?? r) instanceof RegExp ? (r.pattern ?? r).test(url) : url.includes(r.pattern ?? r));

/**
 * @param {import('playwright').BrowserContext} context
 * @param {{
 *   production: boolean,
 *   mode: 'allowlist' | 'denylist',
 *   allow?: Array<string | RegExp | { pattern: string | RegExp, why: string }>,
 *   deny?: Array<string | RegExp | { pattern: string | RegExp, why: string }>,
 *   allowWrites?: boolean,
 * }} opts `allowWrites` disarms it on production — pass it DELIBERATELY from a verifier that
 *   intends to write, or set ALLOW_WRITES=1; never as a default.
 * @returns {Promise<{ armed: boolean, mode: string, blocked: object[], allowed: object[] }>}
 */
async function armWrites(context, opts = {}) {
  const { production, mode, allow = [], deny = [] } = opts;
  if (mode !== 'allowlist' && mode !== 'denylist') {
    // No default on purpose: which mistake you can afford is the decision this file exists to force.
    throw new Error("armWrites: pass mode: 'allowlist' (a missed block is worse than a broken run) or 'denylist' (blocking ordinary writes breaks the app)");
  }
  if (typeof production !== 'boolean') throw new Error('armWrites: pass production: true|false — guessing it is how a run lands on prod');
  const allowWrites = opts.allowWrites ?? process.env.ALLOW_WRITES === '1';
  const state = { armed: production && !allowWrites, mode, blocked: [], allowed: [] };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method();
    if (!WRITES.has(method)) return route.continue();
    const url = req.url();
    if (!state.armed) {
      state.allowed.push({ method, url, why: production ? 'ALLOW_WRITES' : 'not production' });
      return route.continue();
    }
    let block;
    let why;
    if (mode === 'allowlist') {
      const hit = matches(allow, url);
      block = !hit;
      why = hit ? hit.why ?? 'allowlisted' : 'not on the allowlist';
    } else {
      const hit = method === 'DELETE' ? { why: 'DELETE' } : matches(deny, url);
      block = Boolean(hit);
      why = hit ? hit.why ?? 'denylisted' : 'not irreversible';
    }
    if (block) {
      state.blocked.push({ method, url, why });
      return route.abort('blockedbyclient');
    }
    state.allowed.push({ method, url, why });
    return route.continue();
  });
  return state;
}

/** One line for the top of every report. Says PRODUCTION loudly: "worked locally" and "worked on prod" are different claims. */
function describeTarget(base, production) {
  return production ? `${base} 🔴 PRODUCTION — writes guarded (ALLOW_WRITES=1 to disarm)` : `${base} (not production)`;
}

/** Screenshots of sensitive production data are that data. Off unless ALLOW_SENSITIVE_SHOTS=1. */
function shotsAllowed({ production, sensitive }) {
  return !(production && sensitive) || process.env.ALLOW_SENSITIVE_SHOTS === '1';
}

module.exports = { armWrites, describeTarget, shotsAllowed };
