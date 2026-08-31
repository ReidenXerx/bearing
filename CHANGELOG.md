# Changelog

All notable changes to `bearing` are documented here.

## 1.1.6 — a seventh module, and the fixes that were sitting above npm

### Added — E2E harness (`--features e2e`, off by default)

A browser harness the project finishes. Working substrate — a report whose exit code is the
product, polling waits, request/response readers, screenshots keyed by view and self-cataloguing —
plus one contract stub, because how an app holds a session is the one genuinely app-specific piece.
`blockWrites` intercepts a mutation, captures the payload and fulfils it locally, so a destructive
button can be verified without pressing it.

What it really ships is the scars, each of which produced a green run over a real failure: a skip
stored as a pass turning an all-skipped run into a pass, a URL pattern that matched the list
instead of the create, a 2xx carrying an error envelope, a blanket POST block that severed the
session and made a working feature look missing.

The first module that is off by default — it writes a top-level `.e2e/` and wants a Playwright
download, which is not something a repo should get for pressing Enter. `Enter` in the wizard now
means the recommended set and says so; `"all"` still means all.

### Fixed — an update no longer deletes the practices a project wrote

`.bearing/gold-practices.md` was copied wholesale on every update. That was deliberate — bearing
owning it is what makes a corrected rule reach every repo — and its header duly pointed project
rules at `.bearing/northstars.md`. Agents ignored that, and they were right to: a lesson learned
while working is a PRACTICE, not a statement about what the project is, so gold-practices.md is
exactly where it belongs. One repo had accumulated fourteen. Every one was a single `bearing update`
from being deleted, silently, by a command that then reported success.

The file is now two: a marked block bearing rewrites, and everything below it, which bearing never
touches — the same mechanism already used for `.gitignore`, `CLAUDE.md` and `.prettierignore`. The
first update after this migrates automatically, carrying existing project rules below the marker and
renumbering them `PP-#`. That prefix matters: one repo's agent wrote a `GP-24` while bearing was
independently shipping a different `GP-24`, and a citation that still resolves but now means
something else is worse than one that dangles.

### Added — bearing offers the new module, and sets it up

Reading a notice, retyping a command, then running two more to make the thing work is four steps to
try one module, which is how an opt-in module stays permanently un-tried. On a terminal the update
now OFFERS it, and offers to install its dependencies — two questions, both disclosing what they
do, both defaulting to no. A closed stdin or a non-interactive run prompts for nothing and prints
the commands instead, and an existing setup is never offered again.

### Added — `--features +e2e` on update, and a notice when a module is new

Adding one module used to mean retyping the other six, where a forgotten name silently uninstalled
it. Signed tokens are now a delta: `+e2e`, `-minions`. And because `update` correctly inherits the
recorded feature set, a new module could never appear on its own and nothing announced it — the
update that crosses a module's introducing version now names it once.

## 1.1.5 — the instructions were teaching things that could not be done

Most of this release is one class of defect, found by running what the docs say instead of reading
it. Every fix below sat behind a check that passed: the file existed, the name resolved, the suite
was green.

### Fixed — `bearing:fallback` granted nothing on any repo behind HEAD

The escape hatch named in every deny message, in the contract, and in the stale-refresh hint wrote
its grant, printed **"Classical fallback GRANTED for ~15 min"**, and the guard never read it.
`evaluateStalePolicy` returned early at the staleness-gate-off branch — the default configuration —
before the grant was consulted, so the hatch worked only on a perfectly fresh index while the
contract advertises it for *"GitNexus fresh but WRONG"*. An explicit human override is now evaluated
before every automatic phase decision. Enforcement that cannot be escaped is a trap (NS-6), and this
one announced success while staying shut.

### Fixed — every `READ bearing://...` was a call that could not succeed

92 occurrences across 33 files: every skill that told an agent to read a process trace, a cluster
map, the graph schema or the repo context, plus the always-on contract, both generated templates and
the Cursor rules. The scheme belongs to GitNexus's MCP server — `bearing://repo/x/schema` answers
*"Unknown resource URI"*, `gitnexus://` returns the schema. Almost certainly the gn-kit → bearing
rename sweeping up a URI scheme that was never bearing's to rename.

### Fixed — a field `rename` never returns, and other unrunnable instructions

`bearing-refactoring` told you to review the `ast_search` edits; the tool tags them `text_search`. An
agent searching for a value that never appears finds none and concludes every edit resolved through
the graph, which is how a regex find-and-replace gets accepted as safe. Also: a Cypher query that is
a parser error, three skills answering "index is stale" with a refresh that leaves it stale, two
skills pointing at an api-profile path that moved, the master index pointing at a directory
migration deletes, and a copied `gitnexus wiki` flag table that had already drifted.

### Fixed — `bearing:stats` crashed, and half the counters were invisible before it did

`labelFor` was a local const in the scorecard and `stats` called it anyway — ReferenceError on every
run. Two `labels` maps had drifted, fourteen keys against seven, and stats filtered by its own copy,
so seven counters were written every session and shown to nobody. One map at module scope; both
readers derive keys from what was counted.

### Fixed — the guard denied searches the graph cannot answer

Searching `node_modules/` was blocked with a redirect to `context({name})` — and dependencies are
not indexed, so the suggested exit returned nothing. A false deny whose escape does not exist
(NS-5, NS-6). Paths the index never contained are now allowed.

### Changed — the always-on contract is 17% smaller, and says the same things

It stated "which tool when" six times: a task-type table, a layered table, a bare ordering, a
tool-surface table, an MCP-defaults table, and the Gates ladder. `check` and `tool_map` each appeared
twice inside one table. Every MCP tool already ships its own WHEN TO USE in a schema that loads
anyway, so the surface is now one line and the file keeps what nothing else carries: where each tool
is silently wrong. ~1,740 tokens off every session, permanently.

The 25 skills lost 13% the same way — nine wrote the workflow twice, eleven opened by arguing for
being loaded, five taught the same tools three times. The uncertainty rule that was hand-copied into
17 of them now renders from one source with a test that fails on drift.

### Fixed — the recovery brief said READ THE TASK-CORE and never said how much of it

An agent recovering from a compaction pages large files with `offset`/`limit` — a habit the contract
itself teaches, correctly, for source. Applied to the task-core it destroys the thing: one screen,
every line kept because deleting it would cost you work, and no way to know which line that is until
you have read it. A partial read is the file's own failure mode wearing the costume of recovery.

The SessionStart(compact) brief and the skill now both say it plainly: read it WHOLE, no offset, no
limit, no skim.

### Added — GP-22 and GP-23

**GP-22** — declining to answer is the cheapest possible answer, so any comparison by cost ranks it
first. **GP-23** — verify the exit condition, not that the remedy ran. GP-23 was written in the
morning and caught `bearing:fallback` that afternoon.

### Added — the installer offers to keep Prettier off the files bearing owns

An install puts ~90 tracked, formattable files into a repo — `.bearing/lib/` alone is 31 `.mjs`
modules — and every one of them is bearing's, replaced wholesale on the next update. In a repo that
formats on commit the two tools take turns: Prettier reformats all 90, `bearing update` overwrites
them back, and the diff returns every cycle. Neither is wrong. They simply both claim the file.

The installer now detects Prettier — `.prettierrc*` in any of its eight extensions,
`prettier.config.*`, a `prettier` key or dependency in `package.json`, or a lone `.prettierignore`
— and **asks**, quoting the evidence back rather than asserting it. Saying nothing means no:
`.prettierignore` is the repo's own configuration and editing it uninvited is exactly what bearing
does not do. `--prettierignore` / `--no-prettierignore` answer it without a TTY.

Scope is what bearing **wholly owns**. `CLAUDE.md` and `AGENTS.md` are deliberately absent — bearing
owns a marked block inside them, not the file, and silently exempting someone's own prose from their
own formatter is not ours to do. That block is rewritten on update anyway, so the churn self-heals
in one file rather than ninety.

The pattern list is written by hand, because a `.prettierignore` nobody can read is a worse artifact
than one that is slightly redundant. It is kept honest by a test that does a **real install** for
every runtime and fails if any formattable file left on disk is matched by no pattern.

That test walked the *bundle* first, and was green while three gaps sat in plain sight — because
`.zed/settings.json`, `.mcp.json` and `.cursor/mcp.json` are written by ADAPTERS rather than copied
from `bundle/`, so a bundle walk could not see them at all. A probe blind to a whole category of
output reports success in exactly the shape of real coverage. It took installing into a scratch repo
and running Prettier by hand to find them, which is the whole of `GP-1`.

One more thing that surfaced the same way: bearing writes `.claude/skills/generated/` and
`.claude/skills/gitnexus/` during setup **even on a zed-only install**, so the skill farms are
exempted regardless of the runtime that nominally owns them.

**Stealth refuses it**, through the same channel that already reports skipped Codex and Zed wiring.
Stealth's promise is that `git status` is exactly as clean afterwards, and `.prettierignore` is
tracked — or, if absent, visibly untracked the moment it is created. Either way the promise breaks,
so the offer is withdrawn and explained instead of quietly taken.

Reversible in both directions: the answer is recorded, an update refreshes the block rather than
appending a second one, `--no-prettierignore` takes it back out, and uninstall deletes the file only
when bearing created it. A rule you append after the block survives all of it — the block is
sentinel-terminated for the same reason `.gitignore`'s is.

## 1.1.4 — a refresh that rewrites, and the last check that was guessing

### Changed — a task-core refresh REPLACES; it does not append

The nudge fires every N edits and says *refresh*. The skill covered what to **include** when writing
one and how to **read** it on recovery, and said nothing about what a refresh **removes** — so the
file only ever grew and became the thing it exists to replace: a transcript, with the same burial of
load-bearing detail in narrative, at the same cost in context.

One test per line now, applied on every refresh:

> **If I deleted this line, would a future me redo work or repeat a mistake?**

Drop finished steps whose outcome is now in the code, resolved OPEN-Qs, gotchas about code that no
longer exists, anchors to files you are done with, a DONE list that has become a changelog.
**Git already keeps the log** — dated, searchable, permanent — so a core duplicating it pays context
for a worse copy. A healthy core stays roughly the same SIZE across refreshes; monotonic growth
means it is being appended to. The nudge itself now says `REWRITE it rather than appending`.

### Added — the task-core's age, at the moment it is trusted

The SessionStart brief tells the agent to **read the task-core first and reconstruct from it**, so a
cold core is not merely unhelpful — it is read and believed. On compaction or resume:

```
READ your TASK-CORE FIRST — <path> (last written 9 days ago — VERIFY its anchors before acting)
```

Silent under two days, where the answer is "it is current" and a number would be noise.

### Fixed — doctor never asked the endpoint it wrote down

bearing records the transport it configured — `{mode:"http", url:"http://127.0.0.1:39100/mcp"}` —
and nothing ever asked that URL a question. Every other check probes the CLI and the registry, which
live in a **different process** from the shared server the editor talks to. So with the server down,
doctor reported everything green and signed off with *"If MCP tools still fail, restart your
editor"* — advice that cannot work, because restarting an editor does not start a launchd service.

```
✗ MCP endpoint answering: http://127.0.0.1:39100 is not answering — every MCP tool will fail
  until it is back, and restarting your editor will NOT help.
  Start it: launchctl kickstart -k gui/$(id -u)/dev.bearing.gitnexus-mcp
```

Returns nothing rather than a passing check for `stdio` installs, which spawn per client and have no
endpoint to probe.

### Changed — install and update warn when the diff lands on a non-default branch

1.1.3 added a Branch line to the summary. Passive display was not enough — that line was already
there when a kit update landed on an active feature branch the following day. A line you do not read
is a line that does not exist, so it now compares against `origin/HEAD` and says so:

```
! Branch  payers-v2 — NOT main; this diff lands here
```

### Fixed — two instructions still naming a trigger 1.0.13 retired

The session brief told the agent to write its task-core *"when context fills"*, and the Claude
adapter's comment still described the nudge hook as estimating context fullness. The context window
is not knowable at runtime, which is why that trigger was replaced by counting unsaved edits.

