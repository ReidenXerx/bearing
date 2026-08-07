# North-stars — bearing

**This file is AUTHORITATIVE.** It outranks every other doc, comment, and any agent's own inference.
When a source conflicts with a north-star, **the north-star wins and that source is stale** — say so
rather than silently averaging the two.

**Cite the `NS-#`** when you make a consequential claim, choose a direction, or reject an idea. If
you can't cite one for a load-bearing conclusion, **say you may be drifting**. Never edit this file
silently — propose the change.

---

## Invariants — must always hold

- **NS-1** — **This code runs inside other people's repositories.** Every `writeFileSync`, `rmSync`, `unlinkSync` and `renameSync` acts on work someone else cannot get back. Before any of them, ask: what if this runs twice, what if it half-fails, what if the target already exists, and what if the user put that file there? Uninstall once deleted the user's north-stars because `.bearing/` *looked* kit-owned.
- **NS-2** — **A core module may NEVER depend on a feature module.** Features are independently installable, so a core→feature edge breaks core whenever that feature is absent. The invariant is COMPUTED (`coreLibClosure()`), not hand-maintained — it silently broke twice as a list. The closure must follow static imports, dynamic `import()`, **and child-process spawns**, while ignoring JSDoc type references.
- **NS-3** — **Install and update must be idempotent.** Running either twice, or install-then-update, must converge: one gitignore block, one hook registration per event, no duplicated scripts. Anything that accumulates is a defect.
- **NS-4** — **Migration runs BEFORE the bundle copy.** Any migration step that inspects the TARGET for something the copy step provides is a no-op on first run. Check the BUNDLE instead. This shipped once and required two updates to take effect.
- **NS-5** — **A false deny is worse than a missed gate.** Blocking legitimate work — with advice the user cannot follow — destroys trust faster than letting one grep through. When a guard is unsure, allow.
- **NS-6** — **Every block must have a discoverable exit.** `bearing:fallback` and `mode: guide` are named in deny messages for this reason. Enforcement that cannot be escaped is a trap.
- **NS-7** — **Hooks run on every tool call.** Nothing on that path may read a whole file, spawn unnecessarily, or block without a bound. Prefer a bounded scan that stops early over a correct-but-linear one.
- **NS-8** — **Fail open on the hot path, fail closed on the graph.** An unreadable file, malformed JSON or missing stdin must never block the developer; a stale or missing index must never be reported as fresh.

## Evidence — what counts as proof here

- **NS-9** — **A passing test proves nothing until it can fail.** Four defects shipped underneath green tests: a vacuous assertion (a path that could not exist post-rename), a convenient fixture (the replacement pre-created, hiding an ordering bug), a wrong harness shape (`tool_name` vs `tool`, silently hitting an empty-input branch), and a "runs without crashing" check blind to silent degradation. **Revert the fix and watch the test fail** before believing it.
- **NS-10** — **Verify by executing, not by reading.** Every real defect this project has found came from running the thing — a real install, a real upgrade with real data, a rasterized SVG, a packed tarball installed as a consumer. Reading the code found none of them.
- **NS-11** — **An unexpected result is a finding, not a nuisance.** Twice a "fix" changed output in a way I nearly rationalised: the core closure gaining `classify.mjs` (a JSDoc false positive) and a shell gate that went quiet (a `ReferenceError` swallowed into blanket allow). If output moves in a way you did not predict, stop.
- **NS-12** — **Test the negative case.** A gate is only proven by asserting that something IS denied. The shell gate opened completely and every allow-assertion still passed.
- **NS-20** — **Every line the installer prints is a CLAIM, and an unchecked claim is a lie waiting to happen.** Nine defects reached a real machine in one session and the existing verifier caught zero, because it asks "does this file exist" and every one of them had the right files with the wrong CONTENT. Three printed success while broken: the macOS service announced `listening on 127.0.0.1:39100` for an agent crash-looping on exit 127, the CLI exited 0 having installed nothing when its path crossed a symlink, and all 16 npm scripts silently reverted to `npx gitnexus@latest` after the installer had just written the operator's choice. **Presence is not correctness.** Assert post-conditions against the disk (`lib/postcheck.mjs`), never behind `--skip-verify` — that flag exists to skip the slow index build, and every automated path passes it, which is exactly how these shipped. A failed check must change the headline and the exit code, not sit above a green "Install complete".
- **NS-21** — **The least-exercised configuration is the least verified, and that is backwards.** `scripts/bearing-verify.mjs` and its fallback lib are both owned by the gitnexus feature, so an intel-only install — the configuration the author never runs — had no verification at all. Checks that must hold for every install belong in `lib/`, outside the feature axis.

## Settled — decided; do not relitigate

- **NS-13** — **GitNexus is one module, not the product.** The intel layers (north-stars, task-core, microscope) have no GitNexus dependency and must keep working without it. Never let enforcement leak into a repo that declined the module — not via files, hook registration, npm scripts, or `.mcp.json`. All four channels re-introduced it once.
- **NS-14** — **Only Claude Code and Cursor can enforce.** Enforcement needs tool-interception hooks. Zed and Codex get the contract, and the README says so plainly — overstating parity is the fastest way to lose a first-time user.
- **NS-15** — **Legacy names stay as aliases.** Renaming broke nothing because every `gitnexus:*` script still resolves; user-owned git hooks invoke them BY NAME. Any future rename carries the same obligation.
- **NS-16** — **The product is described in three places** — `package.json` (npm), `README.md` (GitHub), and the GitHub About box — and nothing keeps them aligned. A test enforces the first two against the code; `npm run sync:meta` pushes the third. They drifted for real.
- **NS-17** — **npm renders neither mermaid nor relative-path assurances.** Diagrams are generated SVG served over absolute raw URLs (`npm run gen:diagrams`). Do not reintroduce mermaid into the README.

## Open

- **NS-18** — Concurrent hooks lose counter updates (~15%): two PostToolUse hooks per tool call do unlocked read-modify-write. Writes are atomic so nothing corrupts, and the only symptom is the anchor firing slightly late. Not worth locking yet — revisit if the anchor visibly misses.
- **NS-19** — Context-pressure reports "unknown" (treated as not-full) past a 32MB tail scan. Bounded on purpose, but the failure is silent and correlates with the window actually filling.
