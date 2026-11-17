---
name: bearing-mergiraf
description: "Merge parallel work by syntax tree with mergiraf instead of hand-resolving line conflicts — and review every resolution it made before anything is committed. Use when merging work done in parallel (invasive-minion slices, worktrees, another agent's branch, a long-lived branch), when git reports conflicts where both sides only ADDED something (imports, class members, object keys), or when a merge just auto-resolved and you need to check it. Examples: \"merge the minion slices\", \"merge their branch into mine\", \"resolve these conflicts\", \"did the merge keep both changes?\"."
---

# mergiraf — merge by syntax tree, then review every resolution

Two agents add an import and a method to the same class. Git sees two edits at the same lines and
stops with a conflict. mergiraf parses the base and both sides with tree-sitter, sees two independent
additions, and keeps both — no markers. That is most of the conflicts parallel work produces.

The risk: **it resolves silently.** `git merge` commits the resolution at once, and the only trace is
one `INFO` line on stderr — and **none at all** in a file where any conflict remained: mergiraf still
resolves that file's other conflicts by syntax tree, prints nothing about them, and stores no review case. A resolution nobody read is a decision nobody made. So the rule of this
skill: **every resolution is reviewed by you — the main agent — before it is committed.** Never hand
that review to a subagent: judging whether both sides' intent survived is a decision (NS-24).

## 1. Is it there?

`command -v mergiraf`. If it is missing, **ask the user** to install it (`brew install mergiraf`,
`cargo install --locked mergiraf`, or a release binary from codeberg.org/mergiraf/mergiraf) —
installing software on their machine is their call. Do not run `mergiraf register` or write it into
the global git config without asking: that changes every repository on the machine.

## 2. Merge — per command, nothing configured, never auto-committed

```bash
A=$(mktemp) && mergiraf languages --gitattributes > "$A"
git -c core.attributesFile="$A" -c merge.mergiraf.name=mergiraf \
    -c merge.mergiraf.driver='mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L' \
    merge --no-commit <branch> 2>&1 | tee /tmp/merge.log
```

- **`--no-commit` always.** Without it the auto-resolved merge is committed before anyone looks.
- The same `-c` flags work for `rebase`, `cherry-pick` and `apply --3way` (verified) — but those commit
  each step as they go, so review each `Review with:` id as soon as it is printed.
- Nothing is written to `.git/config` or `.git/info/attributes`; the attributes live in a temp file
  for that one command.

## 3. Review — every resolution, before committing

```bash
grep -o 'mergiraf review [^ ]*' /tmp/merge.log   # one id per file it resolved COMPLETELY
mergiraf review <id>
```

**A file that still has markers got no `Review with:` line** — yet mergiraf may have resolved its other
conflicts. The markers you see are not everything git would have stopped on. Recreate git's own view
and compare, before resolving the rest by hand:

```bash
cp src/a.ts /tmp/a.ts.mergiraf                    # mergiraf's version, partial
git checkout --conflict=diff3 src/a.ts             # git's markers, for EVERY conflict in the file
diff /tmp/a.ts.mergiraf src/a.ts                   # what mergiraf resolved without saying so
```

The diff shows **what plain git would have left** (the conflict markers) against **what mergiraf
wrote**. For each one, check: did both sides' additions survive; is anything duplicated; is the order
right where order matters (registration lists, middleware chains, migrations arrays). Then read the
merged file around each site. Only then commit.

## 4. Then prove it — a clean merge is not a correct merge

Run the typecheck, the tests and the build. Verified: one branch renames `fee` to `cardFee`, another
adds a call to `fee` in a new file — the merge is clean (no conflict for git or for mergiraf) and the
result does not compile. No merge tool can see that; only running the code does.

## 5. What it leaves to you

- **True conflicts** — the same value changed two ways — keep their markers. Resolve them yourself.
- **New top-level statements at the same spot** (two `export const` added after the same line) stay
  conflicted, by design: their order can matter. Resolve by hand.
- **Unsupported files** get git's line merge: check `mergiraf languages` — `.vue`, `.svelte`, `.css`,
  `.scss` and `.sql` are not in it.
- **Conflicts already in a file** (merged before mergiraf was in play): `mergiraf solve <file>` — it
  leaves `<file>.orig` beside it; delete that, never commit it.

## 6. Footprint

Each merge case is kept under `~/.local/share/mergiraf/merges/<id>` — that is what `review` reads.
Outside the repo; nothing to clean up in it.