## 1.1.3 — bearing stops guessing which editor you use, and stops hiding when it guessed wrong

Every fix here came from one user's install reports. All of them are the same shape: bearing knew
something, did not say it, and an agent drew the wrong conclusion from the silence.

### Fixed — installs no longer pick an editor in silence

The default runtime for a fresh install was `both`, which means **cursor+zed and covers Claude Code
not at all**. A user installed for zed, worked in Claude Code, and their agent reported `microscope`
and `consult` as *"not available in Claude Code"* — **correctly**, because a zed-only install writes
`.agents/skills/` and `AGENTS.md` and no `.claude/` anything. Two modules looked broken; one runtime
was wrong. Nobody was ever asked.

The evidence was there the whole time. `CLAUDECODE=1` is exported into every Claude Code shell —
that is the editor announcing itself, not inference — and a repo's own `.cursor/` or `.zed/` records
which editors have opened it. An install with no `--runtime` now uses it:

```
✓ Runtime: claude — detected: running inside Claude Code
  Not right? Re-run with --runtime cursor|zed|claude|codex|all
```

On a TTY with no signal it **asks** — the picker already existed and was reachable only through
`--interactive`, the flag this removes the need for. With no signal and no TTY it says what it fell
back to instead of sneaking. An explicit `--runtime` always wins; detection never overrides it, and
returns nothing rather than a guess when there is no evidence.

### Added — verify tells you when you are running an agent the install does not cover

For anyone already in that position:

```
✗ Install covers the agent you are running
  you are running Claude Code, but this install is "zed" — so .claude/skills, .claude/hooks
  and CLAUDE.md were never written. Modules delivered only by a skill (microscope, consult)
  will look unavailable. Fix: npx bearing update . --runtime zed,claude
```

Settled along the way, with a controlled A/B of a real directory against a symlinked one:
**Claude Code does follow symlinks for skill discovery.** The skill farm is fine and needed no
change — that had been the leading suspect, and it is eliminated by evidence rather than argument.

### Fixed — `bearing update` refused to update the repo you were standing in

```
~/Projects/some-repo (dev) $ npx bearing update
Missing target repo path. Use: install <path> or install --interactive
```

Two failures in one line, in a repo that HAD bearing installed. `update` with no argument means
this repo. And the guidance named `install` to someone who typed `update`. Now: inside an install it
updates it; in a directory with installs beneath it, it lists them and offers `update-all .`;
nowhere near one, it says so and names the directory it searched. `uninstall` follows the same rule.

### Fixed — `bearing:agent-refresh` exited 1 on every run of a zed install

```
Missing rule: .cursor/rules/00-bearing-enforcement.mdc
```

The index refreshed fine, then the run died verifying a Cursor file the repo was never given.
`RUNTIME="${GITNEXUS_RUNTIME:-both}"`, and that variable is exported by `bearing-setup.sh` and
nothing else — so every other caller silently got Cursor checks. It now reads the runtime already
recorded in `.bearing/manifest.json`.

**And the class behind it.** Everything after the index refresh ran under a helper that throws, so a
failure in a cosmetic post-step was reported as `agent-refresh failed (ENOSPC or command error)`
with exit 1 — by which point the graph was already fresh. Since `bearing:agent-status` tells the
agent to run that command autonomously, exit 1 reads as an unusable graph and can stop work that
was never broken. Now:

```
==> Teaching sync exited 1. THE INDEX IS REFRESHED and the graph is usable —
    this step only re-links skills and rule files. Continuing.
```

### Changed — smaller things from the same reports

- **`bearing:health` offered a Cursor guide to people not running Cursor.** `docs/GITNEXUS-CURSOR-GUIDE.md`
  opens *"for anyone using Cursor Agent"*; it is now shown only when the install includes cursor.
- **Install and update say which BRANCH they wrote to.** An update writes ~60 files and reported
  only the path, which looks identical on every branch — so the diff can land on in-progress work
  with nothing to distinguish it.
- **The 1.1.2 hooks-comment repair no longer reformats the file around it**, and its staleness test
  is derived rather than hardcoded: a stale comment is one that references something the current
  comment does not. A key retired in a future release is caught by that rule and could never have
  been caught by a list.

## 1.1.2 — a file we never overwrite carried instructions we could never correct

### Added — verify reports which modules are actually reachable

A second report from the same install: the agent's own status table listed `microscope` and
`consult` as **"not available in Claude Code"**. Both are supported there, and both were installed.

They are the only two modules delivered by a **skill and nothing else** — `northstars` has npm
scripts, `taskcore` a hook, `gitnexus` the MCP tools and 34 scripts. So when the agent could not see
their skills, it concluded the modules did not exist for its runtime, and **nothing in bearing could
contradict it**: no check reported what each module ships or whether that shipment arrived. The
agent had to guess, and guessed wrong in the direction that quietly costs you two modules.

`bearing:verify` now answers it authoritatively:

```
✓ Modules reachable   6 module(s) installed, every skill readable
✗ Modules reachable   microscope (not readable at .claude/skills/bearing-microscope) — the module
  is recorded as installed but its skill cannot be read, so an agent will report it as unavailable
```

It checks the canonical store AND the per-runtime directory the host actually reads, for every
runtime the install claims — so "installed" and "reachable" can no longer quietly disagree.

Note for anyone upgrading from **1.0.12 or earlier**: `consult` did not exist then. It was added in
1.0.13, which was never published to npm, so the first published release containing it is 1.1.0. If
your agent reports consult as missing on an old install, `npx bearing update .` is the fix.

### Fixed — hooks.json documented a config path that nothing reads

Reported from a fresh install. `.bearing/hooks.json`'s own comment told the reader that per-machine
overrides belong in:

```
.gnkit/gitnexus-hooks.local.json
```

The code reads `.bearing/hooks.local.json`. **Following the instruction creates a file nothing
reads** — it fails silently, which is the worst way a config override can fail: no error, no
warning, and settings that appear to be in place.

That path is two renames old (`.gitnexus/agent-kit/` → `.gnkit/` → `.bearing/`), and the bundle's
copy was corrected long ago. The correction could never arrive, because **`.bearing/hooks.json` is
seed-once** — written at install and never overwritten, since it is team-shared config a user edits
and an update must not clobber. That rule protects their *settings*. It was also freezing our
*documentation*, and nothing had noticed.

Same vintage, second defect: the comment's worked example is `"contextWindowTokens": 1000000`, a key
**1.0.13 retired**. Even at the corrected path it does nothing — the documentation was teaching a
no-op.

Two fixes, because there are two populations:

- **Migration repairs the comment, and only the comment.** Verified against a byte-accurate
  reproduction of the reported file: path repointed, retired example removed, and `mode`,
  `readLineThreshold` and `sourceGlobs` preserved exactly. It only rewrites prose that is
  demonstrably stale — one that names `.gnkit`, the old filename, or a retired key. A team that
  rewrote the comment for themselves has said something bearing must not overwrite.
- **`bearing:verify` names retired keys that are actually set**, across `hooks.json` and
  `hooks.local.json`:

  ```
  ✗ Hook config has no retired keys  contextWindowTokens (.bearing/hooks.json) — retired by
    NS-19, read by nothing. Remove them; the window is not measurable at runtime.
  ```

**If you hit this, `npx bearing update .` is the whole fix** — no hand-editing, and it is durable
because it is a migration rather than a manual edit that the next setup could overwrite.

The general lesson, since seed-once is used deliberately: **a file we never overwrite can carry
instructions we can never correct.** Any seed-once file that DOCUMENTS something needs a repair
path, or its documentation is write-once too.

## 1.1.1 — the tools bearing tells you to trust, measured against what they actually return

### Fixed — `api_impact` reports a live route as non-existent, and that reads as "safe to change"

Counting rather than guessing whether the graph teaching was finished: every tool the server
exposes, against how often the contract taught it. Four were **named and never taught** —
`api_impact`, `route_map`, `shape_check`, `tool_map` — against 32 mentions for `query` and 34 for
`context`. Audited against live indexes like the rest, and the route family had a false-safe in it.

All three route tools read `Route` nodes, and **route detection is framework-dependent**. On a
NestJS backend with 33 `@Controller` classes and 210 route decorators, the index held **three**
`Route` nodes — all of them URL strings scraped out of utility code (`/watch` from a YouTube helper,
`/_next/image` from an image normaliser). A second NestJS repo indexed **zero**.

```
route_map({route: "/venues"})   → "No routes matching \"/venues\""
api_impact({route: "/venues"})  → error: "No routes found matching \"/venues\"."
```

`/venues` is live. Ask *"what depends on this before I change it?"* and you are told the route does
not exist — **a not-found reads as a safe change**, on the tool whose documented purpose is
pre-change safety. The contract now says to run `MATCH (r:Route) RETURN count(*)` FIRST and compare
it against the handlers visible in source.

`shape_check` has a second precondition: it needs `responseKeys` from `.json({...})` calls, so a
framework returning objects directly produces none. Empty means *nothing was extracted*, never *the
shapes agree*.

### Added — `bearing:capabilities`, so the repo states its own limits

Five traps found this cycle are all per-repo facts the agent otherwise carries as rules. Rules
decay. Six probes now answer, for THIS repo, what a negative result from each tool means:

```
! api_impact / route_map / shape_check   0 Route nodes against 9 controllers
    → these report the API as ABSENT; a not-found is not evidence the route is unused
✓ explain — taint findings               0 taint edges, layer present
    → the layer looked and found nothing. NOT proof of safety.
```

That pair is the point: **zero findings with a healthy taint layer and zero with no layer look
identical and mean opposite things.** Also probed: embeddings, `ACCESSES`, the PDG layer, and the
three `Community` fields that are empty in every index in existence.

It also classifies circular imports. `check` reported "34 cycles" on one backend — a number that
treats a compile-time non-event and a real design smell alike:

```
6 between DI module files — force forwardRef and break initialisation order
12 between entity/type files — type-position imports, erased at compile time
2 other
```

### Added — `bearing:token-benchmark`, which can and does report losses

"How many extra tokens will I spend?" now has a measured answer: **~25,200 per session** —
~10,300 for bearing's contract, ~14,900 for the GitNexus tool schemas. 13% of a 200k window, 2.5%
of 1M. Intel-only, without the graph, is ~2,400.

The overhead means nothing without the other side, so the benchmark measures it **on your repo**:
most-called symbols, the real `impact` against each, versus `git grep` plus a 40-line window around
every hit.

```
                          summary    sites   grep+read   vs sum   vs sites
lead-sniffer (234 files)   10,505   65,645     199,737     19x       3.0x
Sourcerer-Be (709 files)    7,534   71,446     945,338    125x      13.2x
```

**`vs sites` is the honest column** — call sites against call sites. The bigger figures compare a
summary against grep's locations and flatter the graph by however much the call-site list costs.
And it reports losses: on lead-sniffer the graph loses one of eight, and prints `<- grep is cheaper
here`. A symbol with three callers IS cheaper to grep. A benchmark that can only flatter what it
benchmarks is advertising.

It also trends. The ratio is a property of the INDEX, not the repo: if the analyzer quietly stops
resolving a class of callers, `impact` gets cheaper and thinner at once — the ratio improves while
the answer degrades, and one run cannot tell those apart.

### Fixed — the doctor stopped guessing that a restart might help

Its closing line was *"If MCP tools still fail, restart your editor"* — advice offered in place of a
diagnosis. Twice in one afternoon the server WAS the problem, in two ways, neither surfaced:

- A repo deleted and removed from `~/.gitnexus/registry.json` stayed loaded in the RUNNING shared
  server. `context` failed with `LadybugDB not found` at a path that no longer existed. Registry
  edits do not reach a server that is already running.
- `npm i -g gitnexus@rc` replaced the binary while launchd kept serving the old build.

Both are now checked, and name the fix rather than the symptom.

### Changed — staleness in time, not only commits

```
Index is 260 commit(s) behind HEAD, 8 weeks of drift (indexed 1055745 → HEAD f949531)
```

