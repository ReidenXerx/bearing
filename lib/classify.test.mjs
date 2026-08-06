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
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFY = pathToFileURL(
  path.join(HERE, "..", "bundle", ".bearing", "lib", "classify.mjs"),
).href;
const { classifyShell, classifyGrep } = await import(CLASSIFY);

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
