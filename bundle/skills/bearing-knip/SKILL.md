---
name: bearing-knip
description: "Find unused files, exports and dependencies in a JS/TS project with knip — and tell the dead from the merely invisible before deleting anything. Use when asked what is unused or dead, before deleting a file, export or dependency you believe nothing uses, when cleaning up after a refactor, or when knip's output is to be acted on. Examples: \"what's dead in this repo?\", \"can I delete this file?\", \"is this dependency still used?\", \"clean up unused exports\", \"knip says X is unused — is it?\"."
---

# knip — what is unused, and what only looks unused

knip builds the import graph from the project's entry points and reports everything the graph never
reaches: files, exports, types, dependencies. That is the right question for dead code, and it is
much better than grepping names one at a time.

The risk: **"unreachable from the entry points knip found" is not "unused".** Code loaded by a
string, by a runner knip does not model, or by another package looks exactly as dead as dead code.
Measured on a real NestJS + TypeORM backend: 191 "unused files", 114 of them migrations TypeORM loads
by glob, a dozen more hand-run scripts, load-test scenarios and tests under a second jest config.
Deleting from the raw list deletes live code. So knip produces **candidates**; you produce the verdict.

## 1. Run it — without touching the project

```bash
npx -y knip@latest --reporter json > /tmp/knip.json   # exit 1 = it found something, not an error
npx -y knip@latest --include files                   # one category, human-readable
```

**knip needs Node `^20.19` or `>=22.12`.** On an older Node it crashes (`ERR_REQUIRE_ESM` on stderr),
prints nothing on stdout and exits 1 — the exit code for "found something" — so a `--reporter json`
file comes out empty. An empty result there is not "nothing unused". Check
`node -v` first; with nvm or fnm, run knip under a newer Node for that one command.

Nothing is installed and nothing is added to `package.json`. Do not write a `knip.json` into the
repo unless the user asks for one — put extra configuration in a file OUTSIDE the repo and pass
`--config /path/outside/knip.json` (it takes `entry`, `project`, `ignore`).

## 2. Unused FILES — what makes a live file look dead

Check every candidate against these before calling it dead:

| Loaded by | Looks like | Check |
| --- | --- | --- |
| an ORM glob string (`entities: ['dist/**/*.entity.js']`, `migrations: [...]`, subscribers) | every entity, migration, subscriber | grep the config for `entities`, `migrations`, `subscribers`, `glob` |
| a dynamic import with a template (`` import(`./handlers/${kind}`) ``) | every file in that folder | grep for `import(\`` / `require(` with a variable, in and above the folder |
| a runner knip has no plugin for (k6, a cron, a Procfile, a Dockerfile `CMD`, CI) | the scenario / script | grep the file's path in `Dockerfile*`, `.github/`, `Procfile`, `*.yml`, `package.json` |
| a human (`ts-node scripts/backfill.ts`) | every one-off script | a script someone runs by hand is not dead; ask before deleting `scripts/` |
| a second test config (`jest.db.config.ts`, a custom `testRegex`) | every `*.db-spec.ts` | look for other jest/vitest configs |

**Then prove the rest.** For each remaining candidate, search for its path stem as a STRING across
the whole repo, configs included — `rg -F '<file stem>'` — and read every hit. Glob-loaded and
string-loaded files appear only there.

When you know why something is live, say it to knip rather than filtering by hand each time:
an `entry` in the external config (`"entry": ["src/**/*.entity.ts", "src/migrations/*.ts"]`).
Re-run: the list that remains is the real one. Verified on a fixture: four "unused files" became the
one actually dead file.

## 3. Unused DEPENDENCIES — loaded by name

A package can be used without one `import` of it: a database driver an ORM loads by name, a
`-r`/`--import` preload in a start script, a peer dependency another package requires, a
`NODE_OPTIONS` flag, an OpenTelemetry or APM auto-instrumentation. Grep the package name in
`package.json` scripts, `Dockerfile*`, CI, and env files before removing it.

**Grep the name with its quote.** `rg -F '@nestjs/bull'` also matches every `'@nestjs/bullmq'` —
a prefix match makes a dead package look used. Search `"'@nestjs/bull'"` and `'"@nestjs/bull"'`.

## 4. Unused EXPORTS

The safest category, and the noisiest to act on: an export used only by its own file can usually
lose `export`. Not when it is public API (a library's entry), referenced from a framework by name
(decorator metadata, a DI token string), or imported by a test you were told to keep.

## 5. Deleting

- **Delete in small batches and run what proves it**: typecheck, tests, build — **and boot the
  app**. In a dependency-injection framework (NestJS, Angular) a removed provider compiles cleanly and
  fails at startup.
- One commit per batch, so a wrong deletion reverts alone.
- Report each deletion with its evidence: *"knip: unreachable; `rg` finds no string reference; not in
  any ORM glob, Dockerfile or CI file"*. A candidate you could not clear stays, and you say why.