A count has no scale — 236 commits reads the same whether it is an afternoon or most of a year. One
repo was 236 behind and its graph described a different era of the code, confidently.

### Fixed — the README's diagrams argued against their own captions

`drift.svg` is captioned "a north-star stops the spread", and its gate bar spanned `y=110..194`
while the fan of rays reached `y=252` — the bottom two rays sailed straight past it. The rays were
also blue, the gate's own colour, so it read as bearing emitting them rather than stopping them; and
the five green "clean" dots connected to nothing at all.

`gitnexus.svg`'s grep panel rendered as the literal string **"use0"**, eighty times. It was a grid of
two fragments — `· use.` plus a bold `O` — meant to suggest `useOrderService` hits; at 11px the O
reads as a zero. Replaced with fragments that ARE grep output.

### Fixed — bundled build output was 69% of one repo's graph

`.gitnexusignore` shipped `dist/ build/ coverage/`, none of which is where Next.js puts its output.
On one repo the indexer walked 512 minified bundle files:

```
                before     after
indexed files    1,123       873
nodes           35,322    10,900
Route nodes         21         8   (21 were ALL from bundles; 8 are all from source)
execution flows    286       538
```

Execution flows nearly **doubled**. The analyzer ranks candidate entry points against a budget and
the bundles were consuming it — indexing junk does not merely add junk, it displaces signal. Every
`Route` node in that index came from a webpack chunk, so asking where a route is handled returned a
stale minified bundle.

## 1.1.0 — teach the graph as it behaves now, and stop trusting a list you kept by hand

### Changed — the GitNexus teaching, rewritten against live indexes

The shipped teaching described a graph roughly two years out of date, and the gap was not cosmetic:
it told the agent things that were no longer true. It was rewritten by **querying real indexes** —
seven repos, up to 58k nodes — rather than by re-reading the tool documentation, because the
documentation was where several of the wrong beliefs came from.

**The type layer, which the teaching never mentioned.** `USES` and `HAS_PROPERTY` edges, and
`Property`, `Interface` and `TypeAlias` nodes. A TypeScript repo yields far more of this than the old
text assumed, so property-level questions were being answered with file-level greps.

**Edge confidence is not decoration.** ~92% of `USES` edges sit at 0.51–0.55. They are a lead to
confirm, not an answer to quote. bearing shipped the opposite claim, and this release corrects it.

**Line numbers are 0-based in raw cypher and 1-based in `query`/`context`/`impact`.** Same symbol,
two different numbers, and nothing said so.

**The escapes and envelopes nobody was using.** `impact` takes `summaryOnly`, `limit`/`offset`,
`kind`, `relationTypes`, `minConfidence`, `includeTests`. It and `context` return an
`epistemic`/`boundaries`/`causes` envelope that says *when the tool knows it is guessing low* —
`causes.receiverTyping` counts call sites the resolver dropped, so an absent caller was never proof
none exists.

**Defaults that quietly narrow the answer.** `query` returns 5, `context` 10 symbols, `impact`
excludes tests *and* `ACCESSES` unless asked. A short answer was being read as a small blast radius.

**Ambiguity is a window, not a list.** `context` on an ambiguous name returns `totalCandidates` and
`candidatesTruncated` — measured on a real repo, `candidates[]` held 20 of 36 matches. Reading
`.length` understated the truth by 44%.

**`rename` is not all graph.** On a real run 43% of its hits were regex-only — invisible to the
graph, and tagged as such on every edit. `trace` reports furthest-reachable and truncated; an absent
flow in `explain` is not proof the path does not exist.

**Three `Community` fields are always empty**, and an agent could not tell that from "this area has
no keywords". `keywords`, `description` and `label` are filled by an LLM enrichment pass the analyzer
ships and never calls — `cluster-enricher.js` is exported and imported by nothing. Measured across
three unrelated indexes (270, 543 and 1126 communities): `enrichedBy` is `heuristic` 100% of the
time, and `label` is a copy of `heuristicLabel` on every node. `cohesion` IS real and now carries a
range — 0.04 to 0.98 on one repo — so an area name alone does not tell you whether the area is a
module or a coincidence.

**Statement-level `impact`.** `mode: "pdg"` takes a `line` anchor and returns the statements that
depend on that one statement. It also **degrades silently**: a line on a blank, a comment or a brace
returns an empty slice *beside a populated `byDepth`*, which reads as "this statement affects
nothing". The `epistemic` field is the only discriminator — `pdg-intra-procedural` versus
`pdg-no-block-at-line` — and the teaching now says to read it first.

**And the caveat that governs all of it: the graph can be WRONG.** It is derived from parsing, so it
can be confidently wrong, not only silently empty. Every skill that names a graph tool now says so,
and says to confirm anything load-bearing with a classical tool and name the check that was run.

### Changed — staleness no longer blocks by default

`stalenessGate` defaults to `"off"`. A stale index degrades an answer; a gate that fires on a
threshold nobody chose stops the work outright, and the second is worse. Refresh still happens on
commit and on demand. `driftRefreshThreshold` is 8 changed source files, and the count is now
measured the same way either side of a commit — it used to jump when the same edits crossed one.

### Fixed — lists that were kept by hand, and had drifted

**Hook-lib manifests are derived from disk.** Two shell scripts listed `.bearing/lib/*.mjs` by hand
and had drifted in both directions: they still demanded `context-pressure.mjs`, retired in 1.0.13, so
`bearing update` aborted on every Cursor repo — and six libs that DO ship had never been added, so
bundles were built missing modules their own hooks import.

**313 dead symlinks were blocking the analyzer from installing its own skills.** The kit directory
was renamed twice (`.gitnexus/agent-kit/` → `.gnkit/` → `.bearing/`) and each migration moved the
content while leaving the symlinks that named the old path. `fs.mkdir(recursive)` cannot create
through a dangling symlink, so six graph skills failed to install on every analyze run, warning into
a log nobody reads. Migration now clears them — only links that are broken *and* name one of our own
retired layouts.

### Fixed — stealth installs were not stealthy, and could not update at all

Four failures, each hiding the next, all the same mistake: a step that assumed the ordinary install.

- **`package.json` was rewritten.** The installer removes bearing's npm scripts under stealth, and
  then setup put all 38 back — 75 lines into a TRACKED file, visible in `git status` to colleagues
  who have never heard of bearing. That is the one thing the mode exists to prevent, and
  `.git/info/exclude` cannot hide it.
- Setup **required files stealth deliberately does not write** — `.claude/settings.json` and
  `CLAUDE.md`, where stealth writes `settings.local.json` and `.bearing/contract.md`.
- **Cursor verification ran for a Claude-only repo**, failing on a `.cursor/` directory it is never
  given.
- **The git-hook installer chmod'd a hook stealth is not given**, killing setup under `set -e`.

Verification was wrong about those repos too: it failed them for the scripts stealth refuses to add
and prescribed a remedy that could never clear it, named three commands that do not exist there, and
reported "no symlink dirs for this runtime" on a repo with 24 linked skills.

### Fixed — smaller things

- The domain persona is inferred from the graph's own area names, not from prose alone.
- Bearing's own installed files no longer count as your uncommitted drift.
- Generated area-skills now reach teammates who do not use bearing, and the index no longer walks
  the agent layer it has no business reading.
- Deny messages, blocks and hints name a command that exists **in this repo** — a stealth install has
  no npm scripts, and every exit used to name one anyway. Refresh cost is measured and quoted
  (`~52s here last time`) instead of an adjective that was wrong by an order of magnitude.
- A postcheck false alarm: `npm run bearing:*` written in a code comment was read as a script named
  `bearing` and failed the install.


### Fixed — the runtime column in the README was a claim the installer didn't enforce

Each module declares which runtimes it supports, and **nothing read that field.** So
`--runtime cursor --features minions` installed the skill *and* wrote the fan-out trigger into
Cursor's always-on rule — telling a Cursor agent to spawn subagents on a chosen model tier, which
only Claude Code can do. Overstated parity, shipped by the installer itself (NS-14).

A module no active runtime can support is now skipped, and said out loud rather than silently
installing less than was asked for.

Two of the declarations were also simply wrong, which is why the first version of this fix deleted
north-stars from Zed. The field means **where the module delivers something**, not where its hook
runs: north-stars and task-core both ship their contract to all four runtimes, and only their hooks
are Claude-only — already gated by hook ownership. Both now declare all four, and the test asserts
north-stars survives a Zed install.

## 1.0.13 — ask about what changes the product, and stop guessing at the context window

> Documented but **never published to npm** — 1.0.12 went straight to 1.1.0.
> Everything below shipped as part of 1.1.0.

### Added — Consult, a sixth module: ask about what changes the product, decide the rest

Agents interrupt you for the wrong things and go quiet for the wrong things — permission to rename a
file, silence while they invent a business rule. Both cost the same person the same trust, and both
are judgment, not capability: the agent can already ask.

**Ask when you are about to INVENT a requirement rather than implement one.** The test that does most
of the work: *is the answer discoverable in the repo?* Code, tests, config, git history, north-stars
— then go and find it, because asking is offloading. If it exists only in your head — which of two
readings you meant, which tradeoff you prefer, what a user should see — no reading produces it, and
that is the question.

Not for what the repo answers, not for anything cheaply reversible, and never for insurance:
*"shall I proceed?"* on an obvious path is accountability handed back to you. When it does ask:
closed options, the tradeoff, a recommendation, and what it will do without an answer.

**One-way doors are a separate act — it CONFIRMS rather than consults.** Deleting data,
force-pushing, publishing, migrating anything shared. That fires because the act is irreversible,
not because the answer is unclear, so it applies even when the right answer is obvious. Reversible
work needs no permission.

And the part that compounds: **an answer that is a RULE is proposed as a north-star** — not every
answer, since an instance constrains nothing and a bloated anchor stops being read. The test is
whether a future agent, not knowing it, would do the wrong thing. Ask once, write it down, never ask
again.

Claude Code has a structured multiple-choice tool for this; Cursor and Zed get the same judgment and
ask in prose; Codex gets the contract.

### Changed — context-fullness warnings are retired; the task-core nudge counts unsaved work

**bearing no longer warns that you are near a context limit.** The window is not knowable at
runtime: the transcript does not record it, the model id does not settle it (`claude-opus-5` is the
same string on a 200k session and a 1M one), and the only real measurement — `preTokens` on a
compaction — arrives after the compaction has already happened. Two shipped attempts at inferring it
were wrong in opposite directions, one of them announcing "compaction is near" at 19.7% full. A gate
on a number that cannot be measured produces confident false alarms, which is worse than no gate.

**What replaces it: edits since the task-core was last written** (`taskCoreEveryEdits`, 25 by
default, 0 disables). The task-core exists so a long task survives compaction with its decisions
intact, and what makes that expensive is not how full the window is — it is how much has happened
that is not written down. Five edits at 95% lose almost nothing; two hundred at 30% lose a great
deal. Fullness was always a proxy for unsaved work, and one we could not measure.

The reset signal is the core file's own mtime, so there is no second counter to fall out of sync
with it. Reads and greps do not count — they change nothing a compaction could lose.

Retired with it: `contextWindowTokens`, `contextPressureThreshold`, `contextCheckpointEvery`, the
`GITNEXUS_CONTEXT_WINDOW` env override, `context-pressure.mjs`, and the periodic percentage
checkpoints. Update removes files bearing no longer ships, so the old hook goes on its own.

Stated plainly in the contract now: **nothing warns you that compaction is near** — assume it can
land at any time.

### Fixed — a stealth install told you to run five commands it had not installed

Stealth installs no npm scripts at all — that is the point, since `package.json` is tracked. The
summary told the user to run `bearing:verify`, `bearing:health`, `bearing:agent-status`,
`bearing:setup` and a gate doc anyway, and then to *"Read CLAUDE.md"* — a file stealth deliberately
never writes.

The install computed `features.has("gitnexus") && !stealth`; the summary re-derived the same fact
without the stealth half, and each adapter re-derived it again. One fact, three derivations, two
of them wrong — the same shape as the stealth uninstall defect.

