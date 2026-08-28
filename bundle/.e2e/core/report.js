/**
 * PASS / FAIL / SKIP accounting and the exit code, so a verifier can gate a branch.
 *
 *   const r = createReport('FE-27 — payer editor');
 *   r.check('drawer is 480px wide', width === 480, `${width}px`);
 *   r.skip('control-company check', 'no control session available');
 *   r.finish();          // prints the tally, exits non-zero if anything failed
 *
 * A SKIP IS NOT A PASS, and it is not merely excluded from the numerator — a run in which
 * NOTHING passed exits non-zero even with zero failures. Both halves are load-bearing.
 *
 * Scar: an earlier copy of this file carried that rule in its docblock and broke it in its code —
 * `skip()` stored `{pass: true}` and the tally counted failures as `!pass`. A verifier whose every
 * check sat inside `for (const page of PAGES)` and skipped on "this tab is empty" — the ordinary
 * state of a fresh environment — printed `0/0 passed` and exited 0. The gate was green and had
 * proved nothing. The comment was a claim the code did not honour, which is worse than no comment:
 * the next reader trusts it instead of reading the tally.
 */
const createReport = (title) => {
  const results = [];

  const line = (state, name, detail) =>
    console.log(`  ${{ PASS: '✓', FAIL: '✗', SKIP: '~' }[state]}  ${name}${detail ? ` — ${detail}` : ''}`);

  const record = (state, name, detail) => {
    results.push({ state, name, detail });
    line(state, name, detail);
  };

  if (title) console.log(`\n${title}\n`);

  return {
    results,

    /** An assertion that ran. Returns the boolean so a caller can branch on it. */
    check(name, ok, detail) {
      record(ok ? 'PASS' : 'FAIL', name, detail);
      return Boolean(ok);
    },

    /**
     * A check that could not run, and why. `why` is not optional in spirit: a skip with no reason
     * is unauditable six months later, and the placeholder is meant to look wrong in the output.
     */
    skip(name, why) {
      record('SKIP', name, why || '(no reason given)');
    },

    /** True if anything failed — for deciding whether to leave test data behind, etc. */
    failed: () => results.some((r) => r.state === 'FAIL'),

    /**
     * Print the tally. Exits non-zero on any failure, or on a run that proved nothing.
     * `{exit: false}` returns the verdict instead, for a caller that owns its own exit.
     */
    finish({ exit = true, label = title || 'run' } = {}) {
      const count = (s) => results.filter((r) => r.state === s).length;
      const [passed, failures, skipped] = [count('PASS'), count('FAIL'), count('SKIP')];

      console.log(`\n${label}: ${passed} passed, ${failures} failed, ${skipped} skipped`);

      const provedNothing = passed === 0;
      if (provedNothing && !failures) {
        console.log(
          skipped
            ? '  (every check skipped — failing, because a run that proved nothing must not read as green)'
            : '  (no checks ran at all — failing, because an empty run must not read as green)',
        );
      }

      const ok = failures === 0 && !provedNothing;
      if (exit) process.exit(ok ? 0 : 1);
      return ok;
    },
  };
};

module.exports = { createReport };
