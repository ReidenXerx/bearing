---
name: bearing-history
description: "Read git history as EVIDENCE for why code is the way it is — and know where git blame, log -S and log -L quietly point at the wrong commit. Use before changing code whose reason you do not know, before re-proposing something that might have been tried, when asked who/when/why a line or value changed, or when a value looks wrong but might be deliberate. Examples: \"why is this fee 2.9%?\", \"was this tried before?\", \"when did this check get removed?\", \"who changed this and why?\", \"what PR introduced this?\"."
---

# Git history — the evidence for why code is this way

Code says WHAT. History is the only place WHY was ever written down: a commit message, the PR that
merged it, the diff next to it. Before changing something whose reason you do not know — a magic
number, an odd guard, a check that looks redundant — find the commit that made it so. It is cheaper
than reconstructing the reason, and far cheaper than removing a fix someone made on purpose.

The risk is the same as with every search tool: **git answers confidently with the wrong commit.**
Every trap below was run, not read.

## 1. When

| The question | Command |
| --- | --- |
| Why does this line read like this? | `git blame -w -C -C10 -L <a>,<b> <file>`, then `git show <sha>` |
| When did this value / call / string appear or disappear? | `git log -S'<exact text>' --oneline -- <path>` (then read each diff) |
| …and changes that touched it without adding or removing it | `git log -G'<regex>' --oneline -- <path>` |
| How did this one function evolve? | `git log -L '/<start regex>/,/<end regex>/:<file>'` |
| What was the reasoning — the PR, the review? | `gh api repos/{owner}/{repo}/commits/<sha>/pulls -q '.[].number'`, then `gh pr view <n>` |
| Was this idea tried and dropped? | `git log --all --oneline -i --grep='<idea>'` plus `-S` on the name it would have used, and the north-stars graveyard |

## 2. The traps

**Blame names the formatter.** A reformat (reindent, Prettier, a lint `--fix`) touches every line,
so plain `git blame` attributes the line to "style: prettier" — a commit that explains nothing.
`-w` skips whitespace-only changes — and only those. **Prettier re-wraps lines**, which is not a
whitespace change: on a real repo, 44 of the 45 lines one Prettier commit touched still blamed to
it with `-w`. So when blame lands on a commit whose message is about formatting, renaming or moving,
**that is not the answer — look past it**: `git blame --ignore-rev <that sha> -L <a>,<b> <file>`
(verified: it reached the commit that wrote each of those lines), or blame from its parent,
`git blame -w <sha>^ -- <file>`. Many repos keep a `.git-blame-ignore-revs` for exactly this —
`--ignore-revs-file .git-blame-ignore-revs`; read it, never write it uninvited.

**`-C` follows moved code only for blocks of 40+ alphanumeric characters.** A small function moved
to another file blames to the MOVE, and the move commit looks exactly like the origin. `-C -C`
does not fix it; lowering the threshold does: `-C -C10`. Measured: a three-line function moved
between files blamed to the move with `-C`, `-C -C` and `-C -C -C`; `-w -C -C10` reached the commit
that actually set the value.

**`log -S` counts occurrences per file, so a MOVE is a hit.** `-S'0.029'` lists the commit that
changed the value AND the commit that moved it to another file — the count went down in one file and
up in another. `-G` also lists every reformat of the line. Neither is "the commits that changed the
behaviour": read each diff (`git show <sha> -- <path>`) before naming one.

**`log -L :name:file` does not find TypeScript or JavaScript methods.** Git has no built-in
TS/JS function detection; an indented method fails with `fatal: -L parameter 'charge' … no match`.
Use a regex range instead: `git log -L '/async charge(/,/^  }/:src/payment.service.ts'`.
And `-L` stops at a move between files: continue from the old path at the move's parent —
`git log -L '<range>:<old path>' <move-sha>^`.

**A shallow clone has no history, and says nothing about it.** CI checkouts and
`git clone --depth 1` blame EVERY line to one boundary commit, shown with a leading `^`, and `log -S`
"finds" that commit as the origin of everything. Check first: `git rev-parse
--is-shallow-repository`. If `true`, the history answer is unknown — say so, or `git fetch
--unshallow` when the user agrees.

**A squash merge keeps the diff and drops the reasoning.** One commit per PR, its message often
just the title. The review discussion is in the PR: `gh api repos/{owner}/{repo}/commits/<sha>/pulls`
finds it from the sha (works for merge and squash commits alike).

**`--follow` follows a renamed FILE, not moved code,** and only for a single path.

## 3. Reporting it

Cite the commit, not your reading of it: `<sha> <date> "<subject>"` plus the one diff line that
matters, and the PR number if there is one. Separate **"the history says why"** (a message, a PR,
a linked issue) from **"the history says only when"** (a bare diff) — the second is not a reason,
and presenting it as one is the confident wrong answer this skill exists to prevent. If the reason
is a rule a future change would break, propose it as a north-star.