The summary is now handed the value the install already computed, adapters are told too, and where
a command genuinely exists under a different name stealth gets the one that works
(`node scripts/bearing-agent.mjs verify`) rather than nothing. A test now runs a real install in
both shapes and checks every `npm run`, every `node scripts/…` and every "Read <file>" the
installer prints against what is actually on disk.

### Fixed — `--help` described four modules for a build that ships five

`--features` listed `northstars,taskcore,microscope,gitnexus`. Minions had shipped two releases
earlier. And `--stealth`, `--mcp` and `--gitnexus-cmd` were accepted by the parser but named nowhere
in the usage text — a flag nobody can discover is, for most users, a feature that does not exist.

The module list is now derived from the feature registry rather than typed out, so a sixth module
cannot leave the help describing five. Stealth and MCP each got a line explaining what they actually
do, since the flag name alone does not say.

A test now compares the flags the parser reads against the flags the help prints, in both
directions. An over-claim and an omission are the same defect (NS-20) — the help is a claim about
the program, and nothing was checking it.

### Fixed — seven dead exports, and an ENOSPC check that missed half the cases

The mirror of the unused-import sweep. Two of the seven were leftovers from the context-fullness
retirement — `setCheckpointBand` and `lastCheckpointBand` outlived the percentage checkpoints they
served — and one, `httpServerReachable`, was a dead duplicate of the TCP probe that is actually used.

One was a real gap rather than clutter. `isEnospcError` exists because a disk-full failure does not
always arrive as `error.code === "ENOSPC"` — a child that prints "no space left on device" and exits
non-zero reports it in the MESSAGE. The one call site did the bare code check, so those cases got a
generic failure instead of the "temp directory full" help written for them. It uses the helper now.

A test now fails on any export nothing references. It reads shell, JSON, markdown and YAML as well
as JavaScript: the first version of the sweep read only `.mjs` and confidently reported
`writePromptHint` as dead, when it is called from a Cursor shell hook. A checker that looks in fewer
places than the code lives in produces false positives, and a false positive here deletes a live
function.

### Fixed — five dead imports, and a check so they stop accumulating

`removeExclude` was written, exported, imported into `kit.mjs`, and never called — which is how a
stealth uninstall came to leave its own concealment in place. The import was the visible half of
that bug and nothing was looking for it.

Five more were sitting there (`substituteRepoName` ×2, `MANIFEST_PATH_LEGACY`, `skillLinkDirs`,
`STEALTH_CONTRACT_PATH`). All harmless this time — checked one by one, none was a missing call. They
are gone, and a test now fails on any new one.

An unused import is usually trivial. The reason to fail on it is that it is the cheapest available
signal that a function meant to be called is not being called.

## 1.0.12 — an uninstall that stops hiding, and a warning that stopped naming what it forbade

> **1.0.11 was tagged but never published to npm, so its changes ship here.** If you are coming from
> 1.0.10, this release contains both.


### Fixed — a stealth uninstall left bearing wired in, and hid that it had

`git status` came back clean, so the repo looked untouched. It was not: eleven guards were still
registered in `.claude/settings.local.json`, every one of them pointing at a hook script the same
uninstall had just deleted — a failed spawn on every session start, prompt and tool call.

`mergeClaudeSettings` writes to `settings.local.json` under stealth and `settings.json` otherwise;
`removeClaudeSettings` only ever knew the second. The visible path was fine, which is why no
existing test saw it — they all install visibly.

Two things made it worse than a leftover file:

- **The concealment survived too.** `removeExclude()` existed and was imported into `kit.mjs`, and
  was never called. So the leftovers stayed hidden and `git status` reported clean — the repo
  *looked* uninstalled precisely because the hiding mechanism outlived the thing it hid.
- **`.bearing/contract.md` was never recorded.** 21KB of generated contract, written at install and
  absent from `manifest.files`, so uninstall could not know it owned it (NS-22).

All three fixed, with the negative control: a user's own hooks, permissions and `.git/info/exclude`
entries survive untouched.

### Fixed — the block named `npx gitnexus analyze` in order to forbid it

Reported with a screenshot. The block correctly said `node scripts/bearing-agent.mjs refresh`, and
the agent ran `npx gitnexus analyze` anyway — because bearing told it to. The message ended *"Run
yourself — never ask the user to run npx gitnexus analyze"*, and the only concrete command in that
sentence is the one it meant to **prohibit**, so it reads as the instruction. Following it lands on
the raw indexer and reintroduces the `npx` invocation the command resolver exists to remove. Naming a
command in order to forbid it is naming it; the message now names none.

The same screenshot showed the agent passing `--skip-agents-md` by hand, which bearing should do
itself under stealth. `analyze` writes its stats block into `AGENTS.md` / `CLAUDE.md` and the
stabilizer strips it after — but in between, the repo **is** dirty, so anything reading `git status`
in that window sees bearing having modified tracked files. Not writing it beats writing and
reverting. Passed on every stealth tier; the stabilizer stays as the net for an indexer run bearing
did not launch.

## 1.0.11 — a stealth install, and the two ways it leaked on the first real repo

### Added — stealth install: bearing for you, invisible to the repo and your teammates

`npx bearing --stealth`. The normal install is a team decision — it commits hooks, skills, a
contract and npm scripts, and everyone who pulls gets them. That is right for a repo you own and
wrong for one you contribute to, or where nobody has agreed to it yet. The only options were
"commit bearing into someone else's repo" or "don't use it".

The promise is narrow and testable: **after a stealth install `git status` is exactly as clean as
it was before, and nothing bearing wrote can be committed by accident.** Two rules get there.

- **No tracked file is modified.** Not `.gitignore`, not `package.json`, not `CLAUDE.md`. Each has
  a per-user substitute: `.git/info/exclude` for ignores, no npm scripts at all, and the contract
  delivered by the SessionStart hook from `.bearing/contract.md` instead of a file.
- **Every new path is excluded.** `.git/info/exclude` is per-clone and is itself untracked, so the
  rules never travel. It is the one ignore mechanism that cannot leak, which is exactly why it is
  the right one and `.gitignore` is not.

Where a runtime has no per-user channel we say so instead of writing the file anyway: Codex reads
`AGENTS.md` and nothing else, so if that file is tracked its contract cannot be hidden and the
runtime is skipped by name. Zed's MCP entry lives in a tracked `.zed/settings.json`, so skills
still install and the context server is left for your Zed user settings.

Not a conversion tool. If bearing is already committed here, `--stealth` refuses — un-tracking ~80
paths and removing them from teammates' checkouts is a deliberate, visible act and must not hide
behind an install flag (NS-1). That check reads git's index rather than the manifest, because the
manifest is gitignored: a fresh clone of a repo with bearing committed has no manifest at all, and
that is precisely the case that must be caught.

Two consequences worth knowing. The exclusions live in the clone, so a **re-clone does not carry
the stealth install** — run it again. And uninstall empties only the block it wrote, leaving
anything you put in `.git/info/exclude` yourself.

### Added — gold practices: the half of the anchor that isn't yours

North-stars are per-project and user-owned. `.bearing/gold-practices.md` is the complement — 19
numbered `GP-#` rules for how the work is done *anywhere*, shipped with bearing, cited the same way.
It rides with the north-stars module: same form, same discipline, one place to look. **`NS-#` wins on
conflict**, because a project's own invariant is more specific than a general rule.

**Every rule has a scar, and a rule without one is not in the file.** The first draft had 21 and
included things like *prefer deleting* and *record the alternative you rejected* — an agent lecturing
itself about what it already does, which is exactly the capability-not-trigger failure NS-23 exists
to reject. Thirteen survived the cut: the mistakes that got made *anyway*, by a careful agent, while
being careful, each paired with the check that catches it.

- **GP-1** — executed, or unverified. *A grep said uninstall left nothing; running it found six leaks.*
- **GP-2** — a test that has never failed has never been tested. *Revert the fix and watch it fail.*
- **GP-3** — test at the seam the bug lives at. *A window fix tested with a value the shipped config
  never produced was green and dead for two releases.*
- **GP-4** — a fixture chosen for convenience tests the case that cannot fail. *A tracked file in the
  fixture sent every test down the skip branch; the create branch, the one that leaked, never ran.*
- **GP-5** — an assertion that cannot fail is not an assertion. *Three of them: a substring check
  against text that always contained it, a revert check written `return "" || (…)`, and a fixture
  whose search term matched under both branches. All passed. None tested anything.*
- **GP-9** — a default indistinguishable from an explicit choice disables everything downstream that
  would correct it. *The 200000 window default, read as the user's own statement of fact.*
- **GP-13** — your blast radius includes what you cause OTHER tools to write. *Stealth was verified
  clean at install, then the indexer it triggered dirtied the repo.*

Six more came from a **different** codebase — a real product repo whose own north-stars had
accumulated rules that were never project-specific to begin with. Those generalise cleanly and each
kept its scar: establish a contract from the thing that defines it and never from something that
calls it (`GP-14` — two parameters were settled from a frontend helper that was itself inverted);
never ask a person what the source can answer (`GP-15`);
the same fix in N places is one implementation with N call sites, *across* separate PRs too, and a
copied explanatory comment is the tell (`GP-16`); when your tooling lies, fix the tooling rather than
the one-off that hit it (`GP-17`); reporting something as unverified is not a handover, and finding
the test data is your job (`GP-18`); send each fact to the reader who can act on it (`GP-19`) —
which is about *where* an unverified claim goes, never about omitting it.

What stayed behind in that repo's north-stars is as telling: ticket workflow, plan-document gates,
who gets told in which channel. Those are the project, not the practice.

Two guards keep the file honest, both computed rather than trusted: every rule must carry a
`*Scar:*`, and every `GP-#` cited in the contract, the skills or the README must exist. The second
earned itself immediately — trimming the list left a citation pointing at a deleted rule, and another
that still resolved while meaning something entirely different.

Ownership runs opposite to the north-stars and both directions matter: `bearing update` **refreshes**
the gold practices, so a fix to a rule reaches every repo, and it still never touches
`.bearing/northstars.md`. Declining the north-stars module declines both.

### Added — `bearing-pr`: writing a PR someone can actually review

A PR skill for the authoring end, distinct from `bearing-pr-review` at the other. It ships with the
microscope module, since both fire at the same moment — work being handed to someone else — and it
degrades to `git diff` plus grep in a repo with no graph.

It looks for the house style **first**: a `PULL_REQUEST_TEMPLATE`, then the three most recently
merged PRs, and only falls back to its own structure when there is nothing to follow. A repo with a
convention keeps it.

What it adds over any template is the paragraph a template cannot generate — the real blast radius
from `detect_changes`, *reconciled against reality*: which callers are listed, which are genuinely
affected, and where the tool overstates it because a symbol changed but its behaviour did not. That
is the reviewer's most expensive work, done once by the person who still remembers why.

### Changed — a stale index now blocks in proportion to what actually changed

Two paths reach the same condition — *the graph no longer describes the repo* — and only one of them
measured anything. The working-tree path counted **source files** and gated the ten graph query
tools, leaving Read and Grep open. The commit path counted **commits**, applied no file filter at
all, and denied everything until a reindex.

So a commit touching one file stopped the whole session. A commit touching only `README.md` stopped
it too, while the graph was accurate for every line of code in the repo. The hard-stop path was the
one with no measurement behind it.

The commit path now counts source files across `indexedCommit..HEAD`, using the same filters as the
drift path — extension, and bearing's own files excluded, since `bearing update` rewrites those
without re-indexing:

- **No source changed** → not stale. A docs, lockfile or CI-config commit leaves every indexed
  symbol accurate, and there is nothing to reindex before trusting it.
- **Fewer files than `driftRefreshThreshold`** → a new `graph_behind` phase. The graph tools are
  gated, Read and Grep stay open, and the message says how many files behind it is. The index is out
  of date, not invalid, and taking away grep over a two-file gap is how a proportionate signal turns
  into a stopped session.
- **At or above the threshold, or a diverged history** → the hard block, unchanged.

A gap git cannot measure counts as material rather than small: guessing "small" on an unknown delta
buys a confident answer from a graph that no longer describes the repo, which is the failure the
gate exists to prevent.

