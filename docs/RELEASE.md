# Release checklist

Use this checklist before tagging or publishing `bearing`.

## 1. Version and changelog

- [ ] `package.json` version bumped intentionally.
- [ ] `CHANGELOG.md` has an entry for the version.
- [ ] Migration notes are clear for installed repos.

## 2. Privacy / source repo hygiene

- [ ] No private repo names or absolute local paths in public docs/bundle:

  ```bash
  grep -R "<private-term>" README.md docs bundle lib scripts package.json
  grep -R "/Users/" README.md docs bundle lib scripts package.json
  ```

- [ ] `scripts/refresh-bundle-from-source.sh` was run with an explicit source path or `GITNEXUS_BUNDLE_SOURCE`.
- [ ] Source repo basename was replaced with `__GITNEXUS_REPO__` in bundle content.

## 3. Local validation

- [ ] Syntax checks pass:

  ```bash
  bash -n bin/install.sh
  bash -n bin/update.sh
  bash -n bin/uninstall.sh
  node --check lib/kit.mjs
  ```

- [ ] Full tests pass:

  ```bash
  npm test
  ```

- [ ] Setup RUNS, on the runtime a real user gets — the suite passes `runSetup: false`
      everywhere, so `bearing-setup.sh` is only ever exercised here (NS-21):

  ```bash
  GITNEXUS_RUNTIME=all bash scripts/bearing-setup.sh --skip-index   # in a scratch install
  ```

## 4. Install/update/uninstall matrix

Use temporary git repos for each runtime.

- [ ] Fresh install: `--runtime zed --quick --no-setup`
- [ ] Fresh install: `--runtime claude --quick --no-setup`
- [ ] Fresh install: `--runtime codex --quick --no-setup`
- [ ] Fresh install: `--runtime all --quick --no-setup`
- [ ] Feature subset: `--features northstars,taskcore,microscope` — assert NO enforcement gates land
      and every installed hook still runs (a core module must never import a feature module)
- [ ] Upgrade from a legacy `.gnkit/` install — assert north-stars, task-core and per-machine
      config all survive, and that legacy `gitnexus:*` script aliases still resolve
- [ ] `npm pack` → install the tarball in a scratch consumer → run the symlinked binary (catches
      npm's bin-symlink resolution, which silently broke the old bash wrappers)
- [ ] Update a CURSOR-ERA install (1.1.x, `--runtime all`) → assert `.cursor/` is GONE afterwards,
      including `.cursor/mcp.json`, which the adapter wrote and the bundle sweep cannot see
- [ ] Update existing zed-only → `--runtime both --no-setup --skip-verify`
- [ ] `./bin/update.sh --all <tmp-workspace> --runtime both --no-setup --skip-verify`
- [ ] Uninstall preserves unrelated user config.
- [ ] Uninstall with `--remove-index` removes `.gitnexus` local state.

## 5. Target repo smoke

In a real target repo after update:

- [ ] Claude files exist when runtime includes Claude:
  - `.claude/settings.json` (or `settings.local.json` under stealth)
  - `.mcp.json`
  - `.claude/skills/bearing-workspace`
- [ ] Zed files exist when runtime includes Zed:
  - `.zed/settings.json`
  - `.agents/skills/gitnexus-workspace`
  - `AGENTS.md`
- [ ] `npm run bearing:health`
- [ ] `npm run bearing:verify`
- [ ] `npm run bearing:branch-status -- main` or repo base branch

## 6. GitNexus v1.6.8 capability smoke

- [ ] Agent brief shows routing for `trace`, `pdg_query`, `explain`, and Cypher.
- [ ] Pre-commit hook calls `npm run bearing:full-pdg` before `bearing:graph-smoke`.
- [ ] Security review skill warns that no taint/PDG layer is not proof of safety.
- [ ] MCP snippets use current parameter names:
  - `gitnexus_query({ search_query: ... })`
  - `gitnexus_cypher({ statement: ... })`

## 7. Docs

- [ ] `README.md` quick start matches actual CLI flags.
- [ ] `docs/QUICKSTART.md` daily commands are current.
- [ ] `docs/SKILLS.md` lists every canonical skill in `bundle/skills`.
- [ ] `docs/ZED.md` matches the installed Zed profile name.

## 8. Release

- [ ] Commit changes.
- [ ] Tag release.
- [ ] Publish release notes from `CHANGELOG.md`.
- [ ] Update installed repos with:

  ```bash
  ./bin/update.sh --all /path/to/projects --no-setup --skip-verify
  ```
