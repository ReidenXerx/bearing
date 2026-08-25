/**
 * Behavioural tests for the shipped guard core (`bundle/.bearing/lib/classify.mjs`).
 *
 * `kit.test.mjs` asserts that this file SHIPS; nothing asserted what it DOES.
 * The two behaviours pinned here are both ones where a wrong answer is worse
 * than no answer:
 *
 *   1. A blocked compound command must say that NOTHING ran. A deny naming only
 *      the flagged step reads as "the earlier parts succeeded", and the agent
 *      reports edits that never happened.
 *   2. A grep already scoped to ONE file must be allowed. Redirecting it hands
 *      the agent a tool that answers nothing, with no way forward.
 *
 * These import the bundle source directly rather than installing into a scratch
 * repo: the logic is pure (verdict in, verdict out), so the install round-trip
 * would add minutes and test the installer, which `kit.test.mjs` already covers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFY = pathToFileURL(
  path.join(HERE, "..", "bundle", ".bearing", "lib", "classify.mjs"),
).href;
const { classifyShell, classifyGrep } = await import(CLASSIFY);
const { loadHookConfig } = await import(
  pathToFileURL(path.join(HERE, "../bundle/.bearing/lib/hook-helpers.mjs")).href
);

/** must_refresh drives the stale-search branch, which is where the notice rides. */
const staleCtx = {
  phase: "must_refresh",
  staleMustRefreshMsg: "STALE: refresh the graph first.",
  config: { mode: "strict" },
};

const NOTICE = "NOTHING IN THIS COMMAND RAN";

/** Must be a code search or the guard allows it outright and emits no notice. */
const SEARCH = 'grep -rn "someField" src/server/x.js';

describe("compound-command notice", () => {
  it("fires on a heredoc followed by a command on the next line", () => {
    // The reported incident, verbatim in structure: no &&, no ||, no ;.
    // A regex over operators alone is silent here — which is how five edits
    // were reported as applied when nothing had run.
    const command = [
      "python3 - <<'PY'",
      "print('rewrites 5 call sites')",
      "PY",
      SEARCH,
    ].join("\n");
    const v = classifyShell({ command }, staleCtx);
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes(NOTICE), "newline-separated must warn");
  });

  it("fires on &&, || and ; shapes", () => {
    for (const command of [
      `npm run build && ${SEARCH}`,
      `false || ${SEARCH}`,
      `echo staged; ${SEARCH}`,
    ]) {
      const v = classifyShell({ command }, staleCtx);
      assert.equal(v.decision, "deny");
      assert.ok(v.agentMessage.includes(NOTICE), `must warn: ${command}`);
    }
  });

  it("stays silent on a single-step command", () => {
    const v = classifyShell({ command: SEARCH }, staleCtx);
    assert.equal(v.decision, "deny");
    assert.ok(
      !v.agentMessage.includes(NOTICE),
      "a one-step command has no earlier steps to have lost",
    );
  });

  it("treats a backslash line-continuation as one step", () => {
    // `foo \<newline> --bar` is a single command; warning here would tell the
    // operator that work was lost when none was.
    const command = 'grep -rn "someField" \\\n  src/server/x.js';
    const v = classifyShell({ command }, staleCtx);
    assert.equal(v.decision, "deny");
    assert.ok(
      !v.agentMessage.includes(NOTICE),
      "line continuation is not a separator",
    );
  });

  it("excludes a line-continuation on CRLF too", () => {
    // On CRLF the byte before the `\n` is the `\r`, not the backslash, so a single
    // negative lookbehind lets it through and the exclusion silently fails — on the
    // one platform where nobody here would notice it had.
    const command = 'grep -rn "someField" \\\r\n  src/server/x.js';
    const v = classifyShell({ command }, staleCtx);
    assert.equal(v.decision, "deny");
    assert.ok(
      !v.agentMessage.includes(NOTICE),
      "a CRLF line continuation is still one step",
    );
  });

  it("still warns on a genuine CRLF two-step command", () => {
    // ...without the CRLF exclusion swallowing real multi-step commands.
    const command = 'python3 edit.py\r\ngrep -rn "someField" src/server/x.js';
    const v = classifyShell({ command }, staleCtx);
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes(NOTICE), "CRLF separates steps");
  });
});