### Added — the task-core is checkpointed through the session, not only at the top

Fixing the window exposed the trigger behind it. The nudge to save state fires at 90% of the window,
and 90% of a correctly-resolved 1M window is **900,000 tokens** — which 6 of 404 real sessions on
one machine ever reached. The one prompt that protects against losing detail was firing in 1.5% of
sessions, and the reason it had seemed to work was the false alarm: a wrong window made it fire
early. Correcting the window removed the accident that was doing the job.

Context fullness was the wrong signal anyway. What should prompt a checkpoint is how much work would
be lost, and that accumulates steadily rather than arriving at a threshold.

So the task-core is now checkpointed every 10% of the window — every 100k on a 1M session, every 20k
on a 200k one, scaling with whatever the window turns out to be. Each band nudges at most once and
only upward, so a compaction that drops the ratio does not replay every band on the way back up, and
skipping bands does not queue them. The 90% warning keeps its urgency and its wording; the earlier
ones are explicitly skippable — *"skip it if nothing meaningful changed"* — because a nudge the agent
is allowed to decline is the only kind that can fire nine times without becoming noise.

The bands divide the *window*, so they inherit whatever it is — which made the window matter more,
not less. Two consequences had to be handled. The evidence lookup now runs from the **first** band
rather than from the 90% warning: waiting meant a 1M session spent all nine checkpoints inside its
first 195k tokens, announcing them as 13%, 30%, 53%, 80%, 98%, and then went silent for the
remaining 800k — front-loaded and then absent is worse than the single trigger it replaced. And when
the window is revised upward mid-session, the spent bands are re-anchored to the corrected one:
*"band 9 is done"* was a statement about a window that turned out not to exist, and honouring it
would leave the rest of the session — most of it — with no checkpoints at all.

Tuning lives in `contextCheckpointEvery` (0 disables the periodic checkpoints and leaves only the
warning). The band is tracked per CHAT, not per repo like the older pressure flag: two sessions in
one repo would otherwise silence each other's checkpoints, and a task-core is per chat.

### Fixed — the 1.0.9 context-window fix had never once run

Reported from a live 1M session: at **197,084 tokens the agent announced "context is near
auto-compaction"** and started saving state. It was 19.7% full. 1.0.9 shipped a fix for exactly this
and the fix was dead on arrival.

Two independent faults, either of which alone was enough.

**The default was indistinguishable from the user's answer.** `loadHookConfig` defaulted
`contextWindowTokens` to `200000`, and the estimator treats a set window as the user's own statement
of fact — so it returned 200000 and stopped, every time. The evidence path added in 1.0.9 could
never execute in a real install. Its test passed by calling `resolveWindow(300_000, undefined)`, and
`undefined` is a value the shipped pipeline never produced: the unit was green, the seam was broken.
The default is now absent. Unset means *"nobody has said"*, which is the truth and leaves the
estimator free to work; setting it in `.bearing/hooks.local.json` or `GITNEXUS_CONTEXT_WINDOW` still
wins outright.

**The correction could not reach the band it was needed in.** It revises the window upward on seeing
usage *above* the assumed 200k — but the warning fires at 90% of it, *below*. So the false alarm was
not an edge case, it was guaranteed on every 1M session: you cross 180k first, and the evidence that
would have prevented the alarm only arrives afterwards. Two signals now settle it before then:

- **An auto-compaction is a measurement.** Claude Code records `compactMetadata: {trigger: "auto",
  preTokens}` at the boundary, and `preTokens` is the size at which the client decided it was full.
  Rounded *down* to a real window, where usage rounds up — the two prove opposite bounds.
  `trigger: "manual"` proves nothing, since a person can `/compact` at any size.
- **The machine's own recent transcripts**, when this session has nothing to say yet. The setting is
  sticky across sessions, so a recent auto-compaction elsewhere is far better evidence than a
  hardcoded floor. Consulted only at the moment we would otherwise cry wolf, so the common path
  costs nothing.

And when nothing has proven the window, the nudge no longer *asserts* one. It says it is assuming
the smaller window and names the one-line way to settle it, rather than announcing an imminent
compaction that may be 800k tokens away. A guess stated as a fact is worse than a guess stated as a
guess (NS-20).

### Fixed — the flag this release exists for could not be typed

Caught by installing the release candidate the way a user would, rather than the way the tests do.
Every natural way to ask for a stealth install failed:

- `bearing install --stealth` died with `Not a git repository: /cwd/--stealth`. The second argument
  was taken as the target path whatever it looked like, so the flag became a directory name — the
  error named a path the user never typed. A flag is never a target now.
- The same bug quietly ate values: `install --runtime claude` consumed `--runtime` as the target,
  after which it no longer appeared in the list the parser searches, so the runtime silently fell
  back to the default. No error, just the wrong install.
- `npx bearing --stealth` with no path routes to the interactive wizard, which was spawned with **no
  argv at all** — the flag was dropped on the floor and the user got a normal, committed install
  into the very repo they had chosen because they must not commit to it. Flags are forwarded now.
- The wizard had no notion of stealth to begin with, so the mode was unreachable from `npx bearing`
  — the entry point most people use. It now asks, right after the target, and skips the question
  when bearing is already committed there and the answer could only be refused.
- `npx bearing --stealth` — the exact line these notes and the README print — answered *"Missing
  target repo path"*. A leading `-` suppressed the implied `install` verb, so the release's flagship
  invocation was one the docs promised and the binary rejected. A leading flag means install now;
  only genuinely verb-less flags (`--help`, `--version`) stay exempt.
- `bearing --version` answered *"Missing target repo path"* too — the one reply that cannot be
  right, since it isn't a question about a repo. It prints the version.

### Fixed — stealth hid what it avoided, not what it created

Found on the first real stealth install, not in the tests. `.mcp.json` was on the list of tracked
files a stealth install must never touch, and absent from the list of paths it must exclude — so
in a repo that *had* no `.mcp.json`, bearing created one and it sat there in `git status`.

The test fixture happened to have a **tracked** `.mcp.json`, which sends the adapter down the
skip-it branch, so the create-path was never once exercised. A fixture chosen to be convenient
tested the case that could not fail (NS-21).

### Fixed — stealth went dirty the moment its index was built

The same install, one step later. `gitnexus analyze` writes its own `<!-- gitnexus:start -->` stats
block into `CLAUDE.md` and creates `AGENTS.md` from nothing — so a repo that was verifiably
invisible after install had a MODIFIED tracked file and a stray untracked one as soon as the graph
was built. One `git add -A` from committing into a third party's repo.

Stealth had accounted for what bearing writes and not for what it **causes another tool to write**.
In a normal install the pre-commit hook strips that block, but stealth installs no hooks and no npm
scripts by design, so nothing was cleaning up.

- SessionStart now stabilizes the agent docs in a stealth repo. It is the one thing guaranteed to
  run, so the churn heals at the next session rather than waiting for a hook that does not exist.
- Stabilizing now **removes** a doc whose only content was that block. `analyze` creates
  `AGENTS.md` in repos that never had one, so stripping left a 0-byte file — ignored and harmless
  in a shared install, a leak in a stealth one. Nothing of yours is lost: the strip preserves your
  content, so empty means there was none.

## 1.0.10 — minions: fan out to gather, and keep the thinking

### Added — Minions, a fifth module: fan out to gather

The README carries a generated diagram for it like every other module — the fan-out is only half
the picture, so it shows what comes BACK (citations, not opinions) and where the conclusion is
drawn.

Your agent can already spawn subagents. What it does not know is **when it should** — so it grinds
through forty files serially, or samples five and generalises. That judgment is the module; the
fan-out is plumbing.

Fan out when the work is **bounded, verifiable, independent and wide** (3+ units): every call site
of a symbol, every file still on the old API, every migration site, every route to audit against one
rule. Don't when the judgment *is* the work, when the answer only survives verbatim, or when the
unit needs context the subagent was never in.

Each subagent carries the project's north-stars and pinned persona, and returns a fixed shape:

```
FOUND    src/fees.ts:88 — const fee = gross * RATE
CHECKED  rg "\* RATE" src/ --type ts
MISSED   dynamic dispatch in src/plugins/ — could not resolve
```

**Minions gather; your agent concludes — they do minimal or zero reasoning.** A subagent returning a
*verdict* puts a cheaper model's summary between the evidence and your decision, which is the drift
this product exists to prevent. And the `CHECKED`/`FOUND` split is load-bearing: `CHECKED` filled
with `FOUND` empty means *it looked and there was nothing*; both empty means *it never understood the
task*. In prose those are the same sentence — the same error as reading a graph zero as absence.

Claude Code only, since it is the only runtime that can spawn subagents with a model choice — the
README says so rather than implying parity.

### Added — the fan-out trigger is now enforced, and citations are checkable

Four follow-ups that turn minions from instructions into something with feedback.

- **A nudge when you are grinding.** The trigger lived only in the always-on contract, which means
  it fired when the agent happened to recall it. A PostToolUse hook now notices 8 *distinct* gather
  targets in a row with no delegation and suggests fanning out — once per session, advisory, never a
  block (NS-5). Distinct targets, not calls: re-reading one file while editing it is not grinding,
  and a nudge that fires during every edit loop gets ignored forever. `minionFanoutThreshold: 0`
  disables it.
- **`node .bearing/lib/verify-citations.mjs src/a.ts:88`** prints what is actually on each cited
  line and exits non-zero if any do not resolve. "Spot-check one per minion" was advice; a
  fabricated `file:line` is the one failure the return shape cannot catch by itself. Deliberately
  not an npm script — those are all owned by the GitNexus module, so a minions-only install could
  not run it.
- **Fan-outs and grind-nudges are counted** in the scorecard, so the module can be measured rather
  than assumed — the same reason the gates keep a tally instead of asserting they help.
- **Subagents inherit graph-first.** A minion grepping for call sites in a repo with a graph is
  doing the exact thing the gates exist to redirect, one level down where no gate can see it.

Also fixed: the context-pressure nudge still named the old shared `.bearing/.task-core.md`, so it
sent the agent to write a core its own recovery would not read.

### Added — minions run on a middle tier, and wanting a smarter one is a smell

`sonnet` by default, overridable per machine via `minionModel` in `.bearing/hooks.local.json`. If
the tier is unavailable the fan-out runs anyway — a costlier minion is a nuisance, a skipped unit is
a hole in the answer.

The tier is not a cost setting, it is a consequence: a middle model is *sufficient* precisely
because minions do no reasoning (NS-24). Which makes it a diagnostic. **If you want a smarter
minion, you delegated judgment** — the fix is the split, not the model. Same when a unit keeps
returning `MISSED`: do that unit yourself rather than re-running it on a bigger model.

### Changed — one spawn harness, shared by microscope and minions

Both modules send work to anchored subagents, and the mechanics are identical: the same pinned
persona from `.bearing/domain.json`, the same north-star subset, parallel where the runtime allows
it, and the duty to say what went unchecked. That is now authored once and rendered into both
skills, with a test that fails if a copy goes stale.

The **return contract stays separate, deliberately** — the two are opposite on the axis that
matters. A microscope lens *must* reason; opinions are the entire point of it. A minion must not
(NS-24). Unifying those would either silence the lenses or let the minions editorialise.

The fan-out threshold is now **3 units, not 5** — at three they already run concurrently, so the
round-trip is paid once rather than three times.

### Fixed — domain inference read the wrong things, and a missing persona stayed quiet

Found by pinning personas on real repos, and all three failures pointed the same way: a
screen-capture app and a patient-facing health platform were both branded *developer-tooling*.

- **Dependencies are not identity.** `package.json`'s dependency list counted as the repo
  describing itself, so a `jwt` dependency scored as a strong *identity* signal — overriding the
  package's own description. Almost every web app depends on an auth library; almost none are
  identity products. Name, description and keywords only.
- **`\bhealth\b` does not match "Healthcare".** The word boundary fails on the trailing *care*, so
  a package naming its own domain scored zero for it. A repo naming its domain should be the
  strongest signal there is.
