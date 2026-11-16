# 🎭 E2E harness

Opt-in: it is the one module off by default, because it writes a new top-level `.e2e/` and wants a
Playwright download. `--features …,e2e`, or pick it in the wizard.

Not a test framework — Playwright is the capability, and your agent already has it. What it ships is
the **shape and the scars**: a report whose exit code is the product, polling waits instead of
sleeps, request readers that assert on the *body* because a 2xx can carry an error envelope, and
`blockWrites` — intercept a mutation, capture the payload, fulfil it locally, so "does this button
send the right thing" stops being an irreversible experiment.

Screenshots are keyed by *what they are of*, not by filename. The next capture of a view replaces
it, so a directory of shots is always current and never accumulates `editor-final-2.png`. It
catalogues itself.

The harness is meant to **grow**. When a verifier hits something the kit handled badly, the agent
appends it to the scars list and fixes it at the next milestone — not mid-run, because results from
a harness that no longer exists are not results.

Every scar in the shipped README is one that produced a **green run over a real failure**: a skip
stored as a pass turning an all-skipped run into a pass, a URL pattern that matched the list instead
of the create, a blanket POST block that severed the session and made a working feature look missing.

It also records **narrated demo videos** — voice, captions, a visible cursor, a sample-data badge, nothing written — and reviews them before anyone sees one.

---

[← back to the README](../../README.md)
