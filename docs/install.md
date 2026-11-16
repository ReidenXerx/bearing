# Install — the details

Later, `npx bearing doctor` tells you whether an install is still healthy — a hook registered twice,
a hook pointing at a file an update deleted, an install older than the package — and the exact command
that fixes each. `npx bearing doctor ~/Projects --all` checks every install under a folder. It changes
nothing.

**Several sessions in one repo** — two windows, a second chat, minions in worktrees — can turn on a
warning (`"sessionsWarn": true` in `.bearing/hooks.json`, then `bearing update`): when another live
session edited the same file in the last 30 minutes, the agent is told which one and where. It
never blocks, and nothing lands in any working tree.

`npx bearing status` says what bearing does in a repo: what is always loaded and roughly how many
tokens, each thing that speaks up without being asked, the knob that turns it off and how often it
fired in the last 30 days, and the skills you can invoke.

## 🎨 Prettier — so two tools stop rewriting each other

An install puts up to ~75 tracked, formattable files into your repo — the hook lib alone is 26 `.mjs`
modules — and every one is bearing's, replaced wholesale on the next update. If you format on
commit, Prettier reformats all of them, the next `bearing update` overwrites them back, and that diff
returns every cycle.

If the installer finds Prettier (`.prettierrc*`, `prettier.config.*`, a `prettier` key or
dependency in `package.json`, or just a `.prettierignore`), it **asks** — and quotes back what it
found, since you are being asked to let an installer edit your formatter's config:

```
This repo runs Prettier (found package.json: devDependencies.prettier)
Add 5 bearing-owned paths to .prettierignore?
  1  Yes — stop the two tools rewriting each other's work
  2  No — leave .prettierignore alone (your files, your call)
```

Non-interactive installs decide with `--prettierignore` / `--no-prettierignore`; **saying nothing
means no**, because `.prettierignore` is your repo's configuration and bearing does not edit it
uninvited. The answer is remembered, so an update refreshes the block rather than re-asking, and
`--no-prettierignore` later takes it back out. Only paths bearing **wholly owns** are listed —
`CLAUDE.md` and `AGENTS.md` are yours, so they keep being formatted. Uninstall removes the block,
and deletes the file only if bearing created it.

Stealth installs skip this and say so: `.prettierignore` is a tracked file, and writing it would
break the one promise stealth makes.

## 🥷 Stealth — for repos that aren't yours to change

```bash
npx bearing install . --stealth
```

A normal install is a team decision: it commits hooks, skills, a contract and npm scripts, and
everyone who pulls gets them. That's right for a repo you own and wrong for one you contribute to.

Stealth makes one promise, and it's testable: **`git status` is exactly as clean after the install
as it was before.** No tracked file is modified — not `.gitignore`, not `package.json`, not
`CLAUDE.md`. Ignores go in `.git/info/exclude`, which is per-clone and itself untracked, so the
rules can't travel. The contract is delivered by the session hook instead of a file.

Where a runtime has no per-user channel, bearing says so instead of writing the file anyway. It also
**refuses** to convert a repo where bearing is already committed — un-tracking it for your whole team
is a deliberate, visible act, not something an install flag should do behind your back.

Two things to know: the exclusions live in the clone, so a re-clone doesn't carry the install — run
it again. And uninstall empties only the block it wrote.

---

[← back to the README](../README.md)