- **The analyzer's block is not the repo's voice.** bearing's own contract was stripped before
  inference, but the stats block `analyze` writes into `CLAUDE.md` — "indexed by GitNexus… use the
  MCP tools" — was not, and that alone suggested developer-tooling for a claims platform.

And an unresolved domain is now raised where it will be seen: the installer prints the
*consequence* ("reviews here will be generic") rather than one warn line, and the always-on
contract carries the ask so the agent meets it every session — phrased as a job it can usually
answer from the code, asked once, taking no for an answer.

### Fixed — "would be committed" sent you to a .gitignore that was already correct

Found updating a real repo installed back at 1.0.6. The machine-local check reported
`.bearing/.bearing-session-primed.flag` as committable, but the ignore rule was present and
correct — the file had been COMMITTED before that rule existed, and git never ignores a tracked
file however good the rule is.

The check now separates the two causes and names the exit for the one you cannot fix by editing a
file: `already COMMITTED, so the ignore rule cannot help — run git rm --cached <path>` (NS-6).

## 1.0.9 — the agent stops fearing a window it isn't in, and a broken index stops blocking commits

### Fixed — the agent thought every session was a 200k one

A 1M session carrying 300k tokens read as **152% full**, so the agent hedged about running out and
wrote task-cores from the first hour — permanently, since it never got less full. The window was a
hardcoded 200,000.

It cannot simply be looked up: the transcript records no window, and `claude-opus-5` is the same
model id on a 200k and a 1M session. So it is corrected by evidence instead — a session cannot have
carried more tokens than it can hold, so usage above the assumed window disproves the assumption.
The observation is rounded up to a real window rather than trusted exactly, since usage is sampled
at the last assistant turn and the true ceiling is higher than whatever was seen.

Revises **upward only**: too small is the failure being fixed, too large merely delays a warning.
An explicit `contextWindowTokens` in `.bearing/hooks.local.json` is your own statement of fact and
still wins.

### Fixed — the pre-commit hook blocked commits when the INDEX was broken

Reported from a real repo: `bearing:full-pdg` ran unguarded under `set -e`, so any indexer failure
blocked every commit. Theirs ended *"graph write collapsed — 200,722 relationships produced, 64,983
readable"*, reproducibly, and the team committed with `--no-verify` for days.

Blocking a commit because an *index* could not be built fails the developer for something that is
not their fault and that they cannot fix from there (NS-5) — and `--no-verify` teaches people to
skip the hook permanently, which costs far more than one stale index. bearing's CI has always been
report-not-gate for exactly this reason; the commit hook, where a block is more disruptive, was the
opposite.

The two halves are now split (NS-8): **fail open for the developer** — the commit proceeds — and
**fail closed for the graph** — the index is marked failed, so the session brief tells the agent
`Index is STALE` instead of letting it answer from a broken one. The warning names how to fix it
(`bearing:agent-refresh`), how to report it (`bearing:fallback`), and how to get the old behaviour
(`BEARING_PRECOMMIT=block`, mirroring `GITNEXUS_CI_MODE=block`).

## 1.0.8 — an uninstall that actually leaves, and a task-core per chat

### Fixed — uninstall did not leave the repo as it found it

A shakedown of install / update / uninstall across every runtime and module combination. The
install and update paths held up — idempotent over repeated runs, recorded choices preserved,
feature downgrade removing what it should. Uninstall was the weak one, and every defect below needs
a SECOND install to appear, which is why a suite that installs once never saw them.

- **The Node floor stayed in the user's `package.json` forever.** Install adds
  `engines.node >= 22.9.0` because bearing's own scripts need it; uninstall never took it back. Left
  behind it is enforced by npm under `engine-strict`, by Yarn always, and by CI — so a project on
  Node 20 fails to install because of a tool it removed. Now recorded at install and removed at
  uninstall, and a floor the user set themselves is never touched in either direction.
- **Uninstall restored bearing's own Cursor config.** A backup answers "was there a file of the
  user's here before bearing?", and only a first install can observe that — by the second run
  `.cursor/hooks.json` exists because we wrote it. So update backed up our own file and uninstall
  faithfully restored it, leaving Cursor registering hooks whose scripts the same uninstall had just
  deleted: a failed spawn on every session start, prompt and tool call, in a repo the user believes
  is clean. The earlier install's answer now wins, per adapter so a runtime added later still backs
  up a genuinely user-owned file. Uninstall also strips a leftover registration written by an older
  version, and only when the entry is the one we write — a user's own `gitnexus` MCP server survives.
- **Empty `.zed/` and `.cursor/` shells were left behind.** Install creates these in repos that
  never had them; uninstall wrote back `{"context_servers":{},"agent":{"profiles":{}}}` and stopped.
  Both are now removed once nothing of the user's is left in them — and a settings file holding
  their theme, keymap or own servers is left exactly as it is.
- **An intel-only contract pointed at a section that isn't there.** The north-stars text
  distinguished itself from "the graph-first North star above", which in a repo without the GitNexus
  module is a pointer to a section the filter had just removed (NS-13). Contract tags now apply to a
  paragraph as well as a section.
- **A bad target printed a stack trace.** "Not a git repository" is a fact the user needs, not a
  crash to read; the stack is one `BEARING_DEBUG=1` away.

Known and accepted: installing rewrites `package.json` as 2-space JSON, so a repo that minified or
tab-indented it sees a whitespace-only diff that uninstall cannot undo.

### Fixed — the task-core was one file per REPO, not per chat

`.bearing/.task-core.md` was a single path. The moment two agent sessions ran in the same
repository — a second editor window is enough, and three is routine — they overwrote each other's
save-state. The failure is worse than losing the file: on recovery a session reads whatever the
last writer left, so it reconstructs from **another chat's task** with full confidence. That is
precisely the drift a task-core exists to prevent, manufactured by the task-core itself.

- **One file per chat**, at `.bearing/task-cores/<chat-id>.md`. The key comes from the transcript
  path every hook already receives; its basename is the session id and it stays stable across
  compaction, which is exactly when the core must be found again.
- **The path is now unguessable, so the session brief states it** — on a fresh start as well as on
  recovery. Before, the agent could name the one documented file from memory; without this it
  could not write a core proactively at a milestone and would only learn its path once compaction
  hit, which is too late.
- **A pre-existing single-file core is still read**, so upgrading mid-task loses nothing.
- Old chats' cores are pruned after 30 days, never the current chat's however old it looks.
- `.bearing/task-cores/` is gitignored and covered by the post-install check — the previous rule
  matched a file, not a folder, so every chat's save-state would have been committed. Uninstall
  removes the empty directory but keeps any core still in it, the same way it keeps north-stars.

### Fixed — the contract promised commands the install did not have

Found by dogfooding: bearing's own repo runs an intel-only install, and `npm run bearing:northstars`
— the command its own `CLAUDE.md` advertises — does not exist there.

Every npm script is owned by the GitNexus module, so an intel-only install has none of them. The
north-stars section was advertising a command you only get by installing a *different* module, in
the one file every agent reads as authoritative (NS-13, NS-20). The contract now points at the
skill and the file path, both of which are always installed.

- The generated-file note shipped into user repos said "edit there, run `npm run gen:contract`" — a
  path and a command that exist only in bearing's own repo. It now tells the user what they actually
  need to know: edits to that block are replaced on the next update.
- The post-install check that catches dangling commands scanned only executable files, on the
  reasoning that docs mention commands illustratively. True in general, but the contract is an
  *instruction*, so those three files are now held to what is installed — including when
  `package.json` has no scripts at all, which the original scan skipped as uninteresting and was in
  fact the broken case.
- README lists those commands under "With the GitNexus module".

### Added — `bearing update` tells you what changed

Nobody visits a changelog; everybody reads the terminal they just typed into. An update is the one
moment you are asking "what did this just do to my repo?", and bearing already records the version
you were on, so it can answer:

```
  What's new since 1.0.4
    1.0.5 — the compound-command notice was silent on the shape it exists for
    1.0.6 — one MCP server for the whole machine, instead of one per client
    1.0.7 — a domain expert on every review, and an installer that checks its own claims
    Full notes: https://github.com/ReidenXerx/bearing/releases
```

Titles only — 1.0.7's section alone is 13k characters, and burying the next steps under it would
make the useful part unreadable. It stays silent rather than guess: a fresh install, an unknown
previous version, no packaged changelog, or nothing new all print nothing, and an update never
fails because release notes could not be read.

`CHANGELOG.md` now ships in the npm package, so this works from an install as well as a checkout.

### Added — every release is on GitHub

The repo had zero tags and zero releases, so the changelog was visible only to someone who thought
to open the file. All eight — `v1.0.0` through `v1.0.7` — are now published, each tagged at the
commit that actually shipped it, with its changelog section as the body. `npm run release:notes --
--list` shows what is releasable; it refuses `Unreleased` and the pre-rename `1.2.0`.

The README's changelog link is now absolute, since npm does not reliably rewrite relative paths
(NS-17), and points at the releases page too.

## 1.0.7 — a domain expert on every review, and an installer that checks its own claims

The kit was renamed `gitnexus-agent-kit` → `bearing`, but three identifiers kept the old name
because renaming them touches files in *your* repository. Two were merely stale. One was a bug.

### Fixed

- **An intel-only install no longer creates `.gitnexus/`.** The install manifest lived at
  `.gitnexus/agent-kit-manifest.json`, and writing it created the graph tool's index directory in
  repos that had explicitly declined the GitNexus module — an index directory for an indexer that
  was never installed. NS-13 names four channels through which enforcement must not leak; this was
  a fifth. The manifest now lives at `.bearing/manifest.json`, and the four `gitnexus` entries in
  the managed `.gitignore` block are gated on the module too. `.bearing/.gitnexus-*` stays
  ungated: the **core** session-primer writes it, and `.gitnexus-northstar-counter.json` belongs
  to the north-stars module rather than the graph.
- **The managed `AGENTS.md` / `CLAUDE.md` block is `<!-- bearing:BEGIN -->`.** Matching only a new
  marker would have left the old block in place in every installed repo and appended a second one
  beside it — the exact failure `GITIGNORE_MARKERS_LEGACY` already documents. Both adapters now
  match the current marker or any legacy one, replace the first in place, and drop any duplicate.
- **The gitignore migration pointed at a command that does not exist.** It rewrote
  `(safe to remove via gn-kit uninstall)` into `(safe to remove via gn-agent-kit uninstall)` —
  one dead binary name for another. Both now collapse to `bearing-uninstall` (NS-6).
- Renamed the remaining user-visible strings: the `bearing verification` banner, the
  `bearing installed` health detail, and a sync script that told the user to run `gn-agent-kit`.

### Fixed — uninstall now leaves the repo as it found it

Six leaks, all pre-dating this release. After `install; update; uninstall` a repo was left holding
`.bearing/hooks.json`, an empty `.claude/` with a `{}` settings file, empty `.claude/skills/` and
`.agents/skills/` directories, and a `.gitignore` it never had. It now comes back byte-identical.

- **An update disowned the file the install created.** `.bearing/hooks.json` is seeded only when
  absent, because it is team-shared config the user edits — but skipping the copy also dropped it
  from the manifest's file list, so uninstall no longer knew the kit had put it there. It is now
  re-claimed on update, and *only* when a previous manifest says the kit wrote it: a hooks.json
  that existed before the first install was never ours and is still never touched.
- **`.claude/settings.json` was left as `{}`** once our hooks were stripped out. It now follows
  the rule `.mcp.json` in the same adapter already used — remove the file when what remains is
  empty, keep it when the user has anything else in it.
- **The skill link directories were never removed**, only their contents, and **`.claude/` was
  missing from uninstall's prune list** entirely. Both are rmdir-only, so a directory holding
  anything of the user's survives.
- **A `.gitignore` the kit created was left behind empty.** Whether the repo had one is now
  recorded in the manifest at install time, because by the second run the file exists *because we
  made it* — indistinguishable, after the fact, from the user's own (NS-1).
- **Uninstall stripped the final newline** from a `.gitignore` it was otherwise leaving alone,
  which was enough to show the file as modified in the user's diff.