describe("scope-based grep allows", () => {
  // `isSourceCodePath` reads `sourceExtRe` + `sourcePathRes`; without them the
  // classifier throws rather than deciding, so a stub config would test nothing.
  const freshCtx = {
    phase: "fresh",
    repo: "demo",
    root: "/repo",
    graphUsed: false,
    config: {
      mode: "strict",
      sourceExtRe: /\.(m?[jt]sx?)$/i,
      sourcePathRes: [/^src\//],
    },
  };

  it("allows a grep already scoped to ONE file", () => {
    // "Is this string in this file" is not a graph question, and it is the exact
    // inverse of the broad sweep the gate exists to catch. Redirecting it sends
    // the agent to a tool that returns nothing for it.
    const v = classifyGrep(
      {
        tool: "Grep",
        toolInput: { pattern: "runBacktest", path: "src/core/replayEngine.js" },
      },
      freshCtx,
    );
    assert.equal(v.decision, "allow");
  });

  it("still denies the same symbol unscoped", () => {
    // The teeth. Without this, the allow above could widen silently into
    // "greps are fine", which is the behaviour the gate exists to prevent.
    const v = classifyGrep(
      { tool: "Grep", toolInput: { pattern: "runBacktest" } },
      freshCtx,
    );
    assert.equal(v.decision, "deny");
  });
});

describe("searches the graph cannot answer", () => {
  // Found by being blocked from reading a dependency's source while doing exactly that. The deny
  // redirected to `context({name, repo})` — and dependencies are not in the graph, so the suggested
  // exit returns nothing. Verified on this repo's own index:
  //   MATCH (n:File) WHERE n.filePath CONTAINS 'node_modules' RETURN count(n)  ->  0
  // A false deny is worse than a missed gate (NS-5), and a block whose exit does not exist is the
  // trap NS-6 forbids.
  // The real compiled config — `isSourceCodePath` reads `sourceExtRe` / `sourcePathRes`, which
  // `loadHookConfig` always seeds. A hand-built `{mode:"strict"}` throws instead of classifying,
  // and the allow-cases below would still have passed, because the unindexed check returns first.
  const fresh = {
    phase: "fresh",
    config: loadHookConfig("/repo"),
    repo: "r",
    root: "/repo",
    graphUsed: true,
  };

  it("allows a symbol search in a path the index never contained", () => {
    for (const cmd of [
      'grep -rl "generate_map" node_modules/gitnexus/dist',
      'grep -rn "someSymbol" /usr/local/lib/node_modules/pkg/dist',
      'grep -rn "someSymbol" vendor/lib',
      'grep -rn "someSymbol" /somewhere/else/entirely',
    ]) {
      assert.equal(
        classifyShell({ command: cmd }, fresh).decision,
        "allow",
        `redirected a search the graph cannot answer: ${cmd}`,
      );
    }
  });

  it("still denies the sweep the gate exists for", () => {
    // NS-12: the allow-cases above prove nothing unless the deny still fires. Widening
    // isNonSourcePath is exactly the change that could open the gate completely.
    assert.equal(
      classifyShell({ command: 'grep -rn "handleWebhook" src/' }, fresh).decision,
      "deny",
      "a broad symbol sweep over the repo's own source is no longer caught",
    );
  });
});

describe("the escape hatch NS-6 promises", () => {
  // `bearing:fallback` wrote its grant, printed "GRANTED for ~15 min", and did nothing on any repo
  // whose index was not fresh — the default config and the common case. The grant was evaluated
  // BELOW the staleness-gate-off branch, which returns early. Enforcement that cannot be escaped is
  // the trap NS-6 forbids, and this one announced success while staying shut (GP-8, GP-23).
  //
  // Found by RUNNING the hatch, not reading it: 207 tests passed over the broken ordering.
  const mkRoot = (grant) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bearing-hatch-"));
    fs.mkdirSync(path.join(dir, ".bearing"), { recursive: true });
    if (grant) {
      fs.writeFileSync(
        path.join(dir, ".bearing", ".gitnexus-fallback.json"),
        JSON.stringify({ at: new Date(Date.now() - 1000).toISOString(), reason: "gn wrong here", ttlMs: 900_000 }),
      );
    }
    return dir;
  };

  it("honours a grant even when the index is NOT fresh", async () => {
    // The scenario the hatch exists for is a graph that is reachable and WRONG. Staleness has
    // nothing to do with that, so a stale index must not swallow an explicit human override.
    const { evaluateStalePolicy } = await import(
      pathToFileURL(path.join(HERE, "../bundle/.bearing/lib/stale-policy.mjs")).href
    );
    const p = evaluateStalePolicy({ fresh: false }, mkRoot(true));
    assert.equal(p.phase, "classical_fallback", "a stale index still swallows the escape hatch");
    assert.equal(p.allowClassical, true);
  });

  it("re-arms enforcement once the grant is gone", async () => {
    // NS-12: the allow above proves nothing unless the deny comes back. A hatch that never closes
    // is not an escape hatch, it is an uninstall.
    const { evaluateStalePolicy } = await import(
      pathToFileURL(path.join(HERE, "../bundle/.bearing/lib/stale-policy.mjs")).href
    );
    const p = evaluateStalePolicy({ fresh: true }, mkRoot(false));
    assert.notEqual(p.phase, "classical_fallback", "enforcement never comes back");
    assert.equal(p.allowClassical, false);
  });
});