### Added — the installer now checks its own claims

Every defect below was found by an agent inspecting a real install by hand. A person running
`npx bearing` would have been told about **none** of them — and three would have printed success
while broken. The existing verifier could not have caught a single one: it asks *does this file
exist*, and every failure had the right files in the right places with the wrong content.

`lib/postcheck.mjs` asserts post-conditions against the disk at the end of every install and
update. Each check exists because a real defect shipped through the gap it covers:

| check | the defect it would have caught |
| --- | --- |
| `scripts_binary` | all 16 npm scripts reverted to `npx gitnexus@latest` after step 7 |
| `mcp_entries` | setup overwrote `.cursor/mcp.json`; the Zed adapter hardcoded npx |
| `mcp_http_live` | the repo pointed at a port where the LaunchAgent had died on exit 127 |
| `local_state_ignored` | task-core, session flags and install backups became committable |
| `agent_docs` | a marker rename appended a second contract block |
| `no_legacy` | two manifests left side by side, free to disagree |
| `declined_clean` | `.gitnexus/` created in a repo that declined the graph module |
| `files_present` | a recorded file missing from disk |

Three deliberate properties:

- **Not behind `--skip-verify`.** That flag exists to skip the slow index build, and every
  automated path in this repo passes it — which is precisely how these reached a real machine.
  The checks read the disk we just wrote and cost milliseconds.
- **In `lib/`, not the bundle.** `scripts/bearing-verify.mjs` is owned by the gitnexus feature and
  so is its fallback, so an intel-only install had no verification at all. The configuration least
  exercised by the author was also the least checked.
- **A failure changes the headline and the exit code.** The summary reads "finished with N FAILED
  checks" rather than "complete", and the process exits non-zero. Environmental problems (a server
  that is not running) print a fix instead of asking for a bug report.

Recorded as NS-20 and NS-21. The negative-case test immediately earned its keep: the first draft
of `scripts_binary` compared with `String.includes`, and `"npx gitnexus@latest".includes("gitnexus")`
is true — a check that could never fail, which is the exact trap NS-9 describes.

### Fixed — `npx gitnexus@latest` came back after every install

1.0.6 added a recorded `gitnexusCmd` so a repo could pin the binary it runs. The manifest recorded
it correctly and `kit.mjs` wrote it correctly — and then **step 7 undid all of it**, because three
shipped components rebuilt their commands from the bare default. Found by installing into a real
repo and reading what actually landed: manifest said `gitnexus`, all 16 npm scripts said `@latest`.

- **`scripts/bearing-teaching/merge-package-scripts.mjs`** is run by `bearing-setup.sh` *after* the
  installer has written the scripts, and rebuilt every one of them from `npx gitnexus@latest`. The
  existing regression test passed `--no-setup`, so the fixture skipped exactly the step that broke
  it (NS-9). It now asks `.bearing/lib/gitnexus-cmd.mjs`, and so does `--snippet`.
- **`bearing-setup.sh` overwrote `.cursor/mcp.json`** with a hardcoded `npx -y gitnexus@latest mcp`
  stdio entry, reverting *both* recorded choices — a repo pointed at a shared http server went
  back to spawning one server per client, recreating the pile-up http exists to prevent. It now
  builds the entry from the new `mcpEntryFor()` resolver. Its own `GITNEXUS_CLI` was pinned the
  same way and now resolves too.
- **The Zed adapter never honoured either choice** — alone among the three, it hardcoded the npx
  entry. Because Zed project settings *win over user settings*, that committed entry superseded a
  correctly configured global one: observed on a real machine as Zed running `analyze` from
  `~/Library/Application Support/Zed/node/cache/_npx` against the same index a bearing refresh was
  writing. Zed now writes the resolved binary. It stays on stdio deliberately even for an http
  repo — Zed's remote-context-server shape is unverified, and guessing a schema in someone's real
  editor config risks a server that will not start at all, which is worse than one that works
  locally. The installer now says so in its next steps instead of leaving it to be discovered.
- **`.bearing/lib/detect-api-router.mjs`** spawned `npx gitnexus@latest cypher` directly, with
  `gitnexusSpawn` sitting unused beside it — so it queried the published analyzer's graph while
  everything else used the installed one.

### Fixed — the CLI silently did nothing through a symlink

`lib/kit.mjs` decided whether it was the entry point by comparing `import.meta.url` against
`process.argv[1]` unresolved. Any symlink on the way in made those differ, so the CLI fell through
and **exited 0 having done nothing**. On macOS this is the ordinary case, not an exotic one: `/tmp`
is a link to `/private/tmp`, so `node /tmp/checkout/lib/kit.mjs install …` looked like a
successful install that installed nothing. Both sides are now resolved with `realpath`.

### Fixed — the macOS shared MCP server never actually started

The launchd path shipped in 1.0.6 marked UNVERIFIED. Running it on a Mac showed the warning was
right, and in the predicted place.

- **The LaunchAgent exited 127 in a restart loop.** An absolute `ProgramArguments` path is not
  enough: gitnexus is an "env node" shebang script, and launchd starts with a minimal PATH that has
  no version-manager bin dir, so `env` could not find `node`. `servicePathEnv()` now puts the
  binary's own directory first — where nvm, volta, fnm and nodenv all keep the matching `node` —
  and the systemd unit had the identical latent bug.
- **`installService` reported `ok: true, "listening on 127.0.0.1:39100"` for that dead agent**,
  because it only checked that `launchctl bootstrap` had *loaded* the definition. Loading a
  service and running a server are different events. The caller's fallback-to-stdio path was
  therefore unreachable — it would have written an http entry pointing at nothing, which fails
  every graph call. It now confirms the port answers before claiming success.

Verified on macOS 27: agent runs, survives `kill -9` via KeepAlive, and is listening again ~1s
later. The Task Scheduler path remains unverified.

### Compatibility

- **Every manifest reader consults the old paths.** The manifest *is* an install's identity —
  `update`, `uninstall` and `update-all` discovery all key off it, so a reader that knew only the
  new path would report an installed repo as never installed and `update-all` would silently stop
  seeing every repo installed before this release. Install and update move the file and prune the
  emptied `.gitnexus/` (rmdir only, so a real index is never touched).
- **The `gitnexus:*` npm script aliases are unchanged** (NS-15), and so is the Zed `zed-gitnexus`
  profile — that one names the actual GitNexus MCP server, not the kit's old name.

### Added — a domain persona, resolved once and used everywhere

The headline claim — a trading repo reviewed by a quant trader, a payments repo by a ledger
engineer — was implemented in exactly ONE skill. `.bearing/domain.json` appeared in the README and
in `bearing-microscope` and nowhere else: nothing created it, nothing seeded it, and no other skill,
contract or session brief read it. Every review skill except microscope worked as a generic
engineer, and microscope re-inferred the domain on each wave, so wave 2 could adopt a different
persona than wave 1 while folding in wave 1's findings.

- **Resolved once at install**, written to `.bearing/domain.json`, and substituted into the
  always-on contract every runtime reads. Inference reads only what the repo says about ITSELF —
  package metadata, README, `CLAUDE.md` — and weights `package.json` above prose.
- **A near-miss is recorded as `suggestedDomain` rather than adopted.** A wrong specialism biases
  every downstream judgement; "senior engineer" biases nothing. Equal weighting classified bearing
  itself as a *trading* repo, purely because its README explains a feature using a trading example.
- **The file is yours.** Edit it and the contract follows; update never overwrites it.

### Changed — CI reports instead of gating

The merge gate failed PRs when a high-blast-radius symbol changed without tests, and that is the
wrong shape for this signal: the graph cannot distinguish "nothing calls this" from "I could not
resolve the callers", so a hard block on it fails honest PRs until people learn `[skip ci]`. It now
posts a sticky PR comment, a job summary and inline annotations — blast radius per changed symbol,
affected flows, security-sensitive paths, import cycles — and **never fails the build**.
`GITNEXUS_CI_MODE=block` is opt-in.

### Fixed — the placeholder check missed the placeholder it was written for

`checkPersonaResolved` looked only for `__BEARING_PERSONA__`. The bug it shipped alongside was
`__GITNEXUS_REPO__` reaching the Cursor rule verbatim, so the regression guard could not have caught
the regression — it covered the right FILES and the wrong TOKEN. Both are now read from the exported
constants, so substitution and verification share one source, and the failure names which token in
which file.

### Changed — the README and diagrams

- **3374 words to 1335.** The old page explained the product to someone already convinced. Hook,
  four modules and install now sit above the fold, one section per module led by its diagram, and
  the deep material stays in `docs/`.
- **The diagrams draw one claim each.** The microscope one had twelve boxes at 11px, which reads as
  "this is complicated" — and it *understated* the feature by drawing two lenses, when the skill
  spawns one lens agent per slice, in parallel where the runtime allows, each carrying the same
  pinned persona.
- Rasterising caught three defects invisible in the source: arrows missing a `y2` rendered
  `undefined`, sub-labels overlapped the card beneath them, and a backward connector routed straight
  through the boxes it was meant to pass under. The generator now **fails** on text that would
  overflow the canvas, since SVG clips silently.

## 1.0.6 — one MCP server for the whole machine, instead of one per client

MCP stdio spawns one child process **per client**, by protocol design. Every editor window and
every agent session therefore gets its own GitNexus server — seven were observed on one machine,
all watching the same index, all auto-refreshing when HEAD moved, and all queueing behind a single
index lock with a 600 s timeout. That contention blocked real work.

GitNexus already ships the fix: `gitnexus mcp --http` (v1.6.9) is one long-running server that
resolves repositories per request, so a single process serves every repo on the machine.

### Added

- **The installer asks how the MCP server should run**, rather than deciding for you. The http
  option installs a background service on your machine, and that is not something to arrange
  behind your back. Only asked when the GitNexus module is actually selected.
- **The choice is recorded and re-applied on every update.** bearing still always writes the MCP
  entry — that is what keeps it predictable — but it writes what you chose instead of a hardcoded
  default. Non-interactive: `--mcp http|stdio|<port>|<url>`, or `BEARING_MCP`.
- **Optional service setup**: a systemd user unit on Linux, a LaunchAgent on macOS, a scheduled
  task on Windows. No root anywhere, loopback only, and the removal command is printed with it.

### Fixed

- **`bearing update` silently reverted a hand-configured MCP entry.** A repo deliberately pointed
  at a shared server, or at a locally built gitnexus, had that overwritten with
  `npx gitnexus@latest` at the next update — undoing a whole daemon setup without a word and
  recreating the pile-up it was installed to fix.
- **The README documented two commands that 404.** `npx bearing-update <repo>` makes npx resolve a
  *package* by that name, which does not exist. The subcommand form (`npx bearing update <repo>`)
  is the one that works through npx.

### Known limitations

- Only the **systemd** path has been executed. The launchd and Task Scheduler paths are written
  from documented behaviour and are **untested** — the file says so, a successful install on those
  platforms says so, and the manual `gitnexus mcp --http` command is printed either way. The rule
  that broke the first systemd draft (these supervisors do not inherit your shell's PATH, so the
  binary must be named absolutely) is applied and tested on all three.
- Task Scheduler has no equivalent of `Restart=on-failure`, so on Windows the server stays down
  until next logon if it dies mid-session.
- A service definition bearing did not write is never touched, and a failed service install falls
  back to stdio rather than leaving you with a config pointing at a dead port.

## 1.0.5 — the compound-command notice was silent on the shape it exists for

1.0.4 added a notice telling the agent that a blocked shell command was blocked WHOLE, so
`python3 edit.py && grep ...` could not be read as "the edit landed, only the grep was blocked".
It fired on `&&`, `||` and `;`.

**The incident it was written for has none of those.** It was a heredoc followed by a search on
the next line — a `python3` heredoc that rewrote several call sites, then a `grep` beneath it.
Bash rejects the whole line, so the rewrites never ran, and the notice stayed silent because a
newline is not an operator. A newline separates steps exactly as `;` does. It now counts, so the
notice covers the shape that actually costs silent edits.

Backslash line-continuations are excluded — `foo \` then `--bar` is one step, and warning there
would report lost work when none was. That exclusion also handles CRLF, where the byte before the
newline is the carriage return rather than the backslash; without it the exclusion failed silently
on Windows.

Over-warning is the deliberate direction: the notice fires only on a **deny**, where "nothing ran"
is true by construction. A missing notice costs silently-lost work; a redundant one costs a line.

### Added

- `lib/classify.test.mjs` — behavioural coverage for the shipped guard core, which previously had
  none. Pins the compound-notice shapes and the scoped-grep allow *with its paired deny*, since an
  allow with no paired deny widens silently into "greps are fine".

## 1.0.4 — dogfooding, a broken uninstall, two dead gates, and field feedback

Installing `bearing` into its own repo for the first time, then auditing the paths dogfooding
doesn't reach, then acting on a report from an agent using the kit in a live project.
**Anyone on 1.0.3 should upgrade — it cannot uninstall.**

### Fixed — critical

- **`uninstall` crashed partway through.** It threw whenever no backup was recorded (the normal
  case) and, being the first adapter in the cleanup loop, took the rest with it: hooks stayed
  registered against deleted files, the MCP server stayed configured, and the manifest survived so
  the repo still looked installed.
- **`uninstall` and module-deselection deleted files they had overwritten.** Install stashes a
  colliding `.githooks/pre-commit` or `.vscode/settings.json` beside itself; removing ours without
  restoring theirs left a hole with the content stranded in a `.bearing-backup`. Both now put the
  original back.
- **Deselecting a module removed nothing.** Re-installing with fewer features left every file,
  hook, MCP entry and npm script in place — so turning GitNexus off left its gates enforcing.
- **The large-source-read gate had never fired once.** It referenced an unbound `config`; the
  `ReferenceError` was swallowed by its own fail-open catch and reported as "0 lines", so no file
  was ever large enough to gate.

### Fixed — the tool blocking legitimate work

- **A stale index was a total lockout.** One commit of drift and the agent could not run `ls`, tail
  a log, read a `.csv`, or run tests until a full reindex. Staleness now gates only what a stale
  *graph* would have answered.
- **`Glob` was inverted.** `**/*` — the broadest sweep there is — was allowed, while `src/order.js`
  was denied and told to use `query` with a concept, which cannot find a file you named by path.
- **Scoped searches were denied and sent to a tool that can't answer them**: a grep in one named
  file, a search in `tests/`, and counting occurrences, all redirected to `cypher ACCESSES`.
- **A blocked shell command implied the rest of it ran.** A denied Bash call blocks the *whole*
  line, but the message named only the offending segment — so `python3 edit.py && grep …` read as
  "the edit landed". Sequenced commands now say outright that nothing executed.

### Added — the kit distrusts the graph, and itself

- **Unreliable `impact` verdicts are flagged.** When the pre-edit gate grades a change `risk: LOW`
  but resolved no callers — or only test files — the agent is told to treat it as unknown blast
  radius and confirm classically. It warns rather than blocks: re-running `impact` returns the same
  empty answer.
- **"A graph ZERO is not evidence of absence"** is now part of the always-on contract. Positives
  are strong evidence; zeros mean *unknown* and must be confirmed before any "dead code" call.
- **The kit audits its own enforcement.** `bearing:scorecard` and the session brief report whether
  the gates are earning their keep, and name the evidence that distinguishes "gates misfiring" from
  "gates working on a grep-happy agent".

### Fixed — first-run experience

- **`npx bearing` advertised the wrong product.** Six strings still listed three runtimes after
  Codex shipped, including the runtime picker's "All" option — so choosing All looked like it
  excluded Codex.
- **The banner box stopped closing** once the greeting grew, and the installer asked "quick or full
  index?" in installs with no indexer.
- **`update-all` claimed "Index built"** for repos with no GitNexus module, and reported a failed
  reindex as the whole update failing.

## 1.0.3 — 20 defects fixed after an adversarial review

Two independent reviewers audited the install/migration core and the runtime hooks, reproducing
every finding end-to-end. **Anyone on 1.0.x should upgrade** — several of these made the tool
unusable or destructive.

### Fixed — critical

- **`npx bearing` died immediately.** The interactive installer — the command the README leads with
  — threw a `ReferenceError` on its first line.
- **Any install without the `gitnexus` module crashed**, after writing the manifest, leaving a
  half-installed repo.
- **The feature filter applied to FILES only.** `settings.json` still registered every hook,
  `package.json` still got every script, `.mcp.json` still wired GitNexus — so a filtered install
  spawned a missing module on every tool call.
- **`uninstall` deleted your north-stars** and `hooks.local.json` (untracked by the kit's own
  gitignore, so unrecoverable). It now removes only what it installed and reports what it kept.

### Fixed — the tool blocking legitimate work

- Repos living under `~/src` or `~/go/src` had **every file** treated as source: every large Read
  denied and every Edit gated, repo-wide. Classification is now repo-relative.
- Piping into `rg`/`ag`/`ack` was denied — `npm run build 2>&1 | rg error` blocked, with a Cypher
  query offered as the fix.
- `TODO`/`FIXME` greps were denied as symbols, redirected to a lookup that cannot resolve.
- A **failed refresh locked the session permanently** and re-locked it every session; the escape
  hatch existed but was unreachable.
- A repo with **no commits** denied `ls`, `cat`, Read, Grep and Edit.
- **`bearing update` tripped its own drift gate**, blocking graph queries right after updating.
- Deny messages now name the two ways out (`bearing:fallback`, `mode: guide`).

### Fixed — protecting your files

- Install **overwrote `.vscode/settings.json` and `.githooks/pre-commit`** without a backup, and
  uninstall then deleted them. Pre-existing files are now saved to `<file>.bearing-backup`.
- The pre-install backup was **re-taken from the already-modified file** on every update, so
  uninstall "restored" kit artifacts.
- Team-tuned `.bearing/hooks.json` was **reverted on every update** (e.g. `mode: guide` → blocking).
- A `.gitignore` rule appended with `>>` was **absorbed into the managed block and deleted** on the
  next update.
- `update --features` was silently ignored; migration failures were rendered as successes.

### Fixed — performance and precision

- The read guard read entire files to compare one line count (398ms / 230MB on 54MB); now a bounded
  scan (104ms → 2ms on 9.4MB).
- Context-pressure tail cap 8MB → 32MB — past it the estimator reports "unknown", which reads as
  "not full" exactly when the window is filling.
- `git … commit` was a substring match, denying `git rev-parse HEAD^{commit}` and friends.

75 tests, up from 69 — every fix has a test that fails when the fix is reverted.

## 1.0.2 — proper diagrams

### Changed

- README diagrams are now generated **SVG** (`npm run gen:diagrams`) rather than ASCII: rendered
  boxes, colour-coded outcomes, readable on light and dark. Served over absolute raw URLs so they
  display on npm and GitHub alike, with no external renderer and no dependency on npm's
  relative-link rewriting. 1.0.1 shipped the ASCII interim — this is the version worth looking at.

## 1.0.1 — npm presentation fixes

### Fixed

- **README diagrams rendered as raw code on npmjs.com.** npm does not execute mermaid, so five
  `flowchart` blocks displayed as literal text to anyone arriving via npm. Replaced with generated
  SVG (`npm run gen:diagrams`) served over absolute raw URLs, so they render on npm and GitHub
  alike — no external renderer, and no reliance on npm's relative-link rewriting.
- Package `description` and `keywords` were stale: missing the Codex runtime and still carrying the
  pre-rename framing. Added `homepage` and `bugs` links.
- The version assertion in the test suite pinned a literal string, which would have failed on every
  future release. It now checks semver shape plus a matching CHANGELOG entry.

## 1.0.0 — first public release (as `bearing`)

> **Why the number went down.** Everything below 1.0.0 shipped privately as `gitnexus-agent-kit`.
> This is the first release published to npm, so the version resets rather than inheriting a history
> nobody outside the project can see. Older entries are kept for provenance.

### Renamed

- `gitnexus-agent-kit` → **`bearing`**: package, CLI (`bearing`, `bearing-update`, `bearing-uninstall`), repo, and the whole internal surface — `.gnkit/` → `.bearing/`, `gitnexus-*` hooks → `bearing-*`, `gitnexus:*` scripts → `bearing:*`, skills, Cursor rules and data files.
- **Every legacy npm script name still works** as an alias, so a pre-commit hook calling `npm run gitnexus:full-pdg` keeps working after upgrading.
- Migration moves your `.gnkit/` contents — north-stars, task-core, per-machine config — rather than leaving a fresh directory beside them. If both exist it refuses to guess and says so.

### Added

- **Feature modules.** `--features northstars,taskcore,microscope,gitnexus` — each installs and works independently, none depends on another. An intel-only install ships no enforcement gates, so a repo without GitNexus is never told to run a command it does not have.
- **Interactive installer** that explains each module and lets you choose.
- **North-stars** — user-owned, authoritative, numbered project invariants that outrank every other doc and are re-anchored mid-session.
- **Task-core** — a dense save-state written before compaction and read back on recovery.
- **Fallback → telemetry bridge** — every graph-distrust escape hatch is logged with the graph state, reviewable via `bearing:fallback-log`.
- **Codex** runtime (contract tier — `AGENTS.md`, no tool gates).
- Node CLI entry point: fixes `npx` (npm symlinks broke the old bash wrappers) and drops the bash dependency, so Windows works without WSL.
- Per-machine config override `.bearing/hooks.local.json` and `GITNEXUS_CONTEXT_WINDOW`.

### Fixed

- Drift gate counted **zero** for new source files in a new directory (git collapses untracked dirs) and for **deleted** source files — both now counted, the latter clearing once the index is rebuilt.
- Context-pressure estimator fell back to a byte count of an unbounded transcript, reporting a 273 MB log as ~78M tokens and firing "context full" on every tool call.

## 1.2.0 — GitNexus v1.6.8 alignment

### Added

- First-class Cursor + Zed runtime support via `--runtime cursor|zed|both`.
- Zed project profile: **Zed + GitNexus**, `.agents/skills` symlinks, and `AGENTS.md` guidance.
- PDG-aware pre-commit refresh: `.githooks/pre-commit` runs `npm run bearing:pdg` before graph smoke checks.
- GitNexus v1.6.8 tool routing for `trace`, `pdg_query`, PDG `impact`, and taint `explain`.
- Security review skill covering taint, PDG flows/controls, trace, and impact.
- CUDA source detection (`.cu`, `.cuh`) in hooks and review helpers.
- Branch-aware review commands:
  - `npm run bearing:branch-status`
  - `npm run bearing:pr-impact`
- Persistence/database health checks in `health` and `doctor`.
- Bulk update command for installed repos:
  - `./bin/update.sh --all [search-root] --runtime both`
- Skill index docs for routing tasks to the right playbook.

### Changed

- Mid-session agent refresh stays lightweight (`bearing:agent-refresh`), while commit-time refresh uses PDG.
- Update can upgrade an existing cursor-only or zed-only install to `both`.
- Zed-only installs now include shared helper modules required by target repo CLI commands without enabling Cursor hooks.
- Generated MCP snippets now use current v1.6.8 parameter names (`search_query`, Cypher `statement`).
- Help examples now use neutral placeholder repo names.

### Fixed

- Zed-only `gitnexus-agent.mjs health/brief/verify` compatibility.
- Incorrect “Index built” status when install/update used `--no-setup`.
- Private/source repo name leakage in public docs and maintainer scripts.
- Legacy mirrored skills using outdated MCP argument names.

### Migration notes

- To upgrade an installed repo to Cursor + Zed support:

  ```bash
  ./bin/update.sh /path/to/repo --runtime both --no-setup --skip-verify
  ```

- To upgrade every installed repo under a workspace root:

  ```bash
  ./bin/update.sh --all /path/to/projects --runtime both --no-setup --skip-verify
  ```

- After update, restart Cursor/Zed and run in target repos:

  ```bash
  npm run bearing:health
  npm run bearing:verify
  ```
