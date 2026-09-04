import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  listBundleFiles,
  substituteRepoName,
  PLACEHOLDER,
  BUNDLE_ROOT,
  GITIGNORE_MARKER,
  installKit,
  readManifest,
  updateKit,
  uninstallKit,
  findInstalledRepos,
  parseCliArgs,
  e2eNeedsDeps,
  bootstrapE2e,
} from "./kit.mjs";
import { shouldCopyBundleFile } from "./kit-shared.mjs";
import { runPostChecks } from "./postcheck.mjs";
import { listSkillNames } from "./skills.mjs";
import {
  ZED_PROFILE_KEY,
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
  AGENTS_MARKER_BEGIN,
} from "./constants.mjs";
import { migrateLegacyInstall } from "./migrate.mjs";
import { prettierIgnoreLines as prettierIgnoreLinesFor } from "./prettier.mjs";
import { FEATURES, FEATURE_IDS, defaultFeatureIds, applyFeatureDelta, parseFeatures } from "./features.mjs";
import { releasableVersions, readPackagedChangelog } from "./changelog.mjs";
import { mergeGoldPractices, localRules, headlineKeys, GP_BEGIN, GP_END } from "./gold-practices.mjs";
import { excludeLines } from "./stealth.mjs";
import { createRequire } from "node:module";

/**
 * Copy hook files into a tmp repo, routing `lib/*` to the neutral .bearing/lib and entry hooks to
 * .claude/hooks (matching the installed layout).
 *
 * These drove Cursor's `.sh` wrappers until Cursor support was removed — which mattered more than
 * it looked. The gate LOGIC is in .bearing/lib/classify.mjs and always shipped to Claude too, so
 * deleting Cursor deleted the proof and not the behaviour. Claude Code is now the only runtime that
 * enforces at all (NS-14), which makes this the only coverage standing between a gate regression
 * and every user bearing has.
 */
/**
 * Every lib the named ones import, transitively.
 *
 * The caller used to hand-list them, which is a mirror of the real import graph maintained by
 * memory (GP-11). Adding one import to a shipped lib made every hook in these fixtures fail to
 * resolve, crash, and emit nothing — so ten tests failed with `Unexpected end of JSON input`, which
 * names neither the missing file nor the reason.
 */
function libClosure(names) {
  const seen = new Set();
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    let src = "";
    try {
      src = fs.readFileSync(path.join(BUNDLE_ROOT, ".bearing/lib", name), "utf8");
    } catch {
      continue; // not a lib we ship — the caller's list also names .claude/hooks entries
    }
    for (const m of src.matchAll(/from\s+['"]\.\/([\w.-]+\.mjs)['"]/g)) queue.push(m[1]);
    for (const m of src.matchAll(/import\(\s*['"]\.\/([\w.-]+\.mjs)['"]/g)) queue.push(m[1]);
  }
  return [...seen];
}

function copyHookFiles(tmp, entries) {
  fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".claude/hooks"), { recursive: true });
  const libs = libClosure(entries.filter((e) => e.startsWith("lib/")).map((e) => e.slice(4)));
  for (const name of libs) {
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".bearing/lib", name),
      path.join(tmp, ".bearing/lib", name),
    );
  }
  for (const rel of entries) {
    if (rel.startsWith("lib/")) {
      continue; // handled by the closure above
    } else {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".claude/hooks", rel),
        path.join(tmp, ".claude/hooks", rel),
      );
    }
  }
}

/** Create a tmp git repo with hook files copied and a fresh|stale .gitnexus/meta.json. */
function setupKitRepo({ fresh = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-kit-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email test@test.com", { cwd: tmp });
  execSync("git config user.name test", { cwd: tmp });
  fs.writeFileSync(path.join(tmp, "f.txt"), "x");
  execSync("git add f.txt && git commit -q -m init", { cwd: tmp, shell: true });
  const head = execSync("git rev-parse HEAD", {
    cwd: tmp,
    encoding: "utf8",
  }).trim();

  fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".gitnexus/meta.json"),
    JSON.stringify({
      lastCommit: fresh ? head : "deadbeef",
      stats: { nodes: 50, embeddings: 50 },
    }),
  );

  // These fixtures exist to exercise the STALENESS GATE, which is opt-in now (default "off", because
  // the judgement about when a graph is too far behind to answer with was not good enough to spend
  // the user's attention on). Turning it on here keeps them testing what they were written for.
  fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".bearing/hooks.json"),
    JSON.stringify({ stalenessGate: "block" }),
  );

  copyHookFiles(tmp, [
    "bearing-edit-guard.mjs",
    "bearing-bash-guard.mjs",
    "lib/first-nudge.mjs",
    "lib/load-staleness.mjs",
    "lib/check-staleness.mjs",
    "lib/hook-helpers.mjs",
    "lib/cypher-helpers.mjs",
    "lib/rename-helpers.mjs",
    "lib/stale-policy.mjs",
    "lib/session-primer.mjs",
    "lib/classify.mjs",
    "lib/claude-emit.mjs",
  ]);
  return tmp;
}

/**
 * Run a Claude hook the way Claude Code runs it: node, JSON on stdin, JSON on stdout, and
 * CLAUDE_PROJECT_DIR set — without that last one the hook resolves the wrong root and "proves" a
 * working gate broken (GP-7, and it has happened here before).
 */
function runHook(tmp, script, input) {
  const r = spawnSync("node", [path.join(tmp, ".claude/hooks", script)], {
    cwd: tmp,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
  });
  return verdictOf(JSON.parse((r.stdout || "{}").trim() || "{}"));
}

/**
 * Claude's PreToolUse shape, flattened to the verdict the assertions care about.
 * Silence is ALLOW: a hook that decides not to block exits 0 printing nothing.
 */
function verdictOf(out) {
  const h = out.hookSpecificOutput ?? {};
  return {
    permission: h.permissionDecision ?? (out.decision === "block" ? "deny" : "allow"),
    agent_message: h.permissionDecisionReason ?? out.reason ?? h.additionalContext ?? "",
  };
}

describe("bearing", () => {
  it("bundle contains flat canonical skills", () => {
    const names = listSkillNames(path.join(BUNDLE_ROOT, "skills"));
    assert.ok(names.includes("bearing-enforcement"));
    assert.ok(names.includes("bearing-workspace"));
    assert.ok(names.includes("bearing-local"));
    assert.ok(names.length >= 12);
  });

  it("runtime filter ships the shared libs for zed-only", () => {
    assert.equal(
      shouldCopyBundleFile(".bearing/lib/agent-health.mjs", "zed"),
      true,
    );
    assert.equal(
      shouldCopyBundleFile(".bearing/hooks.json", "zed"),
      true,
    );
    assert.equal(
      shouldCopyBundleFile("scripts/bearing-agent.mjs", "zed"),
      true,
    );
  });

  it("migrateLegacyInstall cleans old rsync skills, manifest, zed profile", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-migrate-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(
      path.join(tmp, ".gitignore"),
      "# GitNexus + cursor-gitnexus-kit generated local state\n.cursor/skills/\n",
    );
    fs.mkdirSync(path.join(tmp, ".cursor/skills/bearing-workspace"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmp, ".cursor/skills/bearing-workspace/SKILL.md"),
      "legacy copy",
    );
    fs.mkdirSync(path.join(tmp, ".claude/skills/bearing-workspace"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmp, ".claude/skills/bearing-workspace/SKILL.md"),
      "claude copy",
    );
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, MANIFEST_PATH_LEGACY),
      JSON.stringify({
        version: 1,
        files: [".claude/skills/bearing-workspace/SKILL.md"],
      }),
    );
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, MANIFEST_PATH),
      JSON.stringify({ version: 2, runtime: "both", files: [] }),
    );
    fs.mkdirSync(path.join(tmp, ".zed"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".zed/settings.json"),
      JSON.stringify({
        agent: {
          profiles: { gitnexus: { name: "GitNexus", tools: { grep: false } } },
        },
      }),
    );

    const res = migrateLegacyInstall(tmp, "both");
    assert.ok(res.actions.length > 0);
    assert.ok(
      !fs.existsSync(path.join(tmp, ".cursor/skills/bearing-workspace")),
    );
    assert.ok(
      !fs.existsSync(path.join(tmp, ".claude/skills/bearing-workspace")),
    );
    assert.ok(
      fs
        .readFileSync(path.join(tmp, ".gitignore"), "utf8")
        .includes(GITIGNORE_MARKER),
    );
    const zed = JSON.parse(
      fs.readFileSync(path.join(tmp, ".zed/settings.json"), "utf8"),
    );
    assert.ok(zed.agent.profiles[ZED_PROFILE_KEY]);
    assert.equal(zed.agent.profiles[ZED_PROFILE_KEY].name, "Zed + GitNexus");
    assert.equal(zed.agent.profiles.gitnexus, undefined);
    assert.ok(!fs.existsSync(path.join(tmp, MANIFEST_PATH_LEGACY)));

    installKit(tmp, {
      runtime: "both",
      quick: true,
      runSetup: false,
      skipVerify: true,
    });
    const skillLink = path.join(tmp, ".claude/skills/bearing-workspace");
    assert.ok(fs.lstatSync(skillLink).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(tmp, MANIFEST_PATH)));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a `>` inside a string is not a file write (all three nudges share this)", async () => {
    // `bashWritesFiles` tested the RAW command, so any `>` in a string or a script body counted as
    // a redirect. A read-only audit agent that edited nothing was told "25 edits since your
    // task-core was last written", and consult can burn its one-per-session budget on a `git log`.
    const { bashWritesFiles } = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    for (const cmd of [
      'node -e "all.filter(l => l.length > 200)"',
      'node -e "if (x > 5) console.log(1)"',
      'git log --pretty=format:"%h %an <%ae>"',
      'jq ".items[] | select(.n>3)"',
      "cat a.txt > /dev/null",
      "npm test 2>&1",
    ]) {
      assert.equal(bashWritesFiles(cmd), false, `counted as an edit: ${cmd}`);
    }
    // ...and the negative case, or this would pass by simply always returning false (NS-12).
    for (const cmd of [
      "echo hi > out.txt",
      "sed -i s/a/b/ f.js",
      "cp a b",
      "python3 - <<'PY'\nopen('x','w')\nPY",
    ]) {
      assert.equal(bashWritesFiles(cmd), true, `a real write went uncounted: ${cmd}`);
    }
  });

  it("the north-star counter is per CHAT, not per repo", async () => {
    // Its neighbours `.bearing-microscope-<key>.json` and `.bearing-consult-<key>.flag` were keyed
    // and this one was not, so every concurrent agent bumped one shared counter: N sessions fired
    // N times the anchors, each landing in whichever agent happened to make the 25th call rather
    // than the one that drifted. One repo's telemetry shows 391 anchors against 8 impact gates
    // fleet-wide. Same correction the task-core already carries.
    const { bumpNorthStarCounter } = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-nsctr-"));
    const A = "/x/chatA.jsonl";
    const B = "/x/chatB.jsonl";
    assert.equal(bumpNorthStarCounter(tmp, false, A), 1);
    assert.equal(bumpNorthStarCounter(tmp, false, A), 2);
    assert.equal(bumpNorthStarCounter(tmp, false, B), 1, "chat B saw chat A's count");
    assert.equal(bumpNorthStarCounter(tmp, false, A), 3, "chat A was advanced by chat B");
    bumpNorthStarCounter(tmp, true, A);
    assert.equal(bumpNorthStarCounter(tmp, false, B), 2, "resetting chat A reset chat B too");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the gate allows what its own graph cannot contain (NS-5)", async () => {
    // Three false denies from the field log, all the same shape: the classifier reasoned about
    // staleness and path shape but never about INDEX SCOPE. `.gitnexusignore` excludes `.bearing/`,
    // so reading the kit's own hook library was denied and redirected to a graph with zero rows for
    // it; an absolute path outside the root cannot be in this repo's index at all; and a grep over
    // ONE FILE that happens to contain `a|b|c` is not repo-wide symbol discovery.
    const { classifyGrep, classifyRead } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const { loadHookConfig } = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const root = path.dirname(fileURLToPath(new URL("../lib/kit.mjs", import.meta.url)));
    const repoRoot = path.dirname(root);
    const ctx = { phase: "fresh", repo: "bearing", root: repoRoot, config: loadHookConfig(repoRoot) };
    const grep = (pattern, p) =>
      classifyGrep({ tool: "Grep", toolInput: { pattern, ...(p ? { path: p } : {}) } }, ctx).decision;
    const read = (file) =>
      classifyRead(
        { toolInput: { file_path: file } },
        { ...ctx, readLines: () => 900, isUntracked: () => false },
      ).decision;

    assert.equal(read(`${repoRoot}/bundle/.bearing/lib/classify.mjs`), "allow", "denied its own lib");
    assert.equal(read("/some/other/repo/src/index.ts"), "allow", "denied another repo's file");
    assert.equal(read(`${repoRoot}/node_modules/pkg/lib/index.js`), "allow", "denied a dependency");
    assert.equal(grep("pass|fail|tests", "run.txt"), "allow", "denied an alternation in one .txt");

    // NEGATIVE — the gate must still be a gate (NS-12).
    assert.equal(read(`${repoRoot}/lib/kit.mjs`), "deny", "stopped gating this repo's own source");
    assert.equal(grep("handlePayment"), "deny", "stopped gating a repo-wide symbol sweep");
  });

  it("a repo's OWN .e2e/ harness is never replaced by ours (NS-1, NS-22)", () => {
    // `--features all` selects e2e, and the README and `--help` both advertise that spelling. Into
    // a repo that already has a harness it replaced `core/report.js` with bearing's factory API,
    // so every `verify/*.js` importing the old names died with `check is not a function` on its
    // next run — while the install exited 0 and printed success. Backups meant nothing was LOST,
    // but the project's e2e suite was broken until somebody noticed. Five of the ten repos on the
    // author's machine have their own harness.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-e2e-theirs-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"has-harness"}\n');
    fs.mkdirSync(path.join(tmp, ".e2e/core"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".e2e/verify"), { recursive: true });
    const theirs = 'module.exports = { check(n, ok) {}, done() {} };\n';
    fs.writeFileSync(path.join(tmp, ".e2e/core/report.js"), theirs);
    fs.writeFileSync(
      path.join(tmp, ".e2e/verify/theirs.js"),
      'const { check, done } = require("../core/report");\ncheck("x", true);\ndone();\n',
    );
    execSync("git add -A && git commit -qm harness", { cwd: tmp, shell: true });

    const m = installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    assert.equal(
      fs.readFileSync(path.join(tmp, ".e2e/core/report.js"), "utf8"),
      theirs,
      "bearing overwrote a harness it did not create",
    );
    assert.ok(!m.features.includes("e2e"), "e2e was installed over someone else's harness");
    assert.equal(m.ownsE2e, false, "the answer only a first install can give was not recorded");
    // Their verifier still runs against their own API.
    const r = spawnSync(process.execPath, [".e2e/verify/theirs.js"], { cwd: tmp, encoding: "utf8" });
    assert.equal(r.status, 0, `their verifier broke:\n${r.stdout}\n${r.stderr}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("bearing keeps its own .e2e/ across updates — the record is sticky (NS-22)", () => {
    // The mirror image: by the second run `.e2e/` exists BECAUSE WE MADE IT, so re-deriving
    // ownership would read our own artifact as the user's and disable the module forever.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-e2e-ours-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"no-harness"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: true });

    const first = installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    assert.ok(first.features.includes("e2e"), "a repo with no .e2e/ did not get the module");
    assert.equal(first.ownsE2e, true);
    const after = updateKit(tmp, { quick: true, runSetup: false, skipVerify: true });
    assert.ok(after.features.includes("e2e"), "the update disabled a module bearing itself installed");
    assert.ok(fs.existsSync(path.join(tmp, ".e2e/core/report.js")));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("migration never deletes a skill or hook lib it cannot prove is ours (NS-1)", () => {
    // Two unconditional `rm -rf`s, both reachable on a FIRST install. The skills one matched on
    // NAME ALONE, so a team's own `.claude/skills/bearing-pr/` was deleted for a module they had
    // not installed — and the collision surface grew with every module added. The hook-lib one
    // fired even though bearing no longer creates `.cursor/hooks/` at all, so on a repo it had
    // never been in, that directory was the user's.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-ns1-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"theirs"}\n');
    fs.mkdirSync(path.join(tmp, ".claude/skills/bearing-pr"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".cursor/hooks/lib"), { recursive: true });
    const skill = "# OUR pr skill, nothing to do with bearing\n";
    const helper = "#!/usr/bin/env bash\necho mine\n";
    fs.writeFileSync(path.join(tmp, ".claude/skills/bearing-pr/SKILL.md"), skill);
    fs.writeFileSync(path.join(tmp, ".cursor/hooks/lib/my-helper.sh"), helper);
    execSync("git add -A && git commit -qm mine", { cwd: tmp, shell: true });

    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    // The name is needed for our symlink, so it is MOVED aside, never destroyed — the same
    // `.bearing-backup` convention the bundle copy uses when it meets a file it did not write.
    const aside = path.join(tmp, ".claude/skills/bearing-pr.bearing-backup/SKILL.md");
    const inPlace = path.join(tmp, ".claude/skills/bearing-pr/SKILL.md");
    const survived =
      (fs.existsSync(aside) && fs.readFileSync(aside, "utf8") === skill) ||
      (fs.existsSync(inPlace) && fs.readFileSync(inPlace, "utf8") === skill);
    assert.ok(survived, "a user-authored skill was deleted because its NAME matched one of ours");
    assert.equal(
      fs.readFileSync(path.join(tmp, ".cursor/hooks/lib/my-helper.sh"), "utf8"),
      helper,
      "deleted a hook-lib directory bearing never created",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("updating a Cursor-era install removes .cursor/, adapter residue included", () => {
    // MEASURED end-to-end before this test existed: a real 1.1.6 `--runtime all` install writes 17
    // files under .cursor/, and updating it from this tree removed 16. The survivor was
    // `.cursor/mcp.json` — the ADAPTER wrote that one, the way .zed/settings.json is written rather
    // than copied, so the "the bundle no longer ships this" sweep never saw it and Cursor stayed
    // pointed at the GitNexus MCP server forever. An empty .cursor/skills/ was left with it.
    //
    // The legacy state is BUILT here rather than installed from the old package: the point is what
    // an update finds on disk, and the old tree is not available to a test.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cursor-era-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"legacy-app"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: true });
    installKit(tmp, { runtime: "all", features: "all", runSetup: false, skipVerify: true });

    const legacy = [
      [".cursor/hooks.json", '{"hooks":{"preToolUse":[]}}\n'],
      [".cursor/hooks/bearing-grep-guard.sh", "#!/usr/bin/env bash\nexit 0\n"],
      [".cursor/rules/00-bearing-enforcement.mdc", "---\nalwaysApply: true\n---\n"],
    ];
    for (const [rel, body] of legacy) {
      fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), body);
    }
    // Bundle-copied files are recorded in the manifest, which is how the sweep finds them. The two
    // below are NOT, because nothing copied them — that asymmetry IS the defect.
    const mPath = path.join(tmp, MANIFEST_PATH);
    const m = JSON.parse(fs.readFileSync(mPath, "utf8"));
    m.files = [...(m.files ?? []), ...legacy.map(([rel]) => rel)];
    fs.writeFileSync(mPath, JSON.stringify(m, null, 2));

    fs.writeFileSync(
      path.join(tmp, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { gitnexus: { command: "gitnexus", args: ["mcp"] } } }, null, 2),
    );
    fs.mkdirSync(path.join(tmp, ".cursor/skills"), { recursive: true });
    fs.symlinkSync(
      path.join(tmp, ".bearing/skills/bearing-workspace"),
      path.join(tmp, ".cursor/skills/bearing-workspace"),
    );

    updateKit(tmp, { quick: true, runSetup: false, skipVerify: true });
    assert.ok(
      !fs.existsSync(path.join(tmp, ".cursor")),
      `.cursor/ survived the update: ${fs.existsSync(path.join(tmp, ".cursor")) ? fs.readdirSync(path.join(tmp, ".cursor")).join(", ") : ""}`,
    );

    // Twice must converge (NS-3) — the second pass has nothing to remove and must not throw.
    updateKit(tmp, { quick: true, runSetup: false, skipVerify: true });
    assert.ok(!fs.existsSync(path.join(tmp, ".cursor")), "the second update re-created .cursor/");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a user's own Cursor MCP servers survive the cleanup that removes ours (NS-1)", () => {
    // The file is THEIRS. Deleting it wholesale because it has our entry in it is the same class of
    // mistake as uninstall once deleting the user's north-stars because .bearing/ looked kit-owned.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cursor-mine-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"mine"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: true });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    fs.mkdirSync(path.join(tmp, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".cursor/mcp.json"),
      JSON.stringify({
        mcpServers: {
          gitnexus: { command: "gitnexus", args: ["mcp"] },
          theirs: { command: "their-server" },
        },
      }, null, 2),
    );

    updateKit(tmp, { quick: true, runSetup: false, skipVerify: true });
    const cfg = JSON.parse(fs.readFileSync(path.join(tmp, ".cursor/mcp.json"), "utf8"));
    assert.equal(cfg.mcpServers.theirs?.command, "their-server", "removed a server bearing never wrote");
    assert.equal(cfg.mcpServers.gitnexus, undefined, "left our own server behind");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("installKit zed runtime wires Zed + skill symlinks", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-zed-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", {
      cwd: tmp,
      shell: true,
    });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", {
      cwd: tmp,
      shell: true,
    });
    installKit(tmp, {
      runtime: "zed",
      quick: true,
      runSetup: false,
      skipVerify: true,
    });
    assert.ok(fs.existsSync(path.join(tmp, ".zed/settings.json")));
    assert.ok(
      fs.existsSync(path.join(tmp, ".bearing/lib/agent-health.mjs")),
      "zed-only installs shared health helpers used by scripts/bearing-agent.mjs",
    );
    const zed = JSON.parse(
      fs.readFileSync(path.join(tmp, ".zed/settings.json"), "utf8"),
    );
    assert.ok(zed.context_servers?.gitnexus);
    // Portable command — must NOT hardcode a machine-specific absolute path into
    // the committed .zed/settings.json (breaks other teammates).
    //
    // Asserting the literal "npx" made this host-dependent, exactly as the stdio test below warns:
    // the default now RESOLVES an installed gitnexus, so the right property is "a bare, portable
    // command that matches what every other adapter writes", not one particular spelling.
    const { mcpEntry: expectEntry } = await import(
      new URL("./mcp-config.mjs", import.meta.url).href
    );
    assert.equal(
      zed.context_servers.gitnexus.command,
      expectEntry({ mode: "stdio" }).command,
      "Zed must write the same binary the other adapters do",
    );
    assert.ok(
      !zed.context_servers.gitnexus.command.startsWith("/"),
      "a resolved absolute path in committed settings breaks every teammate",
    );

    // http: Zed's context_servers value is an untagged enum, so the remote variant is selected by
    // `url` being present and `command` being absent. Zed project settings override user settings,
    // so getting this wrong is what kept Zed spawning a second analyzer per repo.
    const httpTmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-zedhttp-"));
    execSync("git init -q", { cwd: httpTmp });
    installKit(httpTmp, {
      runtime: "zed",
      features: "gitnexus",
      mcpTransport: { mode: "http", url: "http://127.0.0.1:39100/mcp" },
      runSetup: false,
      skipVerify: true,
    });
    const zedHttp = JSON.parse(
      fs.readFileSync(path.join(httpTmp, ".zed/settings.json"), "utf8"),
    ).context_servers.gitnexus;
    assert.deepEqual(zedHttp, { url: "http://127.0.0.1:39100/mcp" });
    assert.ok(!("command" in zedHttp), "a stray command key would select the local variant");
    fs.rmSync(httpTmp, { recursive: true, force: true });
    assert.ok(
      !/(^|["/])(Users|home)\//.test(JSON.stringify(zed.context_servers.gitnexus)),
      "no hardcoded absolute path in zed context_servers",
    );
    assert.ok(zed.agent?.profiles?.[ZED_PROFILE_KEY]);
    assert.equal(zed.agent.profiles[ZED_PROFILE_KEY].name, "Zed + GitNexus");
    assert.ok(
      fs
        .readFileSync(path.join(tmp, "AGENTS.md"), "utf8")
        .includes(AGENTS_MARKER_BEGIN),
    );
    assert.ok(
      fs.existsSync(
        path.join(tmp, ".agents/skills/bearing-workspace/SKILL.md"),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(
          tmp,
          ".bearing/skills/bearing-workspace/SKILL.md",
        ),
      ),
    );
    const m = readManifest(tmp);
    assert.equal(m?.data.runtime, "zed");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("installKit claude runtime wires MCP, hooks, CLAUDE.md, skills", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-claude-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", {
      cwd: tmp,
      shell: true,
    });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", { cwd: tmp, shell: true });
    installKit(tmp, {
      runtime: "claude",
      quick: true,
      runSetup: false,
      skipVerify: true,
    });
    // MCP via project .mcp.json
    const mcp = JSON.parse(fs.readFileSync(path.join(tmp, ".mcp.json"), "utf8"));
    assert.ok(mcp.mcpServers?.gitnexus, ".mcp.json has gitnexus server");
    // Hooks in .claude/settings.json
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8"),
    );
    const pre = settings.hooks?.PreToolUse ?? [];
    assert.ok(
      pre.some((g) => /bearing-grep-guard/.test(g.hooks?.[0]?.command ?? "")),
      "PreToolUse has the grep guard",
    );
    assert.ok(
      pre.some((g) => g.matcher === "Bash"),
      "PreToolUse gates Bash (commit gate)",
    );
    assert.ok(settings.hooks?.SessionStart?.length, "SessionStart hook wired");
    // Always-on contract in CLAUDE.md
    assert.ok(
      fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8").includes("GitNexus"),
    );
    // Skills symlinked into .claude/skills; shared hook lib shipped; no Cursor hooks.
    assert.ok(
      fs.existsSync(path.join(tmp, ".claude/skills/bearing-workspace/SKILL.md")),
    );
    assert.ok(
      fs.existsSync(path.join(tmp, ".claude/hooks/bearing-grep-guard.mjs")),
    );
    assert.ok(
      fs.existsSync(path.join(tmp, ".bearing/lib/classify.mjs")),
      "shared classify core ships for claude",
    );
    const m = readManifest(tmp);
    assert.equal(m?.data.runtime, "claude");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("claude grep guard denies a symbol search via Claude's hook protocol", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-claude-hook-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", {
      cwd: tmp,
      shell: true,
    });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", { cwd: tmp, shell: true });
    const head = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: head, stats: { nodes: 50, embeddings: 50 } }),
    );
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".claude/hooks"), { recursive: true });
    for (const f of libClosure([
      "classify.mjs",
      "claude-emit.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "session-primer.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ])) {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".bearing/lib", f),
        path.join(tmp, ".bearing/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/bearing-grep-guard.mjs"),
      path.join(tmp, ".claude/hooks/bearing-grep-guard.mjs"),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(tmp, ".claude/hooks/bearing-grep-guard.mjs")],
      {
        cwd: tmp,
        input: JSON.stringify({
          tool_name: "Grep",
          tool_input: { pattern: "UserService" },
        }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      },
    );
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes("gitnexus_context"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("updateKit can upgrade zed-only install to both runtimes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-upboth-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", {
      cwd: tmp,
      shell: true,
    });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", {
      cwd: tmp,
      shell: true,
    });
    installKit(tmp, {
      runtime: "zed",
      quick: true,
      runSetup: false,
      skipVerify: true,
    });
    const manifest = updateKit(tmp, {
      runtime: "both",
      quick: true,
      runSetup: false,
      skipVerify: true,
    });
    assert.equal(manifest.runtime, "both");
    assert.ok(fs.existsSync(path.join(tmp, ".mcp.json")));
    assert.ok(fs.existsSync(path.join(tmp, ".zed/settings.json")));
    assert.ok(
      fs.existsSync(
        path.join(tmp, ".agents/skills/bearing-workspace/SKILL.md"),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(tmp, ".claude/skills/bearing-workspace/SKILL.md"),
      ),
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("findInstalledRepos discovers kit manifests under a workspace root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gn-find-"));
    const repo = path.join(root, "repo-a");
    fs.mkdirSync(path.join(repo, path.dirname(MANIFEST_PATH)), { recursive: true });
    fs.writeFileSync(
      path.join(repo, MANIFEST_PATH),
      JSON.stringify({ runtime: "both" }),
    );
    fs.mkdirSync(path.join(root, "repo-b", "node_modules", "skip"), {
      recursive: true,
    });
    const found = findInstalledRepos(root);
    assert.deepEqual(found, [repo]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("bundle contains the enforcement skill and hook libs", () => {
    const files = listBundleFiles();
    assert.ok(
      files.includes("skills/bearing-enforcement/SKILL.md"),
      `expected the enforcement skill in bundle, got: ${files.filter((f) => f.includes("enforcement")).join(", ")}`,
    );
    assert.ok(files.includes(".bearing/lib/load-staleness.mjs"));
    assert.ok(fs.existsSync(BUNDLE_ROOT));
  });

  it("release and skills docs are present", () => {
    assert.ok(fs.existsSync(path.join(BUNDLE_ROOT, "docs/GITNEXUS-SKILLS.md")));
    assert.ok(fs.existsSync(new URL("../docs/SKILLS.md", import.meta.url)));
    assert.ok(fs.existsSync(new URL("../docs/RELEASE.md", import.meta.url)));
    assert.ok(fs.existsSync(new URL("../CHANGELOG.md", import.meta.url)));
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    // Don't pin the literal version — that guarantees a broken test on every release. Assert the
    // shape, and that the CHANGELOG actually documents whatever version we are shipping.
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "valid semver");
    const changelog = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const major = pkg.version.split(".").slice(0, 2).join(".");
    assert.ok(
      changelog.includes(`## ${pkg.version}`) || changelog.includes(`## ${major}.`),
      `CHANGELOG has no entry for ${pkg.version}`,
    );
  });

  it("substituteRepoName replaces placeholder", () => {
    const out = substituteRepoName(`repo: "${PLACEHOLDER}"`, "my-app");
    assert.equal(out, 'repo: "my-app"');
    assert.ok(!out.includes(PLACEHOLDER));
  });

  it("the generated contracts use the placeholder, not a hardcoded repo", () => {
    // Cursor's always-on rule was the third generated output, and the one that actually shipped
    // three literal __GITNEXUS_REPO__ placeholders. It is gone. The two that remain are the only
    // surfaces an agent meets the contract on, so BOTH are asserted — `find` returned whichever
    // came first, which is how a second output can rot unnoticed.
    for (const rel of ["templates/CLAUDE.gitnexus.md", "templates/AGENTS.gitnexus.md"]) {
      const rule = fs.readFileSync(path.join(BUNDLE_ROOT, rel), "utf8");
      assert.ok(rule.includes(PLACEHOLDER), `${rel} lost the repo placeholder`);
      assert.ok(!rule.includes("private production repo"), `${rel} hardcodes a repo`);
    }
  });

  it("bundle includes docs required by gitnexus-setup.sh", () => {
    const files = listBundleFiles();
    assert.ok(files.includes("docs/GITNEXUS-TEAM-BUNDLE.md"));
    assert.ok(files.includes("docs/GITNEXUS-SKILLS.md"));
    assert.ok(
      files.includes("scripts/bearing-teaching/merge-package-scripts.mjs"),
    );
    assert.ok(!files.includes(".claude/skills/agent-region/SKILL.md"));
    assert.ok(
      !files.includes("scripts/bearing-teaching/generate-regions.mjs"),
    );
  });

  it("bundle includes agent reasoning shortcuts", () => {
    const files = listBundleFiles();
    assert.ok(files.includes(".bearing/lib/hook-helpers.mjs"));
    assert.ok(files.includes(".bearing/lib/cypher-helpers.mjs"));
    assert.ok(files.includes(".bearing/lib/rename-helpers.mjs"));
    assert.ok(files.includes(".bearing/lib/detect-api-router.mjs"));
    assert.ok(files.includes(".bearing/lib/graph-smoke.mjs"));
    assert.ok(files.includes(".bearing/lib/agent-brief.mjs"));
    assert.ok(files.includes(".bearing/lib/agent-health.mjs"));
    assert.ok(files.includes(".bearing/lib/persistence-health.mjs"));
    assert.ok(files.includes(".bearing/lib/session-health-audit.mjs"));
    assert.ok(files.includes(".bearing/hooks.json"));
    assert.ok(files.includes("skills/bearing-security-review/SKILL.md"));
    const brief = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".bearing/lib/agent-brief.mjs"),
      "utf8",
    );
    assert.ok(brief.includes("Skill routing:"));
    assert.ok(brief.includes("bearing-security-review"));
  });

  it("hook-helpers builds copy-paste MCP calls", async () => {
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url)
        .href
    );
    const call = helpers.mcpContext("fooBar", "my-repo");
    assert.ok(call.includes("gitnexus_context"));
    assert.ok(call.includes("fooBar"));
    assert.ok(call.includes("my-repo"));
    const guided = helpers.applyHookMode(
      { permission: "deny", agent_message: "x" },
      "guide",
    );
    assert.equal(guided.permission, "allow");
    const q = helpers.mcpQuery({
      query: "auth",
      taskContext: "t",
      goal: "g",
      repo: "r",
    });
    assert.ok(q.includes("search_query"));
    assert.ok(!q.includes("{ query:"));
    assert.ok(q.includes("limit: 5"));
    assert.ok(q.includes("max_symbols: 12"));
    assert.ok(
      helpers.mcpContext("Foo", "r").includes("include_content: false"),
    );
    assert.ok(helpers.mcpImpact("Foo", "r").includes("summaryOnly: false"));
    const widened = helpers.mcpImpact("Foo", "r", {
      relationTypes: ["CALLS", "ACCESSES"],
    });
    assert.ok(widened.includes('relationTypes: ["CALLS", "ACCESSES"]'));
    assert.ok(helpers.mcpTrace("A", "B", "r").includes("gitnexus_trace"));
    assert.ok(helpers.mcpPdgImpact("A", "r").includes('mode: "pdg"'));
    assert.ok(
      helpers.mcpPdgFlows("A", "r", "payload").includes("gitnexus_pdg_query"),
    );
    assert.ok(helpers.mcpPdgControls("A", "r").includes('mode: "controls"'));
    assert.ok(
      helpers.mcpTaintExplain("src/app.ts", "r").includes("gitnexus_explain"),
    );
    const full = helpers.hookAgentMessage(
      "/tmp/gn-test-deny",
      "k1",
      "FULL",
      "SHORT",
    );
    assert.equal(full, "FULL");
    const again = helpers.hookAgentMessage(
      "/tmp/gn-test-deny",
      "k1",
      "FULL",
      "SHORT",
    );
    assert.equal(again, "FULL");
    helpers.clearDenyCache("/tmp/gn-test-deny");
    const msg = helpers.userMessage("block.grep.symbol", { symbol: "fooBar" });
    assert.ok(msg.includes("fooBar"));
    assert.ok(msg.includes("GitNexus"));
  });

  it("cypher-helpers builds field access and call chain queries", async () => {
    const cypher = await import(
      new URL("../bundle/.bearing/lib/cypher-helpers.mjs", import.meta.url)
        .href
    );
    assert.ok(cypher.isLikelyFieldName("address"));
    assert.ok(!cypher.isLikelyFieldName("UserService"));
    assert.ok(!cypher.isLikelyFieldName("const"));
    const field = cypher.cypherFieldAccess("address", "my-repo");
    assert.ok(field.includes("gitnexus_cypher"));
    assert.ok(field.includes("statement"));
    assert.ok(!field.includes("{ query:"));
    assert.ok(field.includes("ACCESSES"));
    assert.ok(field.includes("address"));
    const chain = cypher.cypherCallChain("validatePayment", "my-repo", 3);
    assert.ok(chain.includes("CALLS"));
    assert.ok(chain.includes("validatePayment"));
    assert.ok(cypher.mcpReadSchema("r").includes("/schema"));
    assert.ok(
      cypher.mcpTrace("Controller", "sink", "r").includes("gitnexus_trace"),
    );
    assert.ok(cypher.mcpPdgImpact("Controller", "r").includes('mode: "pdg"'));
    assert.ok(
      cypher.mcpTaintExplain("Controller", "r").includes("gitnexus_explain"),
    );
    const pb = cypher.playbookCypherForHint(
      { fieldHint: "token", fieldRead: true },
      "r",
    );
    assert.ok(pb.includes("PLAYBOOK"));
    assert.ok(pb.includes("ACCESSES"));
  });

  it("rename-helpers and data-flow detection", async () => {
    const rename = await import(
      new URL("../bundle/.bearing/lib/rename-helpers.mjs", import.meta.url)
        .href
    );
    const cypher = await import(
      new URL("../bundle/.bearing/lib/cypher-helpers.mjs", import.meta.url)
        .href
    );
    const parsed = rename.parseRenameFromPrompt(
      "rename validateUser to authenticateUser",
    );
    assert.equal(parsed?.oldName, "validateUser");
    assert.equal(parsed?.newName, "authenticateUser");
    const pair = rename.detectIdentifierRename("fooBar", "bazQux");
    assert.equal(pair?.oldName, "fooBar");
    assert.ok(rename.mcpRename("A", "B", "r").includes("dry_run: true"));
    assert.ok(cypher.isDataFlowReadContext({ dataFlow: true }, "src/foo.js"));
    assert.ok(cypher.isDataFlowReadContext({}, "src/models/User.ts"));
  });

  it("detect-api-router writes profile from heuristics", async () => {
    const { detectApiRouterProfile, writeApiRouterProfile, API_PROFILE_FILE } =
      await import(
        new URL(
          "../bundle/.bearing/lib/detect-api-router.mjs",
          import.meta.url,
        ).href
      );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-api-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "src", "server.js"),
      "import express from 'express';\nconst app = express();\napp.get('/api', handler);\n",
    );
    const p = detectApiRouterProfile(tmp, "test-repo");
    assert.ok(["framework-likely", "framework", "unknown"].includes(p.profile));
    writeApiRouterProfile(tmp, "test-repo");
    assert.ok(fs.existsSync(path.join(tmp, API_PROFILE_FILE)));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("gitignore marker migrates: a legacy block is REPLACED, not duplicated", async () => {
    // The marker carries the product name, so renaming it would orphan the block written by every
    // previous version — the strip step matches on the marker, so an unrecognised one is left in
    // place and a second managed block appended beside it.
    const { appendGitignore } = await import("./kit.mjs");
    const { GITIGNORE_MARKERS_LEGACY } = await import("./constants.mjs");
    assert.ok(GITIGNORE_MARKER.includes("bearing"));
    assert.ok(GITIGNORE_MARKERS_LEGACY.length > 0, "history must be remembered");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gi-legacy-"));
    fs.writeFileSync(
      path.join(tmp, ".gitignore"),
      `node_modules/\n\n${GITIGNORE_MARKERS_LEGACY[0]}\n.gitnexus/\n.tmp-agent/\n`,
    );
    appendGitignore(tmp, "all");
    const gi = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    assert.ok(!gi.includes(GITIGNORE_MARKERS_LEGACY[0]), "legacy marker removed");
    // The end sentinel must sit on its OWN line. Appending it directly to a .trim()ed block welded
    // it onto the final rule (".claude/skills/# --- end bearing ---"), silently invalidating that
    // rule so the skills symlink dir became tracked again.
    for (const line of gi.split("\n")) {
      assert.ok(
        !(line.includes("---") && line.trim() !== "# --- end bearing ---" && /^[^#]/.test(line)),
        `sentinel welded onto a rule: ${line}`,
      );
    }
      // Both skill rules must survive as clean lines. `.claude/skills/*` (not `.claude/skills/`) is
      // load-bearing: git cannot re-include inside an excluded DIRECTORY, so the trailing-slash form
      // makes the negation on the next line silently do nothing and the generated skills stay hidden.
      assert.ok(/\n\.claude\/skills\/\*\n/.test(gi), "the skills rule must be a clean line");
      assert.ok(
        /\n!\.claude\/skills\/gitnexus-area-\*\/\n/.test(gi),
        "the generated-skills exception must survive as its own line",
      );
    assert.equal(gi.split(GITIGNORE_MARKER).length - 1, 1, "exactly one managed block");
    assert.ok(gi.includes("node_modules/"), "user's own rules preserved");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("appendGitignore refreshes an existing managed block on upgrade", async () => {
    const { appendGitignore } = await import("./kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gi-refresh-"));
    // An older install: managed block predates .agents/skills and .gitnexus/.
    fs.writeFileSync(
      path.join(tmp, ".gitignore"),
      `node_modules/\n\n${GITIGNORE_MARKER} (safe to remove)\n.tmp-agent/\n.cursor/skills/\n`,
    );
    appendGitignore(tmp, "all");
    const gi = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    // Block refreshed to the current scheme: graph index + all IDE skill dirs ignored.
    assert.ok(gi.includes(".gitnexus/"), "adds .gitnexus/ ignore on upgrade");
    assert.ok(gi.includes(".agents/skills/"), "adds .agents/skills on upgrade");
    assert.ok(gi.includes(".claude/skills/"), "adds .claude/skills on upgrade");
    // User content preserved; marker not duplicated.
    assert.ok(gi.includes("node_modules/"));
    assert.equal(gi.split(GITIGNORE_MARKER).length - 1, 1);
    // Idempotent: a second pass keeps a single block.
    appendGitignore(tmp, "all");
    const gi2 = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    assert.equal(gi2.split(GITIGNORE_MARKER).length - 1, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("enforcement rule includes graph+embeddings gates", () => {
    const rule = fs.readFileSync(
      path.join(BUNDLE_ROOT, "templates/CLAUDE.gitnexus.md"),
      "utf8",
    );
    assert.ok(rule.includes("embeddings"));
    assert.ok(rule.includes("limit: 5"));
    assert.ok(rule.includes("detect_changes"));
    assert.ok(rule.includes("impact upstream"));
    assert.ok(rule.includes("every task"));
    assert.ok(rule.includes("not a fallback when code is unfamiliar"));
    assert.ok(rule.includes("cypher"));
    assert.ok(rule.includes("ACCESSES"));
    assert.ok(rule.includes("rename dry_run"));
    assert.ok(rule.includes("Stale loop"));
    assert.ok(rule.includes("refresh failed"));
  });

  it("stale policy requires refresh before classical fallback", async () => {
    const { evaluateStalePolicy } = await import(
      new URL("../bundle/.bearing/lib/stale-policy.mjs", import.meta.url)
        .href
    );
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url)
        .href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stale-policy-"));
    // The gate is opt-in now; this test is about what it does when ON.
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".bearing/hooks.json"), JSON.stringify({ stalenessGate: "block" }));
    const stale = { fresh: false, reason: "behind", detail: "test" };

    assert.equal(evaluateStalePolicy(stale, tmp).phase, "must_refresh");
    assert.equal(evaluateStalePolicy(stale, tmp).allowClassical, false);

    session.setRefreshFailed(tmp, true, "refresh failed");
    assert.equal(evaluateStalePolicy(stale, tmp).phase, "classical_fallback");
    assert.equal(evaluateStalePolicy(stale, tmp).allowClassical, true);

    session.setRefreshFailed(tmp, false);
    assert.equal(evaluateStalePolicy({ fresh: true }, tmp).phase, "fresh");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("shell staleness guard denies non-git shell when stale", async () => {
    const { execSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-shell-guard-"));
    execSync("git init -q", { cwd: tmp });
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".bearing/hooks.json"), JSON.stringify({ stalenessGate: "block" }));
    execSync("git config user.email test@test.com", { cwd: tmp });
    execSync("git config user.name test", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", {
      cwd: tmp,
      shell: true,
    });
    const head = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({
        lastCommit: "deadbeef",
        stats: { nodes: 10, embeddings: 10 },
      }),
    );
    copyHookFiles(tmp, [
      "bearing-bash-guard.mjs",
      "lib/hook-helpers.mjs",
      "lib/stale-policy.mjs",
      "lib/session-primer.mjs",
      "lib/load-staleness.mjs",
      "lib/check-staleness.mjs",
      "lib/cypher-helpers.mjs",
      "lib/rename-helpers.mjs",
      "lib/classify.mjs",
      "lib/claude-emit.mjs",
    ]);
    const out = runHook(tmp, "bearing-bash-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: "grep -r handleOrder src/" },
    });
    assert.equal(out.permission, "deny");
    assert.ok(out.agent_message.includes("agent-refresh"));

    // REVERSED (this used to assert `pnpm test` is denied while stale). Blanket-denying every
    // shell command on a stale index bricked the terminal over ONE commit of drift — reported
    // from real use: the agent could not `ls`, tail a log, or run tests until a full reindex
    // finished. Index freshness has nothing to say about any of those. The gate now covers only
    // what a stale GRAPH would have answered — a code search (NS-5).
    const okOut = runHook(tmp, "bearing-bash-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
    });
    assert.notEqual(okOut.permission, "deny", "running tests must not require a fresh index");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("check-staleness treats missing embeddings as stale", async () => {
    const { spawnSync, execSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stale-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email test@test.com", { cwd: tmp });
    execSync("git config user.name test", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", {
      cwd: tmp,
      shell: true,
    });
    const head = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    const gn = path.join(tmp, ".gitnexus");
    fs.mkdirSync(gn, { recursive: true });
    fs.writeFileSync(
      path.join(gn, "meta.json"),
      JSON.stringify({
        lastCommit: head,
        stats: { nodes: 100, embeddings: 0 },
      }),
    );
    const check = path.join(
      BUNDLE_ROOT,
      ".bearing/lib/check-staleness.mjs",
    );
    const r = spawnSync(process.execPath, [check, tmp], { encoding: "utf8" });
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.fresh, false);
    assert.equal(out.reason, "missing_embeddings");
    // The CONSEQUENCE must match the configured gate. This asserted "Hooks block" unconditionally,
    // while `stalenessGate` defaults to "off" and blocks nothing — so the detail shipped into the
    // session brief stated something that does not happen (NS-20). Both arms are pinned now.
    assert.ok(!out.detail.includes("Classical tools OK"));
    assert.ok(
      /Nothing is blocked/.test(out.detail),
      `default gate is off, so the detail must not claim a block: ${out.detail}`,
    );
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".bearing/hooks.json"), JSON.stringify({ stalenessGate: "block" }));
    const blocked = JSON.parse(
      spawnSync(process.execPath, [check, tmp], { encoding: "utf8" }).stdout.trim(),
    );
    assert.ok(blocked.detail.includes("Hooks block"), "gate on: the block must be stated");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("check-staleness behind message matches refresh-first hooks", async () => {
    const { spawnSync, execSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stale-msg-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email test@test.com", { cwd: tmp });
    execSync("git config user.name test", { cwd: tmp });
    // SOURCE files, and enough of them to clear driftRefreshThreshold. `f.txt` used to serve here,
    // but a commit touching no source no longer marks the graph stale at all, and one under the
    // threshold reports `behind_small`. This test is about the message on a MATERIALLY stale index,
    // so the fixture has to actually produce one.
    // Enough SOURCE files to clear driftRefreshThreshold (8). Under it the index is `behind_small`,
    // which is a different message; this test is about the materially-stale one.
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) fs.writeFileSync(path.join(tmp, `f${i}.js`), "export const v = 1;\n");
    execSync("git add -A && git commit -q -m v1", { cwd: tmp, shell: true });
    const old = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) fs.writeFileSync(path.join(tmp, `f${i}.js`), "export const v = 2;\n");
    execSync("git add -A && git commit -q -m v2", { cwd: tmp, shell: true });
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: old, stats: { nodes: 10, embeddings: 10 } }),
    );
    const check = path.join(
      BUNDLE_ROOT,
      ".bearing/lib/check-staleness.mjs",
    );
    const r = spawnSync(process.execPath, [check, tmp], { encoding: "utf8" });
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.fresh, false);
    assert.equal(out.reason, "behind");
    assert.ok(!/Classical tools OK/i.test(out.detail));
    // Same conditional claim as the missing-embeddings case above.
    assert.ok(
      /Nothing is blocked/.test(out.detail),
      `default gate is off, so the detail must not claim a block: ${out.detail}`,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("GITNEXUS_NPM_SCRIPTS includes agent-brief and health", async () => {
    const { GITNEXUS_NPM_SCRIPTS } = await import("./kit.mjs");
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:agent-refresh"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:health"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:pdg"]);
    assert.match(GITNEXUS_NPM_SCRIPTS["bearing:pdg"], /--pdg/);
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:full-pdg"]);
    assert.match(GITNEXUS_NPM_SCRIPTS["bearing:full-pdg"], /--force .*--pdg/);
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:graph-smoke"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:detect-api"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["bearing:verify"]);
  });

  it("script-gates injects gate comment entries for package.json", async () => {
    const {
      buildGatedScripts,
      allManagedScriptKeys,
      gateCommentKey,
      GITNEXUS_SCRIPT_GATES,
    } = await import("../bundle/scripts/bearing-teaching/script-gates.mjs");
    const gated = buildGatedScripts();
    assert.ok(gated["bearing.__gate.1.session"]);
    assert.ok(gated["bearing:verify"]);
    assert.ok(
      allManagedScriptKeys().length >
        Object.keys(gated).filter((k) => !k.includes("__gate")).length,
    );
    for (const g of GITNEXUS_SCRIPT_GATES) {
      assert.ok(gated[gateCommentKey(g)]);
    }
  });

  it("bundle includes install polish and verification helpers", () => {
    const files = listBundleFiles();
    assert.ok(files.includes("scripts/bearing-teaching/script-gates.mjs"));
    assert.ok(files.includes("scripts/bearing-gate-hint.mjs"));
    assert.ok(files.includes("scripts/lib/setup-ui.mjs"));
    assert.ok(files.includes(".bearing/lib/verify-kit.mjs"));
    const preCommit = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".githooks/pre-commit"),
      "utf8",
    );
    // Refreshes through the tiered planner, not a forced full rebuild on every commit.
    assert.ok(preCommit.includes("refresh-cli.mjs"));
    assert.ok(!preCommit.includes("npm run bearing:full-pdg"));
    // `npm run bearing:refresh` survives as the fallback for installs predating refresh-cli — that
    // is fine and incremental. The invariant this line used to protect was the opposite one (use
    // full-pdg, not refresh); what actually must never come back is a FORCED rebuild per commit.
    // Comments stripped first: the header explains on purpose what it no longer does, and matching
    // that would be an assertion passing for the wrong reason in the opposite direction (GP-5).
    const preCommitCode = preCommit
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    assert.ok(!/--force/.test(preCommitCode), "pre-commit forces a full rebuild again");
    assert.ok(!/--pdg/.test(preCommitCode), "pre-commit builds the PDG substrate again");
  });

  it("verify-kit reports missing files on empty repo", async () => {
    const { verifyKitInstall } = await import(
      new URL("../bundle/.bearing/lib/verify-kit.mjs", import.meta.url)
        .href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-verify-"));
    const report = await verifyKitInstall(tmp);
    assert.equal(report.healthy, false);
    assert.ok(report.failed > 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("agent-health prints human summary", async () => {
    const { spawnSync, execSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-health-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email test@test.com", { cwd: tmp });
    execSync("git config user.name test", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", {
      cwd: tmp,
      shell: true,
    });
    const head = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({
        lastCommit: head,
        stats: { nodes: 10, embeddings: 10, processes: 2, communities: 1 },
      }),
    );
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    for (const f of libClosure([
      "check-staleness.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "hook-helpers.mjs",
      "session-health-audit.mjs",
      "agent-health.mjs",
      "persistence-health.mjs",
    ])) {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".bearing/lib", f),
        path.join(tmp, ".bearing/lib", f),
      );
    }
    fs.mkdirSync(path.join(tmp, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".cursor/hooks.json"),
      JSON.stringify({ hooks: { sessionStart: [{}], preToolUse: [{}] } }),
    );
    fs.writeFileSync(
      path.join(tmp, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { gitnexus: {} } }),
    );
    const health = path.join(tmp, ".bearing/lib/agent-health.mjs");
    const r = spawnSync(process.execPath, [health, tmp], { encoding: "utf8" });
    // The product is bearing. This assertion pinned "GitNexus Cursor Kit" — the pre-rebrand name —
    // which is how it survived the rename sweep and kept printing on claude-only installs, where
    // "Cursor" was wrong twice over.
    assert.ok(r.stdout.includes("bearing —"), "the health banner should name the product");
    assert.ok(!/Cursor Kit/i.test(r.stdout), "pre-rebrand name is back in the banner");
    assert.ok(r.stdout.includes("Cypher"));
    assert.ok(r.stdout.includes("Persistence"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("bundle has no source-repo domain leakage", () => {
    const denylist = [
      "handleRequest",
      "isKnownApiPath",
      "researchApi",
      "research-dashboard",
      "research/presets",
      "research/profiles",
      "stablePairScanner",
      "runStablePairScanWorkflow",
      "resolveFilters",
      "resolveSelectionFilters",
      "scannerOptions",
      "strategyId",
      "private production repo",
      "OHLCV",
      "stable pair",
    ];
    const textExt = /\.(md|mdc|sh|mjs|js|json|txt|yml|yaml|gitnexusignore)$/;
    const offenders = [];
    for (const rel of listBundleFiles()) {
      if (!textExt.test(rel)) continue;
      const content = fs.readFileSync(path.join(BUNDLE_ROOT, rel), "utf8");
      for (const token of denylist) {
        if (content.includes(token)) offenders.push(`${rel} → ${token}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `domain leakage found:\n${offenders.join("\n")}`,
    );
  });

  it("hook config enforces polyglot source extensions", async () => {
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url)
        .href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-poly-"));
    const config = helpers.loadHookConfig(tmp);
    assert.ok(
      helpers.isSourceCodePath("src/app.py", config),
      "python should count as source",
    );
    assert.ok(
      helpers.isSourceCodePath("src/main.rs", config),
      "rust should count as source",
    );
    assert.ok(
      helpers.isSourceCodePath("lib/Foo.go", config),
      "go should count as source",
    );
    assert.equal(helpers.editSensitivity("src/app.py", config), "full");
    assert.equal(helpers.editSensitivity("src/main.rs", config), "full");
    assert.ok(
      helpers.isSourceCodePath("src/kernel.cu", config),
      "CUDA should count as source",
    );
    assert.ok(
      helpers.isSourceCodePath("src/kernel.cuh", config),
      "CUDA headers should count as source",
    );
    // Custom override narrows the set.
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.json"),
      JSON.stringify({ sourceExts: ["js"] }),
    );
    const narrowed = helpers.loadHookConfig(tmp);
    assert.ok(
      !helpers.isSourceCodePath("src/app.py", narrowed),
      "override should exclude python",
    );
    assert.ok(helpers.isSourceCodePath("src/app.js", narrowed));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("hooks.local.json overrides the shared config file per-machine (defaults < shared < local)", async () => {
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "gn-local-"));
    fs.mkdirSync(path.join(r, ".bearing"), { recursive: true });
    const shared = path.join(r, ".bearing/hooks.json");
    const local = path.join(r, ".bearing/hooks.local.json");

    // Shared team config sets three keys.
    fs.writeFileSync(
      shared,
      JSON.stringify({ mode: "guide", taskCoreEveryEdits: 10, driftRefreshThreshold: 5 }),
    );
    // Local override touches two of them; the untouched one falls through to shared.
    fs.writeFileSync(local, JSON.stringify({ taskCoreEveryEdits: 40, driftRefreshThreshold: 9 }));
    let c = helpers.loadHookConfig(r);
    assert.equal(c.taskCoreEveryEdits, 40, "local wins over shared");
    assert.equal(c.driftRefreshThreshold, 9, "local wins over shared");
    assert.equal(c.mode, "guide", "shared value stands where local is silent");

    // Local-only (no shared file) still layers over the built-in defaults.
    fs.rmSync(shared);
    c = helpers.loadHookConfig(r);
    assert.equal(c.taskCoreEveryEdits, 40);
    assert.equal(c.mode, "enforce", "default mode when no shared file");

    // Invalid local JSON is ignored (shared/default stands) — never throws (NS-8).
    fs.writeFileSync(shared, JSON.stringify({ taskCoreEveryEdits: 10 }));
    fs.writeFileSync(local, "{ not valid json");
    assert.equal(helpers.loadHookConfig(r).taskCoreEveryEdits, 10, "invalid local ignored");

    fs.rmSync(r, { recursive: true, force: true });
  });

  it("cypher field access matches Methods (untyped source node)", async () => {
    const cypher = await import(
      new URL("../bundle/.bearing/lib/cypher-helpers.mjs", import.meta.url)
        .href
    );
    const q = cypher.cypherFieldAccess("balance", "r");
    assert.ok(
      !q.includes("(f:Function)"),
      "source node should be untyped for polyglot",
    );
    assert.ok(q.includes("ACCESSES"));
    // NOT `f.kind`. This assertion used to REQUIRE it, which is how a query that cannot parse
    // survived: `f.kind` is not a property in this schema, so every field grep the gate prescribed
    // answered `Binder exception: Cannot find property kind for f.` A string assertion cannot see
    // that — only running it can (NS-10) — so this now pins the invariant that survives: project
    // only properties the schema actually defines.
    assert.ok(!q.includes("f.kind"), "projects a property the graph schema does not have");
    for (const proj of q.matchAll(/\bf\.(\w+)/g)) {
      assert.ok(
        ["name", "filePath"].includes(proj[1]),
        `projects f.${proj[1]}, which is not a known node property — the query will not prepare`,
      );
    }
  });

  it("staleness load caches result within TTL", async () => {
    const tmp = setupKitRepo({ fresh: true });
    const load = path.join(tmp, ".bearing/lib/load-staleness.mjs");
    const first = spawnSync(process.execPath, [load, tmp], {
      encoding: "utf8",
    });
    assert.equal(JSON.parse(first.stdout.trim()).fresh, true);
    const cacheFile = path.join(tmp, ".bearing/.gitnexus-staleness-cache.json");
    assert.ok(fs.existsSync(cacheFile), "cache file written after first load");
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.equal(cached.data.fresh, true);
    assert.ok(typeof cached.at === "number");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("edit-guard enforces impact-before-edit when fresh", async () => {
    const tmp = setupKitRepo({ fresh: true });
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url)
        .href
    );

    const denied = runHook(tmp, "bearing-edit-guard.mjs", {
      tool_name: "StrReplace",
      tool_input: { path: "src/foo.js", old_string: "a()", new_string: "b()" },
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/IMPACT GATE/.test(denied.agent_message));

    session.setMcpToolUsed(tmp, "gitnexus_impact");
    assert.ok(session.isImpactUsed(tmp));
    const allowed = runHook(tmp, "bearing-edit-guard.mjs", {
      tool_name: "StrReplace",
      tool_input: { path: "src/foo.js", old_string: "a()", new_string: "b()" },
    });
    assert.equal(allowed.permission, "allow");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("commit-guard requires detect_changes before commit when fresh", async () => {
    const tmp = setupKitRepo({ fresh: true });
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url)
        .href
    );

    const denied = runHook(tmp, "bearing-bash-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/COMMIT GATE/.test(denied.agent_message));

    // --help is never gated.
    const help = runHook(tmp, "bearing-bash-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: "git commit --help" },
    });
    assert.equal(help.permission, "allow");

    session.setMcpToolUsed(tmp, "gitnexus_detect_changes");
    assert.ok(session.isDetectUsed(tmp));
    const allowed = runHook(tmp, "bearing-bash-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    assert.equal(allowed.permission, "allow");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("edit-guard blocks source edits when stale (unified, no grace shortcut)", async () => {
    const tmp = setupKitRepo({ fresh: false });
    const denied = runHook(tmp, "bearing-edit-guard.mjs", {
      tool_name: "Write",
      tool_input: { path: "src/foo.js", file_path: "src/foo.js" },
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/STALENESS GATE/.test(denied.agent_message));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("compaction middleware: source-aware clear + durable memory helpers", async () => {
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    // Genuine new session clears; compaction/resume preserves (same task continues).
    assert.equal(session.shouldClearOnSource("startup"), true);
    assert.equal(session.shouldClearOnSource("clear"), true);
    assert.equal(session.shouldClearOnSource("compact"), false);
    assert.equal(session.shouldClearOnSource("resume"), false);
    assert.equal(session.shouldClearOnSource(undefined), true);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-mem-"));
    const origHome = process.env.HOME;
    process.env.HOME = tmp; // keep the test off the real ~/.claude
    try {
      const mem = session.memoryPath(tmp);
      assert.ok(
        mem.includes("/.claude/projects/") && mem.endsWith("memory/MEMORY.md"),
        "memory is Claude Code's native per-project file",
      );
      assert.ok(mem.startsWith(tmp), "HOME override contains the write");
      session.appendMemoryCheckpoint(tmp, "note-1");
      const c1 = fs.readFileSync(mem, "utf8");
      assert.ok(c1.includes("Project working memory") && c1.includes("note-1"));
      session.appendMemoryCheckpoint(tmp, "note-2");
      const c2 = fs.readFileSync(mem, "utf8");
      assert.ok(c2.includes("note-1") && c2.includes("note-2"), "appends, never overwrites");
    } finally {
      process.env.HOME = origHome;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("claude SessionStart preserves gates on compact, clears on startup", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-compact-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", {
      cwd: tmp,
      shell: true,
    });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", { cwd: tmp, shell: true });
    const head = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: head, stats: { nodes: 50, embeddings: 50 } }),
    );
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".claude/hooks"), { recursive: true });
    for (const f of libClosure([
      "claude-emit.mjs",
      "session-primer.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ])) {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".bearing/lib", f),
        path.join(tmp, ".bearing/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/bearing-session.mjs"),
      path.join(tmp, ".claude/hooks/bearing-session.mjs"),
    );
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const runSession = (source) =>
      spawnSync(process.execPath, [path.join(tmp, ".claude/hooks/bearing-session.mjs")], {
        cwd: tmp,
        input: JSON.stringify({ source }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, HOME: tmp },
      });

    // Mark a satisfied gate, then COMPACT → gate must survive + recovery brief.
    session.setMcpToolUsed(tmp, "gitnexus_impact");
    assert.ok(session.isImpactUsed(tmp));
    const compact = runSession("compact");
    assert.ok(session.isImpactUsed(tmp), "compaction must NOT clear satisfied gates");
    const cout = JSON.parse(compact.stdout.trim());
    assert.match(cout.hookSpecificOutput.additionalContext, /COMPACTED|preserved/i);
    assert.match(cout.hookSpecificOutput.additionalContext, /MEMORY\.md/);
    // Regression guard: the recovery brief must RE-STATE graph-first discipline, not only
    // memory recovery. Post-compaction is exactly where agents drift back to grep; dropping
    // the playbook here made the agent "respect GN less" mid-session.
    const rc = cout.hookSpecificOutput.additionalContext;
    assert.match(rc, /graph-first still applies/i);
    assert.match(rc, /gitnexus_query/);
    assert.match(rc, /detect_changes before/i);
    assert.doesNotMatch(rc, /do NOT re-run the ✓ ones/i); // the discouraging wording is gone

    // A genuine startup DOES clear (new session).
    runSession("startup");
    assert.ok(!session.isImpactUsed(tmp), "startup clears gates (new session)");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("claude PreCompact hook emits no stdout (side-effect only) + checkpoints memory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-precompact-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", {
      cwd: tmp,
      shell: true,
    });
    fs.writeFileSync(path.join(tmp, "f.txt"), "x");
    execSync("git add f.txt && git commit -q -m init", { cwd: tmp, shell: true });
    const head = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: head, stats: { nodes: 50, embeddings: 50 } }),
    );
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".claude/hooks"), { recursive: true });
    for (const f of libClosure([
      "claude-emit.mjs",
      "session-primer.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ])) {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".bearing/lib", f),
        path.join(tmp, ".bearing/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/bearing-precompact.mjs"),
      path.join(tmp, ".claude/hooks/bearing-precompact.mjs"),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(tmp, ".claude/hooks/bearing-precompact.mjs")],
      {
        cwd: tmp,
        input: JSON.stringify({ trigger: "auto" }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, HOME: tmp },
      },
    );
    assert.equal(r.status, 0, "hook exits cleanly");
    assert.equal(
      r.stdout.trim(),
      "",
      "PreCompact emits NO stdout — Claude Code rejects additionalContext on PreCompact",
    );
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const origHome = process.env.HOME;
    process.env.HOME = tmp;
    const mem = session.memoryPath(tmp);
    process.env.HOME = origHome;
    assert.ok(fs.existsSync(mem), "checkpoint written to Claude project memory");
    assert.ok(fs.readFileSync(mem, "utf8").includes("checkpoint"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("telemetry archives each session's scorecard and aggregates", async () => {
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-telemetry-"));

    // Session 1: two grep redirects + a graph call, then session start clears it.
    session.bumpScore(tmp, "grepRedirects");
    session.bumpScore(tmp, "grepRedirects");
    session.bumpScore(tmp, "graphCalls");
    session.clearSessionState(tmp); // flushes then wipes the scorecard
    assert.ok(
      !fs.existsSync(path.join(tmp, ".bearing/.gitnexus-scorecard.json")),
      "scorecard cleared after session",
    );

    // Session 2: one impact gate.
    session.bumpScore(tmp, "impactGate");
    session.clearSessionState(tmp);

    const records = session.readTelemetry(tmp);
    assert.equal(records.length, 2, "one telemetry record per session");
    assert.equal(records[0].counts.grepRedirects, 2);

    const s = session.summarizeTelemetry(records);
    assert.equal(s.sessions, 2);
    assert.equal(s.totals.grepRedirects, 2);
    assert.equal(s.totals.impactGate, 1);
    assert.equal(s.avgPerSession.graphCalls, 0.5);

    // An empty session records nothing.
    session.clearSessionState(tmp);
    assert.equal(session.readTelemetry(tmp).length, 2, "empty session not logged");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("session scorecard counts enforcement events", async () => {
    const session = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url)
        .href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-score-"));
    session.bumpScore(tmp, "grepRedirects");
    session.bumpScore(tmp, "grepRedirects");
    session.bumpScore(tmp, "impactGate");
    const card = session.readScorecard(tmp);
    assert.equal(card.counts.grepRedirects, 2);
    assert.equal(card.counts.impactGate, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("script-gates include review, doctor, scorecard commands", async () => {
    const { flatGitnexusScripts } =
      await import("../bundle/scripts/bearing-teaching/script-gates.mjs");
    const s = flatGitnexusScripts();
    assert.ok(s["bearing:doctor"]);
    assert.ok(s["bearing:scorecard"]);
    assert.ok(s["bearing:agent-review"]);
    assert.ok(s["bearing:branch-status"]);
    assert.ok(s["bearing:pr-impact"]);
    assert.ok(s["bearing:map"]);
    assert.ok(s["bearing:commit-msg"]);
    assert.ok(s["bearing:ci"]);
    assert.ok(s["bearing:pdg"]);
    assert.ok(s["bearing:full-pdg"]);
  });

  it("persistence-health classifies database failures", async () => {
    const { classifyPersistenceOutput, inspectPersistence } = await import(
      new URL(
        "../bundle/.bearing/lib/persistence-health.mjs",
        import.meta.url,
      ).href
    );
    assert.equal(classifyPersistenceOutput("all good"), null);
    assert.ok(classifyPersistenceOutput("sqlite database is locked"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-persist-"));
    const report = inspectPersistence(tmp);
    assert.equal(report.healthy, false);
    assert.ok(report.checks.some((c) => c.id === "persistence_meta" && !c.ok));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("cypher-cli parses tables, counts, and JSON", async () => {
    const { parseRows, parseCount, firstColumn } = await import(
      new URL("../bundle/.bearing/lib/cypher-cli.mjs", import.meta.url)
        .href
    );
    const rows = parseRows(
      "| label | n |\n| --- | --- |\n| Auth | 12 |\n| Store | 7 |",
    );
    assert.deepEqual(rows, [
      ["Auth", "12"],
      ["Store", "7"],
    ]);
    assert.deepEqual(firstColumn(rows), ["Auth", "Store"]);
    assert.equal(parseCount("count(caller)\n9"), 9);
    assert.deepEqual(parseRows('[{"a":"X","b":2}]'), [["X", "2"]]);
    assert.deepEqual(parseRows(""), []);
  });

  it("commit-message drafts a template offline (no staged code)", async () => {
    const { draftCommitMessage } = await import(
      new URL("../bundle/.bearing/lib/commit-message.mjs", import.meta.url)
        .href
    );
    const tmp = setupKitRepo({ fresh: true });
    const { message } = draftCommitMessage(tmp, "x");
    assert.ok(message.includes("<type>"));
    assert.ok(message.includes("No staged code files"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("generate-arch-doc writes stats doc from meta.json", async () => {
    const { generateArchDoc, ARCH_DOC_PATH } = await import(
      new URL(
        "../bundle/.bearing/lib/generate-arch-doc.mjs",
        import.meta.url,
      ).href
    );
    const tmp = setupKitRepo({ fresh: true });
    const res = generateArchDoc(tmp, "demo-repo", { ...process.env, PATH: "" });
    assert.ok(res.written, `expected doc written, got ${JSON.stringify(res)}`);
    const doc = fs.readFileSync(path.join(tmp, ARCH_DOC_PATH), "utf8");
    assert.ok(doc.includes("# Architecture — demo-repo"));
    assert.ok(doc.includes("Graph at a glance"));
    assert.ok(doc.includes("| Symbols | 50 |"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("arch-doc reports reason when no index present", async () => {
    const { generateArchDoc } = await import(
      new URL(
        "../bundle/.bearing/lib/generate-arch-doc.mjs",
        import.meta.url,
      ).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-noidx-"));
    const res = generateArchDoc(tmp, "x");
    assert.equal(res.written, false);
    assert.ok(/meta\.json/.test(res.reason));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("stabilize-agent-docs strips the volatile stats block, keeps user + kit content", async () => {
    const { stabilizeAgentDocs } = await import(
      new URL(
        "../bundle/.bearing/lib/stabilize-agent-docs.mjs",
        import.meta.url,
      ).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stabilize-"));
    // CLAUDE.md: user content, then the gitnexus tool block (volatile), then the kit block.
    fs.writeFileSync(
      path.join(tmp, "CLAUDE.md"),
      [
        "# My Project Rules",
        "Always check docs first.",
        "",
        "<!-- gitnexus:start -->",
        "This project is indexed by GitNexus (49749 symbols, 117601 relationships).",
        "| Components (1103 symbols) | ... |",
        "<!-- gitnexus:end -->",
        "",
        "<!-- gitnexus-agent-kit:BEGIN -->",
        "Stable enforcement contract.",
        "<!-- gitnexus-agent-kit:END -->",
        "",
      ].join("\n"),
    );
    // AGENTS.md with the block at the very top.
    fs.writeFileSync(
      path.join(tmp, "AGENTS.md"),
      "<!-- gitnexus:start -->\n(50592 symbols)\n<!-- gitnexus:end -->\n\n<!-- gitnexus-agent-kit:BEGIN -->\nkit\n<!-- gitnexus-agent-kit:END -->\n",
    );

    const changed = stabilizeAgentDocs(tmp);
    assert.deepEqual(changed.sort(), ["AGENTS.md", "CLAUDE.md"]);

    const claude = fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8");
    assert.ok(!claude.includes("<!-- gitnexus:start -->"), "volatile block removed");
    assert.ok(!claude.includes("49749 symbols"), "live stats removed");
    assert.ok(claude.includes("# My Project Rules"), "user content kept");
    assert.ok(claude.includes("Always check docs first."), "user content kept");
    assert.ok(claude.includes("gitnexus-agent-kit:BEGIN"), "stable kit block kept");

    const agents = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.ok(!agents.includes("<!-- gitnexus:start -->"));
    assert.ok(agents.includes("gitnexus-agent-kit:BEGIN"));
    assert.ok(!agents.startsWith("\n"), "no leading blank after top-of-file strip");

    // Idempotent: nothing left to strip.
    assert.deepEqual(stabilizeAgentDocs(tmp), []);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("gitignore snippet ignores the derived architecture doc", async () => {
    const { appendGitignore } = await import("./kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-archignore-"));
    appendGitignore(tmp, "all");
    const gi = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    assert.ok(gi.includes("docs/ARCHITECTURE.gitnexus.md"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("eval harness loads and validates task specs", async () => {
    const { loadTasks, validateTask } = await import(
      new URL("../eval/run-eval.mjs", import.meta.url).href
    );
    const tasks = loadTasks();
    assert.ok(tasks.length >= 3, `expected eval tasks, got ${tasks.length}`);
    for (const t of tasks) assert.deepEqual(validateTask(t), []);
    assert.deepEqual(validateTask({ id: "x" }), [
      'missing "title"',
      'missing "prompt"',
    ]);
    // At least one task is machine-checkable with a real fixture.
    const checkable = tasks.find((t) => t.check && t.check.cmd && t.fixture);
    assert.ok(checkable, "expected a task with fixture + check");
    const fxRoot = new URL(
      `../eval/fixtures/${checkable.fixture}/`,
      import.meta.url,
    );
    assert.ok(
      fs.existsSync(new URL("verify.mjs", fxRoot)),
      "fixture verify.mjs exists",
    );
    assert.ok(
      fs.existsSync(
        new URL("../eval/runners/cursor-agent.mjs", import.meta.url),
      ),
    );
  });

  it("contract files are generated from the single canonical source", async () => {
    const gen = await import(
      new URL("../scripts/gen-contract.mjs", import.meta.url).href
    );
    const rendered = gen.renderAll();
    for (const [file, expected] of Object.entries(rendered)) {
      const onDisk = fs.readFileSync(file, "utf8");
      assert.equal(
        onDisk,
        expected,
        `${path.basename(file)} is stale — run \`npm run gen:contract\` after editing scripts/contract/enforcement-contract.md`,
      );
    }
    // The canonical contract teaches the v1.6.8 tools (no skill/rule drift).
    const body = fs.readFileSync(gen.CONTRACT_SRC, "utf8");
    for (const tool of ["pdg_query", "trace", "explain"]) {
      assert.ok(body.includes(tool), `contract must teach ${tool}`);
    }
  });

  it("classify grep gate closes the quote and one-MCP-unlock loopholes", async () => {
    const { classifyGrep } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url)
        .href
    );
    const config = helpers.loadHookConfig("/no/such/root");
    const base = {
      phase: "fresh",
      graphUsed: false,
      config,
      repo: "r",
      root: "/tmp/x",
      staleMustRefreshMsg: "STALE",
      staleFallbackMsg: "FALLBACK",
    };
    const grep = (pattern, extra = {}, over = {}) =>
      classifyGrep(
        { tool: "Grep", toolInput: { pattern, ...extra } },
        { ...base, ...over },
      );

    // PascalCase symbol → deny → context.
    let v = grep("UserService");
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes("gitnexus_context"));

    // QUOTE BYPASS CLOSED: quoting a symbol no longer reads as a literal —
    // it is still routed to the graph (context for PascalCase) and denied.
    v = grep('"UserService"');
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes("gitnexus_context"));

    // A quoted lowercase identifier is also still denied (routed to cypher).
    v = grep('"validateUser"');
    assert.equal(v.decision, "deny");
    assert.ok(/ACCESSES|gitnexus_cypher|gitnexus_context/.test(v.agentMessage));

    // SCOPE POLICY REVERSED for a path naming ONE file. This used to assert that
    // `grep calculateExposure path=src/risk.js` stays denied. Reported from real use as a false
    // deny, and the closure was never real: `Read src/risk.js` is allowed outright (with
    // offset/limit for large files), so denying the grep blocked nothing — it forced a more
    // expensive route to identical bytes while pointing at `cypher ACCESSES`, which returns empty
    // for property reads. A DIRECTORY sweep is still a sweep and stays denied.
    v = grep("calculateExposure", { path: "src/" }, { graphUsed: true });
    assert.equal(v.decision, "deny");
    assert.equal(
      grep("calculateExposure", { path: "src/risk.js" }, { graphUsed: true }).decision,
      "allow",
      "a path naming one file is verification, not discovery",
    );

    // Field-shaped term → routed to the graph (cypher/context), still denied.
    v = grep("balance");
    assert.equal(v.decision, "deny");
    assert.ok(/ACCESSES|gitnexus_cypher|gitnexus_context/.test(v.agentMessage));

    // Genuine literal phrase → allowed (real grep use).
    assert.equal(grep("user not found").decision, "allow");

    // Searching inside a non-source config/doc file → allowed even if id-shaped.
    assert.equal(grep("version", { path: "package.json" }).decision, "allow");
    assert.equal(grep("retries", { path: "docs/config.md" }).decision, "allow");

    // SemanticSearch always routes to hybrid query.
    v = classifyGrep(
      { tool: "SemanticSearch", toolInput: { query: "auth flow" } },
      base,
    );
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes("search_query"));

    // Stale phases: symbol denied under must_refresh, config literal allowed,
    // classical_fallback lets everything through.
    assert.equal(grep("getUserById", {}, { phase: "must_refresh" }).decision, "deny");
    assert.equal(
      grep("version", { path: "package.json" }, { phase: "must_refresh" })
        .decision,
      "allow",
    );
    assert.equal(
      grep("getUserById", {}, { phase: "classical_fallback" }).decision,
      "allow",
    );
  });

  it("classify closes the shell-grep escape hatch + alternation loophole", async () => {
    const { classifyShell, classifyGrep } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const config = helpers.loadHookConfig("/no/such/root");
    const base = {
      phase: "fresh",
      graphUsed: false,
      config,
      repo: "r",
      root: "/tmp/x",
      staleMustRefreshMsg: "STALE",
      staleFallbackMsg: "FALLBACK",
    };
    const shell = (command, over = {}) =>
      classifyShell({ command }, { ...base, ...over });
    const grep = (pattern, extra = {}) =>
      classifyGrep({ tool: "Grep", toolInput: { pattern, ...extra } }, base);

    // ALTERNATION LOOPHOLE CLOSED: `a\|b` of symbols is a symbol search, not a literal.
    // Directory, not a single file — single-file scoping is an allow now (scope-policy note
    // above), so the alternation rule must be exercised on a real sweep.
    let v = grep("signedRequest\\|createBinanceFuturesTransport", { path: "src/" });
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes("gitnexus_context"));
    // decl / assignment branches are caught too
    // Directory, not a single file (scope-policy note above).
    assert.equal(grep("isScaleIn =|const oppStop", { path: "src/" }).decision, "deny");
    // but a real literal alternation over a non-source file is still fine
    assert.equal(grep("error|warning", { path: "logs/app.log" }).decision, "allow");

    // SHELL ESCAPE HATCH CLOSED: bash grep/rg/git-grep over source is gated like the tool.
    // Directories, not single files — the shell path delegates to the same classifier, so the
    // scope-policy reversal above applies here too (a shell grep scoped to ONE named file is
    // verification and is allowed; a sweep is not).
    assert.equal(shell("grep -n 'computeDryRunPnl' src/future/server/ | head").decision, "deny");
    assert.equal(shell("grep -n 'signedRequest\\|createBinanceFuturesTransport' src/").decision, "deny");
    assert.equal(
      shell("grep -n 'computeDryRunPnl' src/future/server/sync.js").decision,
      "allow",
      "shell grep scoped to one named file is verification, not a sweep",
    );
    assert.equal(shell("rg computeDryRunPnl src/").decision, "deny");
    assert.equal(shell("rg computeDryRunPnl").decision, "deny");
    assert.equal(shell("git grep signedRequest").decision, "deny");
    assert.equal(shell("grep -rn createBinanceFuturesTransport src").decision, "deny");

    // LEGIT SHELL STAYS ALLOWED: piped filters, non-source, maintenance, read-only git.
    assert.equal(shell("ps aux | grep node").decision, "allow");
    assert.equal(shell("npm ls | grep gitnexus").decision, "allow");
    assert.equal(shell("cat package.json | grep name").decision, "allow");
    assert.equal(shell("grep -n TODO README.md").decision, "allow");
    assert.equal(shell("npm run bearing:agent-refresh").decision, "allow");
    assert.equal(shell("git status").decision, "allow");

    // Shell redirect message names the tool and points at the graph.
    v = shell("rg createBinanceFuturesTransport src/");
    assert.ok(/bypasses the graph/.test(v.agentMessage));
    assert.ok(/gitnexus_(context|cypher)/.test(v.agentMessage));

    // Phase behaviour: stale denies (refresh first); classical_fallback lets it through.
    // Directory scope: a single named file is verification and now passes in every phase
    // (scope-policy note above), so phase behaviour must be exercised on a sweep.
    assert.equal(shell("grep foo src/", { phase: "must_refresh" }).decision, "deny");
    assert.equal(shell("grep bar src/", { phase: "classical_fallback" }).decision, "allow");
  });

  it("classical-fallback escape hatch grants classical tools on a FRESH index", async () => {
    const sp = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const { evaluateStalePolicy } = await import(
      new URL("../bundle/.bearing/lib/stale-policy.mjs", import.meta.url).href
    );
    const { classifyShell } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-fallback-"));

    // Baseline: a FRESH index means enforcement on (no classical).
    assert.equal(evaluateStalePolicy({ fresh: true }, tmp).phase, "fresh");

    // Grant → classical_fallback EVEN ON A FRESH INDEX, reason surfaced.
    sp.grantClassicalFallback(tmp, "GN returned wrong callers");
    const g = sp.fallbackGrant(tmp);
    assert.ok(g && g.reason === "GN returned wrong callers" && g.remainingMs > 0);
    const p = evaluateStalePolicy({ fresh: true }, tmp);
    assert.equal(p.phase, "classical_fallback");
    assert.equal(p.allowClassical, true);
    assert.ok(p.override);
    // a normally-redirected shell symbol grep is now allowed under the grant
    const cfg = { mode: "warn", sourceExtRe: /\.(m?js|tsx?)$/i, sourcePathRes: [], broadGlobRes: [] };
    assert.equal(
      classifyShell(
        { command: "grep -n OrderService src/a.js" },
        { phase: p.phase, config: cfg, repo: "r", root: tmp, staleFallbackMsg: "FB" },
      ).decision,
      "allow",
    );

    // Revoke → enforcement re-armed.
    sp.revokeClassicalFallback(tmp);
    assert.equal(sp.fallbackGrant(tmp), null);
    assert.equal(evaluateStalePolicy({ fresh: true }, tmp).phase, "fresh");

    // Expired grant self-cleans and does not grant.
    sp.grantClassicalFallback(tmp, "stale", -1);
    assert.equal(sp.fallbackGrant(tmp), null);

    // A new session (clearSessionState) drops any active grant → re-armed.
    sp.grantClassicalFallback(tmp, "still wrong");
    assert.ok(sp.fallbackGrant(tmp));
    sp.clearSessionState(tmp);
    assert.equal(sp.fallbackGrant(tmp), null);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("classifyMcpDrift gates graph query tools on working-tree drift", async () => {
    const { classifyMcpDrift, mcpToolSuffix } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const cfg = { driftRefreshThreshold: 3, stalenessGate: "block" };
    const drift = (tool, n, config = cfg) =>
      classifyMcpDrift(tool, { driftingFiles: n }, config).decision;

    // suffix normalization across name formats
    assert.equal(mcpToolSuffix("mcp__gitnexus__query"), "query");
    assert.equal(mcpToolSuffix("mcp__gitnexus__pdg_query"), "pdg_query");
    assert.equal(mcpToolSuffix("gitnexus_context"), "context");

    // query tools deny at/over threshold, allow under
    assert.equal(drift("mcp__gitnexus__query", 3), "deny");
    assert.equal(drift("mcp__gitnexus__query", 2), "allow");
    assert.equal(drift("gitnexus_context", 5), "deny");
    assert.equal(drift("mcp__gitnexus__pdg_query", 4), "deny");
    // non-query tools always pass (detect_changes helps SEE drift; rename is an action)
    assert.equal(drift("mcp__gitnexus__detect_changes", 9), "allow");
    assert.equal(drift("mcp__gitnexus__rename", 9), "allow");
    // threshold 0 disables the gate
    assert.equal(drift("mcp__gitnexus__query", 9, { driftRefreshThreshold: 0 }), "allow");
    // deny message steers to the incremental refresh + is scored
    const v = classifyMcpDrift("mcp__gitnexus__impact", { driftingFiles: 4 }, cfg);
    assert.match(v.agentMessage, /bearing:refresh/);
    assert.match(v.agentMessage, /incremental/i);
    assert.equal(v.scoreEvent, "driftRefreshBlocks");

    // PHASE gate (regression): drift applies ONLY on a commit-fresh index. It must NOT fire in
    // classical_fallback (a failed refresh OR a user-granted fallback) — that would override the
    // escape hatch / tell the agent to run the refresh that just failed.
    const ph = (tool, n, phase) =>
      classifyMcpDrift(tool, { driftingFiles: n }, cfg, phase).decision;
    assert.equal(ph("mcp__gitnexus__query", 5, "fresh"), "deny");
    assert.equal(ph("mcp__gitnexus__query", 5, "classical_fallback"), "allow");
    assert.equal(ph("mcp__gitnexus__query", 5, "must_refresh"), "allow");
    assert.equal(ph("mcp__gitnexus__query", 5, undefined), "deny"); // undefined = caller pre-checked
  });

  it("check-staleness detects working-tree drift + resets on refresh", async () => {
    const { execFileSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-drift-"));
    execFileSync(
      "bash",
      ["-c", "git init -q && git config user.email x@x && git config user.name x"],
      { cwd: tmp },
    );
    fs.writeFileSync(path.join(tmp, "src.js"), "export function a(){}\n");
    execFileSync("bash", ["-c", "git add -A && git commit -qm init"], { cwd: tmp });
    const head = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    const setIndexedAt = (at) =>
      fs.writeFileSync(
        path.join(tmp, ".gitnexus/meta.json"),
        JSON.stringify({ lastCommit: head, indexedAt: at, stats: { nodes: 10, embeddings: 5 } }),
      );
    const CS = new URL("../bundle/.bearing/lib/check-staleness.mjs", import.meta.url).pathname;
    const stat = () => JSON.parse(execFileSync(process.execPath, [CS, tmp], { encoding: "utf8" }));

    setIndexedAt(new Date(Date.now() - 3600e3).toISOString());
    let s = stat();
    assert.equal(s.fresh, true, "commit-fresh");
    assert.equal(s.driftingFiles, 0, "clean tree → no drift");

    fs.writeFileSync(path.join(tmp, "src.js"), "export function a(){return 1}\n"); // edit
    assert.equal(stat().driftingFiles, 1, "one edited source → drift 1");
    fs.writeFileSync(path.join(tmp, "note.md"), "doc\n"); // non-source
    assert.equal(stat().driftingFiles, 1, "non-source edit does not count");

    // refresh: indexedAt advances → drift resets even though files stay uncommitted
    setIndexedAt(new Date(Date.now() + 2000).toISOString());
    assert.equal(stat().driftingFiles, 0, "refresh resets drift");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the task-core survives a session clear, because a task can span sessions", async () => {
    // What remains of the old context-pressure test. The fullness half went with the feature: the
    // window is not knowable at runtime, so estimating a percentage of it produced confident false
    // alarms. This half was never about the window — a task-core outliving clearSessionState is the
    // property that makes it useful across a compaction at all.
    const sp = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-core-"));
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    // The dir has to exist before anyone writes into it — moving from one file to a directory
    // introduced an ENOENT the single file never had.
    sp.ensureTaskCoreDir(tmp);
    fs.writeFileSync(sp.taskCorePath(tmp, "chat-1"), "# TASK-CORE\nGOAL: x\n");

    assert.equal(sp.taskCoreExists(tmp, "chat-1"), true);
    sp.clearSessionState(tmp);
    assert.equal(
      sp.taskCoreExists(tmp, "chat-1"),
      true,
      "a session clear must not take the task-core with it",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("north-stars: tracked path, digest parsing, anchor counter", async () => {
    const sp = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-ns-"));
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });

    assert.equal(sp.northStarsExists(tmp), false, "inert until the repo opts in");
    assert.deepEqual(sp.northStarsDigest(tmp), []);

    // The filename must NOT be dot-prefixed: the managed .gitignore covers `.bearing/.gitnexus-*`,
    // and the north-stars are meant to be COMMITTED (user-owned, team-shared), unlike task-core.
    assert.ok(
      !path.basename(sp.northStarsPath(tmp)).startsWith("."),
      "north-stars must be a tracked (non-dotted) file",
    );

    fs.writeFileSync(
      sp.northStarsPath(tmp),
      [
        "# North-stars",
        "",
        "## Invariants",
        "- **NS-1** — Backtest stop model MUST match the live order's stop model.",
        "Some prose that is not a proposition and must be skipped.",
        "* NS-2: Win-rate is NEVER a ranker.",
        "",
        "## Graveyard",
        "- **NS-3** — REJECTED: turnover filter (measured net-negative).",
      ].join("\n"),
    );

    assert.equal(sp.northStarsExists(tmp), true);
    const digest = sp.northStarsDigest(tmp);
    assert.equal(digest.length, 3, "only NS-# lines, prose skipped");
    assert.match(digest[0], /^NS-1 — Backtest stop model/, "markdown bullets/bold stripped");
    assert.match(digest[1], /^NS-2: Win-rate/, "tolerates '* NS-2:' form");
    assert.equal(sp.northStarsDigest(tmp, 2).length, 2, "max caps the digest");

    // Anchor counter: increments, then resets so the next window starts over.
    assert.equal(sp.bumpNorthStarCounter(tmp), 1);
    assert.equal(sp.bumpNorthStarCounter(tmp), 2);
    assert.equal(sp.bumpNorthStarCounter(tmp, true), 0, "reset after an anchor fires");
    assert.equal(sp.bumpNorthStarCounter(tmp), 1);

    // A new session re-arms the counter but must NEVER touch the doc (it's user-owned + committed).
    sp.clearSessionState(tmp);
    assert.equal(sp.northStarsExists(tmp), true, "north-stars survive a session clear");
    assert.equal(sp.bumpNorthStarCounter(tmp), 1, "counter reset by clearSessionState");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("drift counts source files in a BRAND-NEW directory (git collapses untracked dirs)", () => {
    // Regression: `git status --porcelain` without -uall collapses a new directory into a single
    // "?? path/" entry. That entry has no source extension, so scaffolding a whole new module in a
    // new folder produced ZERO drift — the gate was blind exactly when an agent adds a feature.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-drift-"));
    const sh = (c) => execSync(c, { cwd: tmp, stdio: ["ignore", "pipe", "ignore"] });
    sh("git init -q");
    sh("git config user.email t@t.t");
    sh("git config user.name t");
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".gitnexus/\n.bearing/\n");
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/a.js"), "export const a = 1\n");
    sh("git add -A");
    sh("git commit -qm init");

    // Files in a directory that git has never seen.
    fs.mkdirSync(path.join(tmp, "src/brandnew"), { recursive: true });
    for (const i of [1, 2, 3, 4]) {
      fs.writeFileSync(path.join(tmp, `src/brandnew/f${i}.js`), `export const x${i} = ${i}\n`);
    }

    const collapsed = execSync("git -c core.quotePath=false status --porcelain", {
      cwd: tmp,
      encoding: "utf8",
    });
    assert.match(collapsed, /\?\? src\/brandnew\//, "git does collapse the new dir (the trap)");
    assert.ok(
      !/brandnew\/f1\.js/.test(collapsed),
      "individual files are hidden without -uall — this is why the gate went blind",
    );

    const expanded = execSync("git -c core.quotePath=false status --porcelain -uall", {
      cwd: tmp,
      encoding: "utf8",
    });
    const files = expanded.split("\n").filter((l) => /brandnew\/f\d\.js$/.test(l));
    assert.equal(files.length, 4, "-uall lists each new source file so drift can see them");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("drift counts DELETED source files, and clears once the index is rebuilt", () => {
    // A deleted source file is drift the graph cannot self-detect: it keeps serving symbols that no
    // longer exist, so results aren't stale-but-close, they're phantom. There is no file left to
    // stat, so the parent directory's mtime stands in as the deletion timestamp — which preserves
    // the "only counts if newer than indexedAt" rule, so a pending deletion doesn't gate every
    // graph query until it happens to be committed. Runs the real check-staleness script.
    const libSrc = new URL("../bundle/.bearing/lib/", import.meta.url).pathname;
    const build = (deleteBeforeIndexing) => {
      const t = fs.mkdtempSync(path.join(os.tmpdir(), "gn-del-"));
      const sh = (c) => execSync(c, { cwd: t, stdio: ["ignore", "pipe", "ignore"] });
      sh("git init -q");
      sh("git config user.email t@t.t");
      sh("git config user.name t");
      fs.writeFileSync(path.join(t, ".gitignore"), ".gitnexus/\n.bearing/\n");
      fs.mkdirSync(path.join(t, "src"), { recursive: true });
      fs.writeFileSync(path.join(t, "src/a.js"), "export const a = 1\n");
      sh("git add -A");
      sh("git commit -qm init");
      fs.mkdirSync(path.join(t, ".bearing/lib"), { recursive: true });
      for (const f of fs.readdirSync(libSrc)) {
        fs.copyFileSync(path.join(libSrc, f), path.join(t, ".bearing/lib", f));
      }
      fs.mkdirSync(path.join(t, ".gitnexus"), { recursive: true });
      const stamp = () =>
        fs.writeFileSync(
          path.join(t, ".gitnexus/meta.json"),
          JSON.stringify({
            lastCommit: execSync("git rev-parse HEAD", { cwd: t, encoding: "utf8" }).trim(),
            indexedAt: new Date().toISOString(),
            stats: { nodes: 10 },
          }),
        );
      const wait = () => execSync("sleep 0.05"); // mtime vs indexedAt are ms-granular
      if (deleteBeforeIndexing) {
        fs.rmSync(path.join(t, "src/a.js"));
        wait();
        stamp();
      } else {
        stamp();
        wait();
        fs.rmSync(path.join(t, "src/a.js"));
      }
      const out = execSync("node .bearing/lib/check-staleness.mjs", { cwd: t, encoding: "utf8" });
      const drift = JSON.parse(out).driftingFiles;
      fs.rmSync(t, { recursive: true, force: true });
      return drift;
    };

    assert.equal(build(false), 1, "deleted AFTER indexing → counts as drift");
    assert.equal(build(true), 0, "index rebuilt after the deletion → signal clears");
  });

  it("feature modules: a disabled feature never ships, core always does", async () => {
    const { shouldCopyBundleFile } = await import(
      new URL("./kit-shared.mjs", import.meta.url).href
    );
    const { parseFeatures, featureOf, FEATURE_IDS } = await import(
      new URL("./features.mjs", import.meta.url).href
    );

    // The motivating bug: with no GitNexus, the grep guard DENIES Grep and points at a command that
    // does not exist. It must not ship unless the gitnexus feature is on.
    const intel = parseFeatures("northstars,taskcore,microscope");
    assert.equal(
      shouldCopyBundleFile(".claude/hooks/bearing-grep-guard.mjs", "claude", intel),
      false,
      "enforcement gate must not ship without GitNexus",
    );
    assert.equal(
      shouldCopyBundleFile(".claude/hooks/bearing-northstar-anchor.mjs", "claude", intel),
      true,
    );
    // Core ships regardless of which features are chosen.
    for (const f of [parseFeatures("northstars"), parseFeatures("all")]) {
      assert.equal(shouldCopyBundleFile(".bearing/lib/session-primer.mjs", "claude", f), true);
      assert.equal(shouldCopyBundleFile(".claude/hooks/bearing-session.mjs", "claude", f), true);
    }
    // taskcore owns its hook; it must not ship when taskcore is off. (Its lib went with the retired
    // context-pressure estimator — the window is not measurable, so there was nothing left to
    // compute — and the replacement counts edits, which needs no lib of its own.)
    assert.equal(
      shouldCopyBundleFile(
        ".claude/hooks/bearing-taskcore-nudge.mjs",
        "claude",
        parseFeatures("northstars"),
      ),
      false,
    );
    assert.equal(
      shouldCopyBundleFile(".claude/hooks/bearing-taskcore-nudge.mjs", "claude", intel),
      true,
    );

    // Back-compat: omitting features keeps the old behaviour (everything for the runtime).
    assert.equal(shouldCopyBundleFile(".claude/hooks/bearing-grep-guard.mjs", "claude"), true);

    // Every feature id round-trips, and unknown ids are rejected rather than silently ignored.
    assert.deepEqual([...parseFeatures("all")].sort(), [...FEATURE_IDS].sort());
    assert.throws(() => parseFeatures("northstars,bogus"), /Unknown feature/);

    // Ownership sanity: skills route to their feature, unknown skills default to gitnexus.
    assert.equal(featureOf("skills/bearing-northstars/SKILL.md"), "northstars");
    assert.equal(featureOf("skills/bearing-microscope/SKILL.md"), "microscope");
    assert.equal(featureOf("skills/bearing-debugging/SKILL.md"), "gitnexus");
    assert.equal(featureOf(".bearing/lib/hook-helpers.mjs"), null, "core");
  });

  it("every file a REAL install leaves behind is either exempted or deliberately not ours", () => {
    // This used to walk the BUNDLE, and was green while .zed/settings.json sat uncovered — that
    // file is written by the zed ADAPTER, not copied from bundle/, so it was never in the sample.
    // A probe that cannot see a whole category of output reports success in exactly the shape of
    // real coverage (GP-7). So: install for real, then look at what is actually on disk.
    const match = (pat, rel) => {
      if (pat.endsWith("/")) return rel.startsWith(pat);
      if (pat.includes("*")) {
        const re = new RegExp(
          "^" +
            pat
              .split("*")
              .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
              .join("[^/]*") +
            "$",
        );
        return re.test(rel);
      }
      return rel === pat;
    };
    const FORMATTABLE = /\.(mjs|cjs|js|jsx|ts|tsx|json|json5|md|mdc|yml|yaml|css|scss|html|vue)$/;
    // Files Prettier may still touch BY DESIGN. CLAUDE.md and AGENTS.md are the user's — bearing
    // owns a marked block inside them, not the file. package.json is theirs too; bearing only adds
    // npm scripts. .prettierignore is where our block lives, not something our block covers.
    const NOT_OURS = new Set(["AGENTS.md", "CLAUDE.md", "package.json", ".prettierignore"]);

    for (const runtime of ["claude", "zed", "codex"]) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gn-pcov-${runtime}-`));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"c"}\n');
      installKit(tmp, {
        runtime,
        features: "all",
        prettierIgnore: true,
        runSetup: false,
        skipVerify: true,
      });

      const found = [];
      const walk = (dir, prefix = "") => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          if (ent.name === ".git" || ent.name === "node_modules") continue;
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          // Skill farms are symlinks to .bearing/skills; follow neither — the store itself is
          // walked under .bearing/ and a symlink loop would hang the test.
          if (ent.isSymbolicLink()) found.push(rel);
          else if (ent.isDirectory()) walk(path.join(dir, ent.name), rel);
          else if (FORMATTABLE.test(rel)) found.push(rel);
        }
      };
      walk(tmp);
      assert.ok(found.length > 5, `${runtime}: walked almost nothing — the probe is wrong again`);

      const pats = prettierIgnoreLinesFor(runtime);
      const exposed = found.filter((r) => !NOT_OURS.has(r) && !pats.some((pat) => match(pat, r)));
      assert.deepEqual(
        exposed,
        [],
        `${runtime}: installed but not exempted — Prettier will rewrite these and the next update will overwrite them back`,
      );
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("everything bearing gitignores is covered by the block too — .gitignore is not a crutch", () => {
    // Prettier 3 reads .gitignore, so anything bearing ignores there LOOKS covered. It is not:
    // Prettier 2 does not, and neither does any run with an explicit --ignore-path. A live install
    // proved it — `prettier --list-different . --ignore-path .prettierignore` exposed six
    // .gitnexus/ files that every other check called clean.
    //
    // So the rule is: if bearing ignores a path in git BECAUSE bearing creates it, the block owns
    // it too. Derived from the .gitignore we actually write, not from a second hand-kept list,
    // because that list is what went stale in the first place (GP-11).
    const match = (pat, rel) => {
      if (pat.endsWith("/")) return rel.startsWith(pat);
      if (pat.includes("*")) {
        const re = new RegExp(
          "^" +
            pat
              .split("*")
              .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
              .join("[^/]*") +
            "$",
        );
        return re.test(rel);
      }
      return rel === pat;
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gicov-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"g"}\n');
    installKit(tmp, {
      runtime: "all",
      features: "all",
      prettierIgnore: true,
      runSetup: false,
      skipVerify: true,
    });

    const ignored = fs
      .readFileSync(path.join(tmp, ".gitignore"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
    assert.ok(ignored.length > 8, "read almost no ignore rules — the probe is wrong again");

    // A rule matters here if it can hide something Prettier would otherwise format: a directory
    // (which may contain anything) or a file with a formattable extension.
    const FORMATTABLE = /\.(mjs|cjs|js|jsx|ts|tsx|json|json5|md|mdc|yml|yaml)$|\/$/;
    const pats = prettierIgnoreLinesFor("all");
    const uncovered = ignored
      .filter((l) => FORMATTABLE.test(l))
      .filter((l) => !pats.some((pat) => match(pat, l.endsWith("/") ? l + "probe.json" : l.replace(/\*/g, "probe"))));
    assert.deepEqual(
      uncovered,
      [],
      "bearing gitignores these but the block does not cover them — they survive only while Prettier keeps reading .gitignore",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("prettier detection reports the evidence, and finds it wherever Prettier hides it", async () => {
    const { detectPrettier } = await import(new URL("./prettier.mjs", import.meta.url).href);
    const mk = (files) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "gn-pdetect-"));
      for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
      return d;
    };
    // Every shape Prettier is configured in. The extension list is deliberately not hard-coded in
    // the detector — .prettierrc takes eight of them — so a repo using the one we forgot would be
    // told it has no Prettier.
    for (const name of [".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.cjs"]) {
      assert.equal(detectPrettier(mk({ [name]: "{}" })).found, true, `missed ${name}`);
    }
    assert.equal(detectPrettier(mk({ "prettier.config.mjs": "export default {}" })).found, true);
    assert.equal(
      detectPrettier(mk({ "package.json": '{"prettier":{"semi":false}}' })).found,
      true,
      "missed the package.json key",
    );
    assert.equal(
      detectPrettier(mk({ "package.json": '{"devDependencies":{"prettier":"^3"}}' })).found,
      true,
    );
    // A repo can configure Prettier entirely in editor settings and keep only the ignore list.
    assert.equal(detectPrettier(mk({ ".prettierignore": "dist/\n" })).found, true);

    // ...and it must not cry wolf: being asked to edit a config file on a false positive is worse
    // than not asking.
    assert.equal(detectPrettier(mk({ "package.json": '{"name":"x"}' })).found, false);
    assert.equal(detectPrettier(mk({ "package.json": "not json at all" })).found, false);
    assert.equal(detectPrettier(mk({})).found, false);

    // The prompt quotes this back, so it has to name what was actually seen (GP-1, GP-8).
    assert.equal(
      detectPrettier(mk({ "package.json": '{"devDependencies":{"prettier":"^3"}}' })).why,
      "package.json: devDependencies.prettier",
    );
  });

  it("prettierignore is opt-in, survives update, reverses cleanly, and never runs under stealth", async () => {
    const { detectPrettier } = await import(new URL("./prettier.mjs", import.meta.url).href);
    const mk = () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "gn-pig-"));
      execSync("git init -q", { cwd: d });
      fs.writeFileSync(path.join(d, "package.json"), '{"name":"a","devDependencies":{"prettier":"^3"}}\n');
      fs.writeFileSync(path.join(d, ".prettierignore"), "dist/\n");
      execSync("git add -A && git commit -qm i", { cwd: d, shell: "/bin/bash" });
      return d;
    };
    const read = (d) => fs.readFileSync(path.join(d, ".prettierignore"), "utf8");

    // OPT-IN. Detecting Prettier is not consent to edit the repo's configuration.
    const a = mk();
    installKit(a, { runtime: "claude", features: "northstars", runSetup: false, skipVerify: true });
    assert.equal(read(a), "dist/\n", "installed into .prettierignore without being asked");
    assert.equal(readManifest(a).data.prettierIgnore, false);

    // Yes → a managed block, the user's own rule untouched above it.
    installKit(a, {
      runtime: "claude",
      features: "northstars",
      prettierIgnore: true,
      runSetup: false,
      skipVerify: true,
    });
    assert.match(read(a), /^dist\/$/m, "the user's own rule was lost");
    assert.match(read(a), /^\.bearing\/$/m);
    assert.equal(readManifest(a).data.createdPrettierIgnore, false, "claimed a file the user wrote");

    // The answer persists across an update that does not mention it, and the block REFRESHES
    // rather than doubling — an install that appends a second block is how ignore files rot.
    updateKit(a, { runSetup: false, skipVerify: true });
    assert.equal(read(a).match(/# bearing —/g).length, 1, "update appended a second block");

    // A rule the user adds AFTER our block must survive the next update: that is what the closing
    // sentinel is for, and .gitignore lost exactly this way before it had one.
    fs.appendFileSync(path.join(a, ".prettierignore"), "coverage/\n");
    updateKit(a, { runSetup: false, skipVerify: true });
    assert.match(read(a), /coverage\//, "a rule appended after the block was swallowed");

    // No → the block comes back out, and nothing of the user's goes with it.
    updateKit(a, { prettierIgnore: false, runSetup: false, skipVerify: true });
    assert.doesNotMatch(read(a), /# bearing —/, "opting out left the block behind");
    assert.match(read(a), /dist\//);
    assert.match(read(a), /coverage\//);

    // A file bearing CREATED is bearing's to remove; one the user wrote is not.
    const b = mk();
    fs.rmSync(path.join(b, ".prettierignore"));
    installKit(b, {
      runtime: "claude",
      features: "northstars",
      prettierIgnore: true,
      runSetup: false,
      skipVerify: true,
    });
    assert.equal(readManifest(b).data.createdPrettierIgnore, true);
    uninstallKit(b);
    assert.equal(
      fs.existsSync(path.join(b, ".prettierignore")),
      false,
      "uninstall stranded a .prettierignore that only existed because we made it",
    );

    // STEALTH: the promise is that git status is exactly as clean afterwards. .prettierignore is
    // the repo's own config — tracked here, and visibly untracked if created — so it is refused
    // even when explicitly asked for, and the refusal is reported rather than silent.
    const c = mk();
    assert.ok(detectPrettier(c).found, "fixture does not look like a Prettier repo");
    const before = execSync("git status --porcelain", { cwd: c, encoding: "utf8" });
    installKit(c, {
      runtime: "claude",
      features: "northstars",
      stealth: true,
      prettierIgnore: true,
      runSetup: false,
      skipVerify: true,
    });
    assert.equal(read(c), "dist/\n", "stealth wrote to the repo's own config");
    assert.equal(readManifest(c).data.prettierIgnore, false);
    assert.equal(
      execSync("git status --porcelain", { cwd: c, encoding: "utf8" }),
      before,
      "stealth install changed git status",
    );
    const { stealthLimits } = await import(new URL("./stealth.mjs", import.meta.url).href);
    assert.ok(
      stealthLimits(c, "claude").some((l) => l.id === "prettierignore"),
      "stealth skipped it without saying so",
    );
  });

  it("intel-only install: no GitNexus files, and every installed hook still RUNS", () => {
    // Unit-testing the filter was not enough — it passed while the install was actually broken.
    // A core module may never depend on a feature module, and that invariant silently broke twice
    // (claude-emit -> stale-policy, hook-helpers -> cypher-helpers), leaving hooks that crash with
    // MODULE_NOT_FOUND. So: do a real install and execute what it produced.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-intel-"));
    const sh = (c) => execSync(c, { cwd: tmp, stdio: ["ignore", "pipe", "ignore"] });
    sh("git init -q");
    sh("git config user.email t@t.t");
    sh("git config user.name t");
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"intel-only"}');
    sh("git add -A");
    sh("git commit -qm init");

    const kit = new URL("./kit.mjs", import.meta.url).pathname;
    execSync(
      `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime claude ` +
        "--features northstars,taskcore,microscope --no-setup --skip-verify",
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    // No enforcement surface. NOTE the prefix: this asserted `gitnexus-${guard}.mjs` after the
    // rename, a path that can never exist, so it passed vacuously while the real bug shipped.
    for (const guard of ["grep-guard", "read-guard", "edit-guard", "mcp-guard", "bash-guard"]) {
      assert.ok(
        !fs.existsSync(path.join(tmp, `.claude/hooks/bearing-${guard}.mjs`)),
        `${guard} must not ship without the gitnexus feature`,
      );
    }
    // The file filter was never the whole story: settings.json, npm scripts and .mcp.json are
    // separate channels that all re-introduced the enforcement surface after it was filtered out.
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8"));
    for (const group of Object.values(settings.hooks ?? {}).flat()) {
      const script = group.hooks[0].command.match(/bearing-[a-z-]+\.mjs/)?.[0];
      assert.ok(
        script && fs.existsSync(path.join(tmp, ".claude/hooks", script)),
        `settings.json registers ${script}, which was not installed`,
      );
    }
    const consumerPkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
    assert.equal(
      Object.keys(consumerPkg.scripts ?? {}).length,
      0,
      "bearing:* scripts run node scripts/bearing-*.mjs, which is gitnexus-owned — none may be added",
    );
    assert.ok(
      !fs.existsSync(path.join(tmp, ".mcp.json")),
      "the GitNexus MCP server must not be wired when the module was declined",
    );
    assert.deepEqual(
      fs.readdirSync(path.join(tmp, ".bearing/skills")).sort(),
      // bearing-pr rides with microscope: both fire at a milestone, and PR authoring degrades to
      // git+grep without the graph, so it is not gitnexus-owned.
      ["bearing-microscope", "bearing-northstars", "bearing-pr", "bearing-taskcore"],
      "only the chosen features' skills",
    );

    // The real assertion: everything that DID install must execute without a missing import.
    fs.writeFileSync(
      path.join(tmp, ".bearing/northstars.md"),
      "# NS\n- **NS-1** — Test invariant.\n",
    );
    const payload = JSON.stringify({
      source: "startup",
      tool_name: "Write",
      tool_input: { file_path: "a.md" },
      cwd: tmp,
    });
    for (const hook of fs.readdirSync(path.join(tmp, ".claude/hooks"))) {
      const out = execSync(
        `printf %s ${JSON.stringify(payload)} | node ${JSON.stringify(path.join(tmp, ".claude/hooks", hook))} 2>&1 || true`,
        { cwd: tmp, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } },
      );
      assert.ok(
        !/MODULE_NOT_FOUND|Cannot find module/.test(out),
        `${hook} crashed on a missing dependency: ${out.slice(0, 160)}`,
      );
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rename migration: .gnkit -> .bearing PRESERVES the user's irreplaceable files", async () => {
    // .gnkit/ is not disposable — it holds the north-stars (the semantic anchor), the in-flight
    // task-core, and per-machine config. If the rename let the copy step create a fresh .bearing/
    // beside it, an upgrade would silently orphan all three.
    const { migrateLegacyInstall } = await import("./migrate.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-mig-"));
    fs.mkdirSync(path.join(tmp, ".gnkit/lib"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gnkit/northstars.md"),
      "# North-stars\n- **NS-1** — Irreplaceable invariant.\n",
    );
    fs.writeFileSync(path.join(tmp, ".gnkit/.task-core.md"), "in-flight task state");
    fs.writeFileSync(
      path.join(tmp, ".gnkit/gitnexus-hooks.local.json"),
      '{"contextWindowTokens":1000000}',
    );

    migrateLegacyInstall(tmp, "claude");

    assert.ok(!fs.existsSync(path.join(tmp, ".gnkit")), "legacy dir moved, not left behind");
    assert.match(
      fs.readFileSync(path.join(tmp, ".bearing/northstars.md"), "utf8"),
      /Irreplaceable invariant/,
      "north-stars survived",
    );
    assert.match(
      fs.readFileSync(path.join(tmp, ".bearing/.task-core.md"), "utf8"),
      /in-flight/,
      "task-core survived",
    );
    assert.match(
      fs.readFileSync(path.join(tmp, ".bearing/hooks.local.json"), "utf8"),
      /1000000/,
      "per-machine config survived",
    );

    // Both present (a half-finished upgrade): refuse to guess which is authoritative.
    const two = fs.mkdtempSync(path.join(os.tmpdir(), "gn-mig2-"));
    fs.mkdirSync(path.join(two, ".gnkit"), { recursive: true });
    fs.mkdirSync(path.join(two, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(two, ".gnkit/keep.md"), "old");
    const { actions } = migrateLegacyInstall(two, "claude");
    assert.ok(fs.existsSync(path.join(two, ".gnkit/keep.md")), "ambiguous case left untouched");
    assert.ok(actions.some((a) => /review manually/.test(a)), "and it says so");

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });
  });

  it("rename migration moves the north-stars FILE, not just the directory", async () => {
    // Caught in end-to-end testing, not by unit tests: a bulk sed during the rename rewrote the
    // migration's OWN lookup table ("gitnexus-northstars.md" -> "bearing-northstars.md"), so it
    // searched for a filename that never existed. The upgrade reported success, left the real file
    // behind under its old name, and the anchor silently ceased to exist — no error, the agent just
    // stops being anchored. Assert the CONTENT arrives at the new path.
    const { migrateLegacyInstall } = await import("./migrate.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-ns-mig-"));
    fs.mkdirSync(path.join(tmp, ".gnkit"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gnkit/gitnexus-northstars.md"),
      "# North-stars\n- **NS-1** — Irreplaceable invariant.\n",
    );
    fs.writeFileSync(path.join(tmp, ".gnkit/.gitnexus-task-core.md"), "in-flight state");
    fs.writeFileSync(
      path.join(tmp, ".gnkit/gitnexus-hooks.local.json"),
      '{"contextWindowTokens":1000000}',
    );

    migrateLegacyInstall(tmp, "claude");

    assert.match(
      fs.readFileSync(path.join(tmp, ".bearing/northstars.md"), "utf8"),
      /Irreplaceable invariant/,
      "north-stars content must arrive at the new path",
    );
    assert.match(
      fs.readFileSync(path.join(tmp, ".bearing/.task-core.md"), "utf8"),
      /in-flight/,
    );
    assert.match(
      fs.readFileSync(path.join(tmp, ".bearing/hooks.local.json"), "utf8"),
      /1000000/,
    );
    assert.equal(
      fs.readdirSync(path.join(tmp, ".bearing")).filter((f) => f.includes("gitnexus")).length,
      0,
      "no legacy-named file left orphaned",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("two chats in one repo keep separate task-cores", async () => {
    // A single .bearing/.task-core.md was wrong the moment two sessions ran in one repository —
    // which is normal, not an edge case. The failure is worse than losing the file: on recovery a
    // session reads whatever the last writer left, so it reconstructs from ANOTHER CHAT'S TASK with
    // full confidence. That is exactly the drift a task-core exists to prevent.
    const sp = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cores-"));
    sp.ensureTaskCoreDir(tmp);

    const chatA = "/home/u/.claude/projects/p/aaaaaaaa-1111-2222-3333-444444444444.jsonl";
    const chatB = "/home/u/.claude/projects/p/bbbbbbbb-5555-6666-7777-888888888888.jsonl";

    const pa = sp.taskCorePath(tmp, chatA);
    const pb = sp.taskCorePath(tmp, chatB);
    assert.notEqual(pa, pb, "two chats must not share one path");

    fs.writeFileSync(pa, "GOAL: ship the parser\n");
    fs.writeFileSync(pb, "GOAL: fix the billing bug\n");

    // Each chat reads back its OWN task, not the other's.
    assert.match(fs.readFileSync(sp.taskCoreReadPath(tmp, chatA), "utf8"), /ship the parser/);
    assert.match(fs.readFileSync(sp.taskCoreReadPath(tmp, chatB), "utf8"), /fix the billing bug/);
    assert.ok(sp.taskCoreExists(tmp, chatA) && sp.taskCoreExists(tmp, chatB));

    // A chat that never wrote one has none — it must not inherit a neighbour's.
    const chatC = "/home/u/.claude/projects/p/cccccccc-9999-0000-1111-222222222222.jsonl";
    assert.equal(sp.taskCoreExists(tmp, chatC), false, "a new chat inherited another chat's core");

    // The key is filesystem-safe: a transcript path is untrusted input that becomes a filename.
    assert.equal(sp.sessionKey("../../etc/passwd"), "passwd");
    assert.equal(sp.sessionKey(""), "shared", "no transcript must not produce an empty filename");

    // An in-flight core from BEFORE this change is still found, so an upgrade mid-task loses nothing.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "gn-legacy-"));
    fs.mkdirSync(path.join(fresh, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(fresh, ".bearing/.task-core.md"), "GOAL: mid-upgrade task\n");
    assert.ok(sp.taskCoreExists(fresh, chatA), "legacy single-file core went unseen after upgrade");
    assert.match(fs.readFileSync(sp.taskCoreReadPath(fresh, chatA), "utf8"), /mid-upgrade/);

    // Pruning sweeps old chats and never the current one, however old it looks.
    const old = sp.taskCorePath(tmp, chatB);
    const ancient = Date.now() - 60 * 24 * 60 * 60 * 1000;
    fs.utimesSync(old, ancient / 1000, ancient / 1000);
    fs.utimesSync(pa, ancient / 1000, ancient / 1000); // current chat, also ancient
    sp.pruneTaskCores(tmp, chatA);
    assert.ok(fs.existsSync(pa), "pruning deleted the CURRENT chat's core");
    assert.ok(!fs.existsSync(old), "pruning left a long-dead chat's core behind");

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
  });

  it("the shipped version has release notes, and they are not a stub", async () => {
    // The changelog is a FOURTH surface nothing keeps aligned (NS-16), and the most likely way it
    // rots is the boring one: a version gets published with no entry, or with a heading and no
    // body. Both are cheap to check and neither is caught by anything else. This does not try to
    // verify the notes are ACCURATE — nothing can — only that they exist for what ships.
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const log = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

    const heading = new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")}\\b.*$`, "m");
    const m = log.match(heading);
    assert.ok(
      m,
      `package.json is ${pkg.version} but CHANGELOG.md has no "## ${pkg.version}" section — ` +
        `publishing that ships a version nobody can read the notes for`,
    );

    // A heading with nothing under it is the same failure wearing a disguise.
    const body = log.slice(log.indexOf(m[0]) + m[0].length).split(/^## /m)[0];
    assert.ok(
      body.trim().length > 200,
      `the ${pkg.version} section is a stub (${body.trim().length} chars) — write what changed`,
    );

    // "Unreleased" must not outlive the release: if it still names the current version's work the
    // next release inherits a section that already shipped.
    const unreleased = log.match(/^## Unreleased.*$/m);
    if (unreleased) {
      const u = log.slice(log.indexOf(unreleased[0]) + unreleased[0].length).split(/^## /m)[0];
      assert.ok(
        u.trim().length > 0,
        "an empty Unreleased heading is left over from a release — remove it",
      );
    }
  });

  it("product metadata stays in sync with the code (no third-copy drift)", async () => {
    // The product is described in THREE places that nothing keeps aligned: package.json (what npm
    // shows), README.md (what GitHub shows), and the GitHub About blurb. They drifted for real —
    // npm advertised "Cursor, Zed, Claude Code" for a release that had shipped Codex, because the
    // README was updated and package.json was not. The CODE is the source of truth for what exists;
    // this asserts the marketing surfaces have not fallen behind it.
    const { VALID_RUNTIMES } = await import("./constants.mjs");
    const { FEATURE_IDS } = await import("./features.mjs");
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

    // Aliases are not products; only the concrete runtimes must be advertised.
    const runtimes = VALID_RUNTIMES.filter((r) => !["both", "all"].includes(r));
    for (const rt of runtimes) {
      assert.ok(
        pkg.keywords.some((k) => k.includes(rt)),
        `runtime "${rt}" exists in code but is missing from package.json keywords`,
      );
      assert.ok(
        new RegExp(rt, "i").test(readme),
        `runtime "${rt}" exists in code but is never mentioned in README.md`,
      );
    }
    for (const id of FEATURE_IDS) {
      assert.ok(
        new RegExp(id === "gitnexus" ? "gitnexus" : id.replace("northstars", "north-?stars"), "i").test(
          readme,
        ),
        `feature "${id}" is installable but undocumented in README.md`,
      );
    }
    // npm's own surface must not be empty or stale-by-omission.
    assert.ok(pkg.description.length > 60, "description too thin for a package page");
    assert.ok(pkg.homepage && pkg.bugs?.url, "homepage + bugs links required");

    // The CLI and the interactive installer are marketing surfaces too — and the ones a new user
    // meets FIRST. Both fell behind the same way: `npx bearing` greeted people with "Cursor, Zed,
    // Claude Code" and offered "All — every adapter (Cursor + Zed + Claude Code)" long after `all`
    // resolved to four adapters including Codex, so picking All looked like it excluded Codex.
    const { activeAdapters } = await import("./adapters/index.mjs");
    const allIds = activeAdapters("all").map((a) => a.id);
    const surfaces = {
      "lib/interactive.mjs": fs.readFileSync(
        new URL("./interactive.mjs", import.meta.url),
        "utf8",
      ),
      "lib/prompt.mjs": fs.readFileSync(new URL("./prompt.mjs", import.meta.url), "utf8"),
      "bin/install.sh": fs.readFileSync(new URL("../bin/install.sh", import.meta.url), "utf8"),
    };
    for (const [file, text] of Object.entries(surfaces)) {
      // Any line that enumerates runtimes must enumerate ALL of them. Find the lines that name at
      // least two, then require every runtime `all` resolves to.
      for (const line of text.split("\n")) {
        const named = allIds.filter((id) => new RegExp(id, "i").test(line));
        if (named.length < 2) continue;
        for (const id of allIds) {
          assert.ok(
            new RegExp(id, "i").test(line),
            `${file} lists runtimes but omits "${id}": ${line.trim().slice(0, 90)}`,
          );
        }
      }
    }
  });

  it("migration removes legacy hook files, but only when superseded", async () => {
    // The copy step writes bearing-*.mjs and never removes gitnexus-*.mjs, so an upgraded repo kept
    // a full set of orphans — unwired, but dead files that read as live. Found by verifying a real
    // repo after upgrade, not by any unit test.
    const { migrateLegacyInstall } = await import("./migrate.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-hookclean-"));
    const hooks = path.join(tmp, ".claude/hooks");
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, "gitnexus-grep-guard.mjs"), "old");
    // NOTE: the replacement is deliberately NOT created here. Migration runs BEFORE the copy step,
    // so in a real upgrade the target has no bearing-* yet — the check must consult the BUNDLE.
    // No bearing- counterpart: must NOT be deleted, we did not supersede it.
    fs.writeFileSync(path.join(hooks, "gitnexus-custom-thing.mjs"), "user's own");

    migrateLegacyInstall(tmp, "claude");

    assert.ok(
      !fs.existsSync(path.join(hooks, "gitnexus-grep-guard.mjs")),
      "superseded by the bundle → removed on the FIRST run, without needing a second update",
    );
    assert.ok(
      fs.existsSync(path.join(hooks, "gitnexus-custom-thing.mjs")),
      "unsuperseded file must survive — never delete what we did not replace",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("core-lib closure follows dynamic imports but ignores JSDoc type references", async () => {
    // The closure decides which libs are CORE (always shipped). Two ways to get it wrong, and both
    // were live: missing `await import('./x.mjs')` lets a core module depend on a feature module
    // invisibly (breaks at runtime in a filtered install); counting JSDoc
    // `@param {import('./y.mjs').T}` wrongly promotes a feature module into core (ships it to
    // everyone and muddies the boundary).
    const { coreLibClosure } = await import(new URL("./features.mjs", import.meta.url).href);
    const closure = coreLibClosure();

    // Real runtime deps of core entries are present.
    for (const must of ["hook-helpers.mjs", "session-primer.mjs", "claude-emit.mjs", "stale-policy.mjs"]) {
      assert.ok(closure.has(must), `${must} is a real core dependency`);
    }
    // classify.mjs is referenced ONLY in JSDoc by core emit shims — it is gitnexus-owned and must
    // not be dragged into core by a comment.
    assert.ok(
      !closure.has("classify.mjs"),
      "classify.mjs is only a JSDoc type reference from core — it must stay feature-owned",
    );
    // Every closure member must therefore be core (featureOf -> null), or the map is inconsistent.
    const { featureOf } = await import(new URL("./features.mjs", import.meta.url).href);
    for (const lib of closure) {
      assert.equal(featureOf(`.bearing/lib/${lib}`), null, `${lib} is in the core closure but owned by a feature`);
    }
  });

  it("guards do not deny legitimate work (three reproduced false denies)", async () => {
    const { classifyGrep, classifyShell } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const { loadHookConfig, isSourceCodePath } = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const config = loadHookConfig("/nonexistent");
    const base = {
      root: "/repo", config, phase: "fresh", mode: "enforce", repo: "r",
      staleMustRefreshMsg: "S", staleFallbackMsg: "F",
    };
    const grep = (pattern, extra = {}) =>
      classifyGrep({ tool: "Grep", toolInput: { pattern, ...extra } }, base);
    const shell = (command) => classifyShell({ command }, base)?.decision ?? "allow";

    // (a) Markers are literals, not symbols. These denied with a redirect to
    // gitnexus_context({name:"TODO"}) — a lookup that cannot resolve.
    assert.equal(grep("TODO", { path: "src/" }).decision, "allow");
    assert.equal(grep("FIXME").decision, "allow");
    // ...without weakening real symbol detection, including alternations that LOOK literal
    // because they contain spaces.
    assert.equal(grep("handleOrder").decision, "deny");
    assert.equal(grep("isScaleIn =|const oppStop", { path: "src/" }).decision, "deny");

    // (b) A piped search reads STDIN — the graph cannot answer it, so a redirect is
    // unfollowable. Previously only grep/egrep/fgrep were exempt; rg/ag/ack are "recursive
    // by default", so ordinary log filtering was denied.
    assert.equal(shell("npm run build 2>&1 | rg error"), "allow");
    assert.equal(shell("kubectl get pods | rg gateway"), "allow");
    assert.equal(shell("ps aux | grep node"), "allow");
    // ...while a real repo search still gates.
    assert.equal(shell("rg handleOrder src/"), "deny");
    // Directory, not a single file — scoping to one named file is verification and now passes
    // (scope-policy note above); the sweep is what this is guarding.
    assert.equal(shell("grep -n 'computeDryRunPnl' src/ | head"), "deny");

    // (c) Classification must be location-independent. sourceGlobs compile to patterns that
    // match "/src/" ANYWHERE, so an absolute path made a checkout under ~/src or ~/go/src
    // classify every file as source — gating every large Read and every Edit repo-wide.
    assert.equal(
      isSourceCodePath("/home/u/src/proj/tools/gen.js", config, "/home/u/src/proj"),
      false,
      "a repo living under ~/src must not have its non-source files gated",
    );
    assert.equal(
      isSourceCodePath("/home/u/src/proj/src/real.js", config, "/home/u/src/proj"),
      true,
      "genuinely-source paths still classify",
    );
  });

  it("no lockouts: empty repo, kit's own update, and a failed refresh all stay usable", async () => {
    const { evaluateStalePolicy, ESCAPE_HINT } = await import(
      new URL("../bundle/.bearing/lib/stale-policy.mjs", import.meta.url).href
    );
    const sh = (c, cwd) => execSync(c, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    const staleness = (root) =>
      JSON.parse(
        execSync(`node ${JSON.stringify(path.join(root, ".bearing/lib/check-staleness.mjs"))}`, {
          cwd: root,
          encoding: "utf8",
        }),
      );
    const mk = () => {
      const t = fs.mkdtempSync(path.join(os.tmpdir(), "gn-lock-"));
      sh("git init -q", t);
      sh("git config user.email t@t.t", t);
      sh("git config user.name t", t);
      fs.mkdirSync(path.join(t, ".bearing/lib"), { recursive: true });
      fs.mkdirSync(path.join(t, ".gitnexus"), { recursive: true });
      const libSrc = new URL("../bundle/.bearing/lib/", import.meta.url).pathname;
      for (const f of fs.readdirSync(libSrc)) {
        fs.copyFileSync(path.join(libSrc, f), path.join(t, ".bearing/lib", f));
      }
      return t;
    };

    // (a) A repo with NO COMMITS is a legitimate state, not a failure. It denied ls/cat/Read/Grep
    // with "mandatory refresh" — advice that cannot help, since there is nothing to index.
    const empty = mk();
    fs.writeFileSync(
      path.join(empty, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: "abc", indexedAt: "2026-01-01T00:00:00Z", stats: { nodes: 10 } }),
    );
    const s1 = staleness(empty);
    assert.equal(s1.reason, "no_commits");
    assert.equal(evaluateStalePolicy(s1, empty).phase, "fresh", "an empty repo must not lock down");

    // (b) `bearing update` rewrites the kit's own .mjs files without re-indexing; counting those as
    // drift made the tool gate itself immediately after updating.
    fs.writeFileSync(path.join(empty, "real.js"), "export const a = 1\n");
    sh("git add -A", empty);
    sh("git commit -qm init", empty);
    fs.writeFileSync(
      path.join(empty, ".gitnexus/meta.json"),
      JSON.stringify({
        lastCommit: sh("git rev-parse HEAD", empty).toString().trim(),
        indexedAt: new Date().toISOString(),
        stats: { nodes: 10 },
      }),
    );
    execSync("sleep 0.05");
    fs.appendFileSync(path.join(empty, ".bearing/lib/hook-helpers.mjs"), "\n// touched by update\n");
    assert.equal(staleness(empty).driftingFiles, 0, "the kit's own files are not the user's drift");
    fs.appendFileSync(path.join(empty, "real.js"), "\n// user edit\n");
    assert.equal(staleness(empty).driftingFiles, 1, "a real user edit still counts");

    // (c) A blocked session must be able to find its way out.
    assert.match(ESCAPE_HINT, /bearing:fallback/);
    assert.match(ESCAPE_HINT, /guide/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("hot-path guards: bounded line count, subcommand-accurate git, spawn-aware closure", async () => {
    const { coreLibClosure } = await import(new URL("./features.mjs", import.meta.url).href);
    // A core module can depend on a feature module through a CHILD PROCESS, which no import scan
    // sees: claude-emit spawns load-staleness.mjs. In an intel-only install that file was absent,
    // so gnContext silently degraded to must_refresh and precompact wrote "index: must_refresh"
    // into the user's memory for a repo with no index. It never crashed, so the "every hook runs"
    // test passed while the invariant was broken.
    const closure = coreLibClosure();
    assert.ok(closure.has("load-staleness.mjs"), "spawned dependency must be core");
    assert.ok(closure.has("check-staleness.mjs"), "and its own transitive dependency");

    // The read guard only needs "is it bigger than N", but read the whole file to find out —
    // 398ms / ~230MB RSS on a 54MB file, before every Read. Bounded scan stops early.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-big-"));
    const big = path.join(tmp, "big.js");
    fs.writeFileSync(big, Array.from({ length: 200000 }, (_, i) => `const x${i} = ${i};`).join("\n"));
    const started = Date.now();
    const CHUNK = 65536;
    const buf = Buffer.allocUnsafe(CHUNK);
    const fd = fs.openSync(big, "r");
    let lines = 1;
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      if (lines > 60) break;
    }
    fs.closeSync(fd);
    assert.ok(lines > 60, "threshold detected");
    assert.ok(pos < fs.statSync(big).size / 10, "stopped early instead of reading the file");
    assert.ok(Date.now() - started < 200, "bounded scan is fast");
    fs.rmSync(tmp, { recursive: true, force: true });

    // `commit` must be the SUBCOMMAND. As a loose substring this denied read-only git work.
    const isCommit = (c) => /\bgit\b(?:\s+\S+)*?\s+commit(?:\s|$)/.test(c);
    assert.ok(isCommit("git commit -m x"));
    assert.ok(isCommit("git -c user.name=x commit"), "options before the subcommand");
    assert.ok(!isCommit("git rev-parse HEAD^{commit}"));
    assert.ok(!isCommit("git log --grep=commit"));
    assert.ok(!isCommit("git show abc -- src/commit.ts"));
  });

  it("fallback reports persist the reason + graph state for upstream review", async () => {
    const sp = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-fbrep-"));
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({
        version: "1.6.9",
        lastCommit: "abcdef1234567",
        indexedAt: "2026-07-17T00:00:00Z",
        stats: { files: 100, nodes: 42000, edges: 91000, embeddings: 5117, processes: 300 },
      }),
    );

    assert.equal(sp.readFallbackReports(tmp).length, 0);
    assert.equal(
      sp.appendFallbackReport(tmp, "impact returned 0 callers for OrderService but grep finds 3"),
      true,
    );
    sp.appendFallbackReport(tmp, "second reason");
    const r = sp.readFallbackReports(tmp);
    assert.equal(r.length, 2, "append-only log");
    assert.match(r[0].reason, /OrderService/);
    assert.equal(r[0].index.nodes, 42000);
    assert.equal(r[0].index.embeddings, 5117);
    assert.equal(r[0].gitnexusVersion, "1.6.9");
    assert.equal(r[0].indexedCommit, "abcdef1234567");
    assert.equal(r[0].repo, path.basename(tmp));

    // Durable: survives a session clear (it's a report log, not session state).
    sp.clearSessionState(tmp);
    assert.equal(sp.readFallbackReports(tmp).length, 2, "reports survive session clear");

    // Missing index → still logs the reason (a missing index is itself a signal).
    fs.rmSync(path.join(tmp, ".gitnexus"), { recursive: true, force: true });
    sp.appendFallbackReport(tmp, "GN index missing");
    const r2 = sp.readFallbackReports(tmp);
    assert.equal(r2.length, 3);
    assert.equal(r2[2].index.nodes, null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("session-health-audit builds agent context and user message", async () => {
    const auditMod = await import(
      new URL(
        "../bundle/.bearing/lib/session-health-audit.mjs",
        import.meta.url,
      ).href
    );
    const ctx = auditMod.agentContextForSession({
      repo: "demo",
      healthy: true,
      checks: [{ id: "hooks", ok: true }],
    });
    assert.ok(ctx.includes("SESSION HEALTH"));
    assert.ok(ctx.includes("agent-status"));
    const msg = auditMod.userMessageForSession({ healthy: true, stale: {} });
    assert.ok(msg.includes("bearing is active"), "user notice should name the product");
  });

  it("the always-on contract is filtered to the installed modules (NS-13)", async () => {
    const { filterContractByFeatures, contractIsEmpty } = await import(
      new URL("./contract-filter.mjs", import.meta.url).href
    );
    const { FEATURE_IDS } = await import(new URL("./features.mjs", import.meta.url).href);
    const md = fs.readFileSync(
      path.join(BUNDLE_ROOT, "templates/CLAUDE.gitnexus.md"),
      "utf8",
    );
    // Derived, not listed. Hand-maintained as a literal it silently went stale the moment a
    // fifth module was added: the new section vanished from the "all features" render and the
    // no-op assertion started testing nothing about it (NS-2's lesson, one file over).
    const ALL = new Set(FEATURE_IDS);

    // The contract must survive a full install byte-for-byte apart from the tags themselves —
    // filtering may not quietly reword the document everyone already relies on.
    const untagged = md
      .replace(/^<!--\s*feature:.*-->\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    assert.equal(filterContractByFeatures(md, ALL), untagged, "all-features must be a no-op");
    assert.equal(filterContractByFeatures(md, null), untagged, "null = back-compat keep-all");

    // The negative case (NS-12): an intel-only contract must not name a single graph tool or an
    // npm script that install did not create. This is the doc the agent treats as authoritative.
    const intel = filterContractByFeatures(md, new Set(["northstars", "taskcore", "microscope"]));
    for (const forbidden of [
      /gitnexus_query|gitnexus_context|gitnexus_impact/,
      /agent-refresh|full-pdg|bearing:refresh/,
      /cypher/i,
      /MCP server/i,
      /detect_changes/,
    ]) {
      assert.doesNotMatch(intel, forbidden, `intel-only contract leaks ${forbidden}`);
    }
    // ...and must still carry the modules that WERE installed.
    assert.match(intel, /north-stars/i);
    assert.match(intel, /task-core/i);
    assert.match(intel, /microscope/i);
    assert.ok(!contractIsEmpty(intel));

    // Nesting: dropping `## Graph + embeddings + cypher` must take its `###` child with it,
    // or the filtered doc keeps an orphaned subsection about a module that isn't installed.
    assert.doesNotMatch(
      filterContractByFeatures(md, new Set(["northstars"])),
      /### When to escalate/,
      "nested subsection orphaned by its parent being dropped",
    );

    // Tags are an implementation detail and must never reach a user-facing doc.
    for (const feats of [ALL, new Set(["northstars"]), new Set()]) {
      assert.doesNotMatch(filterContractByFeatures(md, feats), /<!--\s*feature:/);
    }

    // A tag on a non-heading line applies to that PARAGRAPH. Section granularity could not express
    // a sentence inside a CORE section that only makes sense with a module installed: the
    // north-stars section distinguished itself from "the graph-first North star above", which in an
    // intel-only repo points at a section this filter had just deleted.
    const para = [
      "## Core",
      "",
      "<!-- feature: gitnexus -->",
      "*(an aside spanning",
      "two lines)*",
      "",
      "Body stays.",
    ].join("\n");
    const dropped = filterContractByFeatures(para, new Set(["northstars"]));
    assert.doesNotMatch(dropped, /an aside/, "tagged paragraph survived without its module");
    assert.doesNotMatch(dropped, /two lines/, "only the first line of the paragraph was dropped");
    assert.match(dropped, /Body stays\./, "the filter ran past the paragraph into the next one");
    assert.match(dropped, /## Core/, "a paragraph tag must not drop its section");
    // The negative (NS-12): with the module ON, the same aside must be there.
    assert.match(filterContractByFeatures(para, ALL), /an aside/);
    // A tag with no paragraph under it is an authoring slip. Keep the text — deleting the wrong
    // paragraph is the worse failure.
    assert.match(
      filterContractByFeatures(["<!-- feature: gitnexus -->", "", "Kept."].join("\n"), new Set()),
      /Kept\./,
    );
    // And the real contract must actually carry it, or the intel-only doc still dangles.
    assert.doesNotMatch(
      filterContractByFeatures(md, new Set(["northstars", "taskcore", "microscope"])),
      /graph-first "North star" above/,
      "intel-only contract still points at a section the filter removed",
    );

    // Every section must be classified. An untagged GitNexus section would ship everywhere —
    // exactly how this defect arose — so catch it at the source rather than in a rendered file.
    const src = fs.readFileSync(
      path.join(BUNDLE_ROOT, "../scripts/contract/enforcement-contract.md"),
      "utf8",
    );
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^## /.test(lines[i])) continue;
      const tagged = /^<!--\s*feature:/.test(lines[i - 1] ?? "");
      if (tagged) continue;
      // Untagged is legal only for genuinely core sections; assert it says nothing graph-specific.
      const body = lines.slice(i, i + 12).join("\n");
      assert.doesNotMatch(
        body,
        /gitnexus_|cypher|agent-refresh|impact\b/i,
        `untagged (core) section would ship to every install but is graph-specific: ${lines[i]}`,
      );
    }
  });

  it("intel-only install: no GitNexus root artifacts ship (NS-13)", async () => {
    const { featureOf } = await import(new URL("./features.mjs", import.meta.url).href);
    // Each of these is inert-to-broken without the module. .githooks/pre-commit is the sharp one:
    // it calls `npm run bearing:full-pdg`, a script only the gitnexus module installs, so a wired
    // hook in an intel-only repo fails every single commit.
    for (const rel of [
      ".gitnexusignore",
      ".github/workflows/gitnexus-ci.yml",
      ".githooks/pre-commit",
    ]) {
      assert.equal(featureOf(rel), "gitnexus", `${rel} must be gitnexus-owned`);
    }
    // Guard the classification end-to-end: an intel-only install must not place them on disk.
    const { shouldCopyBundleFile } = await import(
      new URL("./kit-shared.mjs", import.meta.url).href
    );
    const intel = new Set(["northstars", "taskcore", "microscope"]);
    for (const rel of [".gitnexusignore", ".githooks/pre-commit", ".github/workflows/gitnexus-ci.yml"]) {
      assert.equal(shouldCopyBundleFile(rel, "all", intel), false, `${rel} shipped anyway`);
      assert.equal(
        shouldCopyBundleFile(rel, "all", new Set([...intel, "gitnexus"])),
        true,
        `${rel} must still ship with gitnexus`,
      );
    }
  });

  it("every platform's service definition names an absolute binary and stays on loopback", async () => {
    // None of these supervisors inherit the interactive shell's PATH — systemd user services,
    // launchd agents and scheduled tasks all start with a minimal environment. A bare `gitnexus`
    // therefore fails to launch wherever the binary lives under nvm/volta/fnm, which for Node
    // tooling is the normal case. This is the mistake the first systemd draft actually made.
    const svc = await import(new URL("./mcp-service.mjs", import.meta.url).href);
    const bin = "/home/u/.nvm/versions/node/v22/bin/gitnexus";
    const defs = {
      "systemd unit": svc.renderUnit({ port: 39100, bin }),
      "launchd plist": svc.renderPlist({ port: 39100, bin }),
      "windows shim": svc.renderCmdShim({ port: 39100, bin }),
    };
    for (const [what, text] of Object.entries(defs)) {
      assert.ok(text.includes(bin), `${what} does not name the absolute binary`);
      assert.match(text, /127\.0\.0\.1/, `${what} must keep an unauthenticated server on loopback`);
      assert.ok(text.includes(svc.OWNER_MARKER), `${what} needs our marker to be distinguishable`);
      assert.match(text, /--http/, `${what} must start the shared transport`);
    }

    // The plist must be a VALID plist, not just a string that looks like one — a malformed one is
    // rejected by launchd with a message that explains nothing. Paths containing XML-significant
    // characters are the realistic way to break it.
    const withAmp = svc.renderPlist({ port: 39100, bin: "/opt/a & b/gitnexus" });
    assert.match(withAmp, /a &amp; b/, "an ampersand in the path must be escaped");
    assert.doesNotMatch(withAmp, /a & b/, "a raw ampersand makes the plist invalid");
    assert.match(withAmp, /^<\?xml/, "plist needs its declaration");

    // Removal must be printable for whatever we installed, or the service is a one-way door (NS-6).
    assert.ok(svc.stopCommand().length > 10);
    assert.match(svc.manualCommand({ port: 39100 }), /gitnexus mcp --http --port 39100/);
  });

  it("the shared-server unit is startable and never clobbers the user's own", async () => {
    const svc = await import(new URL("./mcp-service.mjs", import.meta.url).href);

    // A systemd USER service does not inherit the shell's PATH, so a bare `ExecStart=gitnexus`
    // silently fails to start whenever the binary lives under nvm/volta/fnm — which for Node
    // tooling is the normal case. The unit must name an absolute path.
    const unit = svc.renderUnit({ port: 39100 });
    const exec = unit.split("\n").find((l) => l.startsWith("ExecStart="));
    assert.ok(exec, "unit has no ExecStart");
    const bin = exec.slice("ExecStart=".length).split(" ")[0];
    if (svc.resolveGitnexusBin().startsWith("/")) {
      assert.ok(bin.startsWith("/"), `ExecStart must be absolute, got: ${bin}`);
    }
    assert.match(unit, /--host 127\.0\.0\.1/, "an unauthenticated MCP server must stay on loopback");
    assert.match(unit, /Restart=on-failure/);
    assert.match(unit, /installed by bearing/, "unit needs our marker so we can tell ours apart");

    // NS-1: this is the one thing bearing writes OUTSIDE the repo. A unit the user wrote — theirs
    // may point at a different build or port — must never be silently rewritten.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-unit-"));
    const theirs = path.join(tmp, "gitnexus-mcp.service");
    fs.writeFileSync(theirs, "[Service]\nExecStart=/my/own/build mcp --http --port 5000\n");
    const before = fs.readFileSync(theirs, "utf8");
    // installService() targets the real ~/.config path, so assert the guard's rule directly:
    // ours is identified by the marker, and anything without it is left alone.
    assert.ok(!before.includes("installed by bearing"), "fixture must look like a user's unit");
    assert.equal(fs.readFileSync(theirs, "utf8"), before, "a foreign unit must be untouched");
    fs.rmSync(tmp, { recursive: true, force: true });

    // Platforms we cannot supervise must say so rather than pretend, and still name the command.
    assert.match(svc.manualCommand({ port: 39100 }), /gitnexus mcp --http --port 39100/);
  });

  it("service definitions give the supervisor a PATH that can resolve node", async () => {
    const svc = await import(new URL("./mcp-service.mjs", import.meta.url).href);
    // gitnexus is an "env node" shebang script. launchd and systemd both start with a minimal
    // environment, so an absolute path to the binary is NOT enough — `env` still has to find
    // `node`, which lives beside it under nvm/volta/fnm/nodenv. Observed for real: the agent
    // exited 127 with "env: node: No such file or directory" and KeepAlive looped it forever.
    const bin = "/Users/someone/.nvm/versions/node/v22.22.0/bin/gitnexus";
    const env = svc.servicePathEnv(bin);
    assert.ok(
      env.split(":")[0] === "/Users/someone/.nvm/versions/node/v22.22.0/bin",
      `the binary's own directory must come first, got: ${env}`,
    );
    assert.ok(env.includes("/usr/bin"), "system paths must still be present");

    const plist = svc.renderPlist({ port: 39100, bin });
    assert.match(plist, /<key>EnvironmentVariables<\/key>/, "plist sets no PATH");
    assert.ok(plist.includes(env), "plist PATH does not include the node dir");
    const unit = svc.renderUnit({ port: 39100, bin });
    assert.match(unit, /^Environment=PATH=/m, "systemd unit sets no PATH");
    assert.ok(unit.includes(env), "unit PATH does not include the node dir");
  });

  it("serverListening reports what is actually on the port, not what we hoped", async () => {
    const svc = await import(new URL("./mcp-service.mjs", import.meta.url).href);
    const net = await import("node:net");

    // The negative case is the point (NS-12). installService once returned ok:true with the words
    // "listening on 127.0.0.1:39100" while the agent was crash-looping and nothing was bound —
    // which made the caller's fallback-to-stdio branch unreachable.
    const free = await new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    assert.equal(
      svc.serverListening({ port: free, timeoutMs: 300 }),
      false,
      "claimed a server on a port nothing is bound to",
    );

    const srv = net.createServer((c) => c.end());
    const port = await new Promise((resolve) =>
      srv.listen(0, "127.0.0.1", () => resolve(srv.address().port)),
    );
    try {
      assert.equal(
        svc.serverListening({ port, timeoutMs: 3000 }),
        true,
        "failed to see a server that really is listening",
      );
    } finally {
      srv.close();
    }
  });

  it("an unparseable transport falls back to stdio instead of breaking the install", async () => {
    // A malformed manifest must not brick an install: stdio always works (NS-8).
    const { parseMcpTransport, mcpEntry } = await import(
      new URL("./mcp-config.mjs", import.meta.url).href
    );
    for (const junk of [null, undefined, "", "nonsense", 0, {}, { mode: "http" }, []]) {
      assert.equal(parseMcpTransport(junk).mode, "stdio", `${JSON.stringify(junk)} should be stdio`);
      // A stdio entry is one that SPAWNS (has a command) rather than connects (has a url). Which
      // binary depends on whether gitnexus is installed on the machine running the test, so
      // asserting "npx" here would pass or fail by accident of the test host.
      const e = mcpEntry(parseMcpTransport(junk));
      assert.ok(e.command, "stdio entry must spawn a command");
      assert.ok(!e.type && !e.url, "stdio entry must not be an http entry");
    }
    // ...and the shapes people actually type all resolve to the same server.
    for (const good of ["http", "39100", "http://127.0.0.1:39100/mcp"]) {
      const t = parseMcpTransport(good);
      assert.equal(t.mode, "http", good);
      assert.equal(mcpEntry(t).type, "http");
    }
  });

  it("the gitnexus binary choice survives an update, like the transport", async () => {
    // A machine developing GitNexus locally points the generated scripts at its own build. bearing
    // rewrites all 16 of them on every update, so a hardcoded `npx gitnexus@latest` reverted that
    // silently — and then `bearing:refresh` rebuilt the index with the PUBLISHED analyzer while
    // everything else used the local one. Same version string, different code, no error.
    const { execSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cmd-"));
    const run = (cmd, extra = "") =>
      execSync(`node ${JSON.stringify(kit)} ${cmd} ${JSON.stringify(tmp)} --runtime claude --features all ${extra} --no-setup --skip-verify`,
        { cwd: path.join(BUNDLE_ROOT, ".."), stdio: "ignore" });
    const counts = () => {
      const s = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")).scripts;
      const ours = Object.entries(s).filter(([k]) => /^(bearing|gitnexus):/.test(k));
      return {
        // Any npx form counts as "not the local binary" — the flag may carry -y or a pin.
        stock: ours.filter(([, v]) => /\bnpx\b/.test(v)).length,
        local: ours.filter(([, v]) => !/npx/.test(v) && /gitnexus/.test(v)).length,
      };
    };

    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"g","version":"1.0.0"}');
    fs.writeFileSync(path.join(tmp, "f.js"), "x");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    // Force npx explicitly rather than relying on the default: the default now RESOLVES an
    // installed gitnexus, so what a bare install produces depends on the test host.
    run("install", '--gitnexus-cmd "npx -y gitnexus@latest"');
    assert.ok(counts().stock > 0, "an explicit npx choice must be honoured");
    assert.equal(counts().local, 0);

    run("install", "--gitnexus-cmd gitnexus");
    assert.equal(counts().stock, 0, "every script must follow the choice, including legacy aliases");
    assert.ok(counts().local > 0);

    // THE REGRESSION: a plain update with no flags reverted all 16.
    run("update");
    assert.equal(counts().stock, 0, "update reverted the scripts to the published analyzer");

    run("update", '--gitnexus-cmd "npx gitnexus@latest"');
    assert.ok(counts().stock > 0, "switching back must be possible and explicit");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("setup's own script merge keeps the recorded gitnexus binary", async () => {
    // The test above passes --no-setup, and that convenient fixture is exactly what hid this
    // (NS-9): the revert happens in step 7. bearing-setup.sh runs the IN-REPO
    // scripts/bearing-teaching/merge-package-scripts.mjs, which rebuilt every command from the
    // bare `npx gitnexus@latest` default — AFTER step 5 had just written the operator's choice.
    // Observed on a real install: manifest said "gitnexus", all 16 commands said @latest.
    const { execSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-setupmerge-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"g","version":"1.0.0"}');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    execSync(
      `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime claude --features all --gitnexus-cmd gitnexus --no-setup --skip-verify`,
      { cwd: path.join(BUNDLE_ROOT, ".."), stdio: "ignore" },
    );
    const stockCount = () => {
      const s = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")).scripts;
      return Object.entries(s).filter(([k, v]) => /^(bearing|gitnexus):/.test(k) && /\bnpx\b/.test(v)).length;
    };
    assert.equal(stockCount(), 0, "install did not honour --gitnexus-cmd");

    // Exactly what bearing-setup.sh line 102 does.
    execSync("node scripts/bearing-teaching/merge-package-scripts.mjs --write", {
      cwd: tmp,
      stdio: "ignore",
    });
    assert.equal(stockCount(), 0, "setup's merge reverted the scripts to npx gitnexus@latest");

    // The snippet users copy has to name the same binary, or it reintroduces @latest by hand.
    const snippet = execSync("node scripts/bearing-teaching/merge-package-scripts.mjs --snippet", {
      cwd: tmp,
      encoding: "utf8",
    });
    assert.ok(!/gitnexus@latest/.test(snippet), "--snippet still advertises the published analyzer");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the in-repo resolver reproduces the installer's MCP entry", async () => {
    // bearing-setup.sh rewrites .cursor/mcp.json AFTER the installer wrote it, so it hardcoded
    // `npx -y gitnexus@latest mcp` and silently reverted BOTH choices: a repo pointed at a shared
    // http server went back to spawning its own stdio process per client — recreating the exact
    // pile-up the http transport exists to prevent. It now asks this resolver instead.
    const mod = await import(new URL("../bundle/.bearing/lib/gitnexus-cmd.mjs", import.meta.url).href);
    const { mcpEntry } = await import(new URL("./mcp-config.mjs", import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-entry-"));
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    const write = (m) =>
      fs.writeFileSync(path.join(tmp, ".bearing/manifest.json"), JSON.stringify(m));

    write({ mcpTransport: { mode: "http", url: "http://127.0.0.1:39100/mcp" }, gitnexusCmd: "gitnexus" });
    assert.deepEqual(
      mod.mcpEntryFor(tmp),
      { type: "http", url: "http://127.0.0.1:39100/mcp" },
      "an http repo must not be handed a spawn entry",
    );

    write({ mcpTransport: { mode: "stdio" }, gitnexusCmd: "gitnexus" });
    const stdio = mod.mcpEntryFor(tmp);
    assert.deepEqual(
      stdio,
      mcpEntry({ mode: "stdio" }, "gitnexus"),
      "the shell resolver and the installer must agree on the stdio entry",
    );
    assert.ok(!JSON.stringify(stdio).includes("@latest"), "recorded binary ignored");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the MCP transport choice survives an update", async () => {
    // stdio spawns one server PER CLIENT by protocol design, so every editor window and agent
    // session gets its own — seven were observed on one machine, all auto-refreshing against one
    // index and queueing behind its 600s lock. The http transport is one server for every repo.
    // Switching to it is a deliberate setup (a daemon, a port), and bearing used to overwrite the
    // entry with a hardcoded stdio default on the next update, silently undoing it and recreating
    // the pile-up. bearing stays authoritative — it always writes the entry — but writes the
    // RECORDED choice.
    const { execSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-mcp-"));
    // The target is positional argv[1], so it must follow the command directly — flags after it.
    const run = (cmd, extra = "") =>
      execSync(`node ${JSON.stringify(kit)} ${cmd} ${JSON.stringify(tmp)} --runtime claude --features all ${extra} --no-setup --skip-verify`,
        { cwd: path.join(BUNDLE_ROOT, ".."), stdio: "ignore" });
    const entry = () =>
      JSON.parse(fs.readFileSync(path.join(tmp, ".mcp.json"), "utf8")).mcpServers.gitnexus;

    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"t","version":"1.0.0"}');
    fs.writeFileSync(path.join(tmp, "f.js"), "x");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    // Default is the zero-config one: no daemon, no port, works on a fresh machine.
    run("install");
    assert.ok(entry().command, "default install must stay stdio (a spawned command)");
    assert.ok(!entry().type, "default install must not write an http entry");

    run("install", "--mcp 39100");
    assert.deepEqual(entry(), { type: "http", url: "http://127.0.0.1:39100/mcp" });

    // THE REGRESSION: a plain update, no flags. This used to revert to stdio.
    run("update");
    assert.deepEqual(
      entry(),
      { type: "http", url: "http://127.0.0.1:39100/mcp" },
      "update reverted a deliberate http setup to stdio",
    );

    // ...and going back is explicit, not accidental.
    run("update", "--mcp stdio");
    assert.ok(entry().command && !entry().type, "explicit stdio must go back to spawning");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("update-all preserves each repo's own module selection", async () => {
    // This is the only command that writes to many repos at once, so a wrong default here changes
    // every project on the machine. Re-adding gitnexus to a repo that deselected it would silently
    // switch enforcement back on across the board.
    const { execSync } = await import("node:child_process");
    const kitRoot = path.join(BUNDLE_ROOT, "..");
    const kit = path.join(kitRoot, "lib/kit.mjs");
    const searchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gn-updateall-"));
    const SPECS = [
      ["full", "northstars,taskcore,microscope,gitnexus"],
      ["intel", "northstars,taskcore,microscope"],
      ["nsonly", "northstars"],
    ];
    for (const [name, feats] of SPECS) {
      const d = path.join(searchRoot, name);
      fs.mkdirSync(d, { recursive: true });
      execSync("git init -q", { cwd: d });
      fs.writeFileSync(path.join(d, "package.json"), `{"name":"${name}","version":"1.0.0"}`);
      fs.writeFileSync(path.join(d, "f.js"), "x");
      execSync("git add -A && git commit -qm init", { cwd: d, shell: "/bin/bash" });
      execSync(
        `node ${JSON.stringify(kit)} install ${JSON.stringify(d)} --runtime claude --features ${feats} --no-setup --skip-verify`,
        { cwd: kitRoot, stdio: "ignore" },
      );
    }
    // A repo with no manifest, and a nested manifest inside node_modules: neither is ours to touch.
    const plain = path.join(searchRoot, "notinstalled");
    fs.mkdirSync(plain, { recursive: true });
    execSync("git init -q", { cwd: plain });
    const nm = path.join(searchRoot, "full/node_modules/pkg/.bearing");
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "manifest.json"), "{}");

    const { findInstalledRepos } = await import(new URL("./kit.mjs", import.meta.url).href);
    const found = findInstalledRepos(searchRoot);
    assert.equal(found.length, SPECS.length, `discovered ${found.join(", ")}`);
    assert.ok(!found.some((r) => r.includes("node_modules")), "descended into node_modules");
    assert.ok(!found.some((r) => r.includes("notinstalled")), "picked up an uninstalled repo");

    execSync(
      `node ${JSON.stringify(kit)} update-all ${JSON.stringify(searchRoot)} --skip-verify --no-setup`,
      { cwd: kitRoot, stdio: "ignore" },
    );

    for (const [name, feats] of SPECS) {
      const m = JSON.parse(
        fs.readFileSync(path.join(searchRoot, name, MANIFEST_PATH), "utf8"),
      );
      assert.deepEqual(
        [...m.features].sort(),
        feats.split(",").sort(),
        `${name}: update-all changed its module selection`,
      );
      // ...and the selection is real on disk, not just recorded.
      const wantsGraph = feats.includes("gitnexus");
      assert.equal(
        fs.existsSync(path.join(searchRoot, name, ".gitnexusignore")),
        wantsGraph,
        `${name}: graph artifacts do not match its recorded features after update-all`,
      );
    }
    fs.rmSync(searchRoot, { recursive: true, force: true });
  });

  it("guards decide correctly on real tool calls (allow AND deny)", async () => {
    // The guards run on every tool call and had almost no behavioural coverage — read, bash and
    // mcp had none at all. Existing "coverage" only asserted the hook FILES exist and are
    // registered, which is why a dead gate went unnoticed: bearing-read-guard.mjs referenced a
    // bare `config` that was never bound, the ReferenceError was swallowed by its own fail-open
    // catch and reported as "0 lines", so no read was ever large enough to gate.
    const { execSync, spawnSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-guards-"));

    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"g","version":"1.0.0"}');
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/order.js"), "export function OrderService(){}\n");
    fs.writeFileSync(path.join(tmp, "src/big.js"), "a\n".repeat(3000));
    fs.writeFileSync(path.join(tmp, "data.csv"), "name,qty\n1,2\n");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    execSync(
      `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime claude --features all --no-setup --skip-verify`,
      { cwd: path.join(BUNDLE_ROOT, ".."), stdio: "ignore" },
    );
    // Gates only engage on a FRESH index.
    const head = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: head, stats: { nodes: 500, edges: 900, embeddings: 500 } }),
    );

    const decide = (guard, tool_name, tool_input) => {
      const r = spawnSync(
        process.execPath,
        [path.join(tmp, `.claude/hooks/bearing-${guard}-guard.mjs`)],
        {
          cwd: tmp,
          input: JSON.stringify({ tool_name, tool_input, cwd: tmp }),
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
        },
      );
      let out = {};
      try {
        out = JSON.parse((r.stdout || "{}").trim() || "{}");
      } catch {
        /* non-JSON stdout means allow-by-silence */
      }
      return out.hookSpecificOutput?.permissionDecision ?? "allow";
    };

    const CASES = [
      // Denies — the gate must actually fire (NS-12).
      ["grep", "Grep", { pattern: "OrderService" }, "deny", "symbol grep must route to context"],
      ["grep", "Glob", { pattern: "**/*" }, "deny", "the broadest possible sweep must gate"],
      ["grep", "Glob", { pattern: "**/*.{ts,tsx}" }, "deny", "brace-form source sweep must gate"],
      ["read", "Read", { file_path: path.join(tmp, "src/big.js") }, "deny", "large source read"],
      ["edit", "Edit", { file_path: path.join(tmp, "src/order.js") }, "deny", "edit before impact"],
      ["bash", "Bash", { command: "git commit -m x" }, "deny", "commit before detect_changes"],
      ["bash", "Bash", { command: "grep -r OrderService src/" }, "deny", "shell symbol grep"],
      // Allows — a false deny costs more than a missed gate (NS-5).
      ["grep", "Grep", { pattern: "TODO" }, "allow", "plain text search is legitimate"],
      ["grep", "Grep", { pattern: "foo", path: "data.csv" }, "allow", "non-source path"],
      ["grep", "Glob", { pattern: "src/order.js" }, "allow", "a literal path is not a sweep"],
      ["read", "Read", { file_path: path.join(tmp, "src/order.js") }, "allow", "small source file"],
      ["read", "Read", { file_path: path.join(tmp, "data.csv") }, "allow", "non-source file"],
      ["read", "Read", { file_path: path.join(tmp, "src/big.js"), offset: 1, limit: 50 }, "allow", "bounded read"],
      ["edit", "Write", { file_path: path.join(tmp, "notes.md") }, "allow", "non-source write"],
      ["bash", "Bash", { command: "ls -la" }, "allow", "ordinary shell"],
      ["bash", "Bash", { command: "git log --oneline" }, "allow", "read-only git"],
      ["bash", "Bash", { command: "echo 'git commit' >> notes.txt" }, "allow", "commit inside a string"],
      ["mcp", "mcp__gitnexus__query", { search_query: "x" }, "allow", "graph calls always pass"],
    ];
    // An UNTRACKED file is not in the index (built at HEAD) and never was, so redirecting its read
    // to query/context points at tools that return nothing for it — a block with no alternative.
    fs.writeFileSync(path.join(tmp, "src/untracked-big.js"), "const x = 1;\n".repeat(400));
    CASES.push(
      ["read", "Read", { file_path: path.join(tmp, "src/untracked-big.js") }, "allow", "untracked file the index cannot contain"],
    );

    // ── Reported from real use in a live project ────────────────────────────
    // Every one of these was DENIED and redirected to `cypher ACCESSES`, which answers none of
    // them. A false deny costs more than a missed gate (NS-5), and advice the agent cannot act on
    // is worse still (NS-6).
    CASES.push(
      ["grep", "Grep", { pattern: "maxHoldMs", path: "src/order.js" }, "allow", "scoped to ONE named file"],
      ["grep", "Grep", { pattern: "maxBars", path: "tests/" }, "allow", "test-coverage search"],
      ["grep", "Grep", { pattern: "maxHoldMs", output_mode: "count", path: "src/order.js" }, "allow", "counting in a named file"],
      // ...but count mode is NOT a free pass: Claude returns per-FILE counts, so a repo-wide count
      // answers "which files contain this symbol" — discovery, and a one-flag bypass of the gate.
      ["grep", "Grep", { pattern: "OrderService", output_mode: "count" }, "deny", "repo-wide count is discovery"],
      // ...while the sweep the gate exists for still fires.
      ["grep", "Grep", { pattern: "maxHoldMs" }, "deny", "repo-wide field sweep still gated"],
      ["grep", "Grep", { pattern: "OrderService", path: "src/" }, "deny", "whole source dir still gated"],
    );

    for (const [guard, tool, input, expected, why] of CASES) {
      assert.equal(
        decide(guard, tool, input),
        expected,
        `${guard}/${tool} ${JSON.stringify(input).slice(0, 60)} — ${why}`,
      );
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("impact verdicts with unresolvable callers are flagged, not trusted", async () => {
    // `impact` is the pre-edit safety gate and its worst failure is a confident LOW derived from a
    // caller set it could not resolve — DI/factory seams and module consts do not resolve, so a
    // symbol wired to a live route reports zero callers. Field-reported: modifyOppositeSignalPosition
    // (live PATCH route) -> 0 incoming; buildSymbolPool -> LOW / impactedCount 1 / caller = the test,
    // with two production call sites. It must WARN, never block: re-running impact returns the same
    // empty answer, so a deny would be unescapable (NS-5/NS-6).
    const { execSync, spawnSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-impact-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"i","version":"1.0.0"}');
    fs.writeFileSync(path.join(tmp, "f.js"), "x");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    execSync(
      `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime claude --features all --no-setup --skip-verify`,
      { cwd: path.join(BUNDLE_ROOT, ".."), stdio: "ignore" },
    );

    const audit = (tool_response, tool_name = "mcp__gitnexus__impact") => {
      const r = spawnSync(
        process.execPath,
        [path.join(tmp, ".claude/hooks/bearing-impact-audit.mjs")],
        {
          cwd: tmp,
          input: JSON.stringify({ tool_name, tool_response, cwd: tmp }),
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
        },
      );
      assert.equal(r.status, 0, "the audit must never fail a tool call");
      let o = {};
      try {
        o = JSON.parse((r.stdout || "{}").trim() || "{}");
      } catch {
        /* silence is a valid outcome */
      }
      return /IMPACT VERDICT IS UNRELIABLE/.test(o.hookSpecificOutput?.additionalContext ?? "");
    };

    // The two shapes actually reported from the field.
    assert.ok(audit({ status: "found", incoming: {}, outgoing: {}, risk: "LOW" }), "0 callers + LOW");
    assert.ok(
      audit({ risk: "LOW", impactedCount: 1, impacted: [{ filePath: "src/__tests__/p.test.js" }] }),
      "test-only caller + LOW",
    );
    // ...and it must stay quiet otherwise, or it becomes noise on every impact call.
    assert.ok(
      !audit({ risk: "LOW", impactedCount: 2, impacted: [{ filePath: "src/a.js" }, { filePath: "src/b.js" }] }),
      "real production callers must not warn",
    );
    assert.ok(!audit({ risk: "HIGH", impactedCount: 0 }), "HIGH is already alarming");
    assert.ok(!audit({ risk: "LOW", impactedCount: 0 }, "mcp__gitnexus__query"), "other tools");
    // A payload-shape change must degrade to silence, never crash the tool call (NS-8).
    for (const junk of ["unexpected text", "", null, { totally: "different" }]) {
      assert.ok(!audit(junk), `must stay silent on ${JSON.stringify(junk)}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the kit diagnoses whether its own enforcement is earning its keep", async () => {
    // Every number needed was already collected and nothing asked the question. A real session ran
    // 60 graph calls against 57 redirects and 5 fallback grants; the operator only learned the
    // gates were the dominant interaction because an agent wrote it up by hand.
    const { diagnoseEnforcement } = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const real = diagnoseEnforcement({
      graphCalls: 60,
      grepRedirects: 49,
      readRedirects: 8,
      classicalFallbackGranted: 5,
    });
    assert.ok(real.some((f) => /Enforcement is \d+%/.test(f.headline)), "ratio finding missing");
    assert.ok(real.some((f) => /fallback grants/.test(f.headline)), "fallback finding missing");
    // Every finding must name the knob to turn — a diagnosis nobody can act on is just noise (NS-6).
    for (const f of real) assert.ok(f.advice && f.advice.length > 40, `no advice: ${f.headline}`);

    // Silent when enforcement is proportionate, and silent below a traffic floor where a ratio
    // would be noise. Both matter more than the warning: a nag on every session gets ignored.
    assert.deepEqual(diagnoseEnforcement({ graphCalls: 60, grepRedirects: 6 }), []);
    assert.deepEqual(diagnoseEnforcement({ graphCalls: 5, grepRedirects: 4 }), []);
    assert.deepEqual(diagnoseEnforcement({}), []);
  });

  it("the install banner closes its box for any content", async () => {
    // The width was hardcoded to 62 and padEnd only ever pads, so the box silently stopped closing
    // the moment a title or subtitle got longer — which is exactly what adding "Codex" to the
    // `npx bearing` greeting did. First screen a new user sees.
    const { banner } = await import(
      new URL("../bundle/scripts/lib/setup-ui.mjs", import.meta.url).href
    );
    const lines = [];
    const orig = console.log;
    console.log = (s = "") => lines.push(String(s));
    try {
      banner("bearing — interactive install", "Intel layer for AI coding agents — Cursor, Zed, Claude Code, Codex");
      banner("short", "tiny");
      banner("x".repeat(120), "y".repeat(140));
      banner("no subtitle");
    } finally {
      console.log = orig;
    }
    const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const box = lines.map(strip).filter((l) => /^[╔║╚]/.test(l));
    assert.ok(box.length >= 10, "banner produced no box");
    // Every row of a given box must be exactly as wide as its top border.
    let width = 0;
    for (const row of box) {
      if (row.startsWith("╔")) width = [...row].length;
      assert.equal(
        [...row].length,
        width,
        `banner row does not match its border width: ${JSON.stringify(row.slice(0, 80))}`,
      );
      assert.ok(/[╗║╝]$/.test(row), `banner row does not close: ${JSON.stringify(row.slice(0, 80))}`);
    }
  });

  it("uninstall completes and leaves the repo as it found it", async () => {
    // Uninstall CRASHED in 1.0.3: restoreBackup did path.join(root, undefined) whenever no backup
    // was recorded — the normal case — and it ran in the FIRST adapter of the unwire loop, so the
    // throw aborted everything after it. Hooks stayed registered against deleted files, the MCP
    // server stayed configured, and the manifest survived so the repo still looked installed.
    const { execSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-uninstall-"));
    const at = (p) => path.join(tmp, p);

    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(
      at("package.json"),
      JSON.stringify({ name: "u", version: "1.0.0", scripts: { build: "tsc" } }),
    );
    fs.writeFileSync(at("f.js"), "x");
    // Paths of the USER'S that collide with bundle paths, plus their own MCP server.
    fs.mkdirSync(at(".githooks"), { recursive: true });
    fs.writeFileSync(at(".githooks/pre-commit"), "#!/bin/sh\necho USER OWN\n");
    fs.mkdirSync(at(".vscode"), { recursive: true });
    fs.writeFileSync(at(".vscode/settings.json"), '{"editor.tabSize":7}\n');
    fs.writeFileSync(at(".mcp.json"), JSON.stringify({ mcpServers: { mine: { command: "foo" } } }));
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    execSync(
      `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime all --features all --no-setup --skip-verify`,
      { cwd: path.join(BUNDLE_ROOT, ".."), stdio: "ignore" },
    );
    fs.writeFileSync(at(".bearing/northstars.md"), "- **NS-1** — irreplaceable\n");

    // Must not throw. stdio:"pipe" so a crash surfaces as a failed assertion, not a silent pass.
    execSync(`node ${JSON.stringify(kit)} uninstall ${JSON.stringify(tmp)}`, {
      cwd: path.join(BUNDLE_ROOT, ".."),
      encoding: "utf8",
    });

    // The user's repo is as they left it.
    assert.match(
      fs.readFileSync(at(".githooks/pre-commit"), "utf8"),
      /USER OWN/,
      "uninstall deleted the user's pre-commit and stranded it in a .bearing-backup",
    );
    assert.match(fs.readFileSync(at(".vscode/settings.json"), "utf8"), /tabSize/);
    const stranded = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === ".git") continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".bearing-backup")) stranded.push(p);
      }
    })(tmp);
    assert.deepEqual(stranded, [], "uninstall left .bearing-backup files behind");
    const mcp = JSON.parse(fs.readFileSync(at(".mcp.json"), "utf8"));
    assert.ok(mcp.mcpServers.mine, "the user's own MCP server was removed");
    assert.ok(!mcp.mcpServers.gitnexus, "our MCP server survived uninstall");
    assert.equal(
      JSON.parse(fs.readFileSync(at("package.json"), "utf8")).scripts.build,
      "tsc",
    );
    assert.ok(fs.existsSync(at(".bearing/northstars.md")), "north-stars destroyed by uninstall");

    // ...and nothing of OURS is left pointing at something deleted.
    for (const rel of [".gitnexus/agent-kit-manifest.json", ".cursor/mcp.json"]) {
      assert.ok(!fs.existsSync(at(rel)), `${rel} survived uninstall`);
    }
    if (fs.existsSync(at(".claude/settings.json"))) {
      assert.doesNotMatch(
        fs.readFileSync(at(".claude/settings.json"), "utf8"),
        /bearing-/,
        "claude settings still register our hooks after uninstall",
      );
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("deselecting a module removes it, without taking the user's files with it", async () => {
    // The feature axis was only applied when COPYING, so re-installing with fewer modules removed
    // nothing: the user turned GitNexus off and the guards kept enforcing, the MCP server stayed
    // configured, and 32 npm scripts stayed in package.json pointing at deleted files.
    const { execSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-downgrade-"));
    const at = (p) => path.join(tmp, p);
    const run = (feats) =>
      execSync(
        `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime all --features ${feats} --no-setup --skip-verify`,
        { cwd: path.join(BUNDLE_ROOT, ".."), encoding: "utf8" },
      );

    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(
      at("package.json"),
      JSON.stringify({ name: "t", version: "1.0.0", scripts: { build: "tsc" } }),
    );
    fs.writeFileSync(at("f.js"), "x");
    // Files of the USER'S that collide with bundle paths, plus their own MCP server.
    fs.mkdirSync(at(".githooks"), { recursive: true });
    fs.writeFileSync(at(".githooks/pre-commit"), "#!/bin/sh\necho MY OWN HOOK\n");
    fs.writeFileSync(at(".mcp.json"), JSON.stringify({ mcpServers: { mine: { command: "foo" } } }));
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    run("all");
    assert.ok(fs.existsSync(at(".gitnexusignore")), "sanity: full install places graph artifacts");
    assert.ok(
      Object.keys(JSON.parse(fs.readFileSync(at("package.json"), "utf8")).scripts).some((k) =>
        k.startsWith("bearing:"),
      ),
      "sanity: full install adds npm scripts",
    );

    run("northstars,taskcore,microscope");

    // The module is gone — every channel, not just the files.
    for (const rel of [
      ".gitnexusignore",
      ".github/workflows/gitnexus-ci.yml",
      ".cursor/mcp.json",
      ".cursor/hooks.json",
      ".cursor/rules/bearing.mdc",
    ]) {
      assert.ok(!fs.existsSync(at(rel)), `${rel} survived deselection`);
    }
    const pkg = JSON.parse(fs.readFileSync(at("package.json"), "utf8"));
    assert.equal(
      Object.keys(pkg.scripts).filter((k) => k.startsWith("bearing:")).length,
      0,
      "bearing:* scripts point at scripts/ that deselection just deleted",
    );
    const mcp = JSON.parse(fs.readFileSync(at(".mcp.json"), "utf8"));
    assert.ok(!mcp.mcpServers.gitnexus, "gitnexus MCP server survived deselection");

    // ...and NOTHING of the user's was collateral. Install had overwritten their pre-commit hook
    // (stashing the original beside it); deselection must put theirs back, not leave a hole.
    assert.match(
      fs.readFileSync(at(".githooks/pre-commit"), "utf8"),
      /MY OWN HOOK/,
      "the user's own pre-commit hook was destroyed by deselection",
    );
    assert.ok(mcp.mcpServers.mine, "the user's own MCP server was removed");
    assert.equal(pkg.scripts.build, "tsc", "the user's own npm script was removed");

    // The modules they KEPT still work.
    assert.ok(fs.existsSync(at(".bearing/skills/bearing-microscope")), "kept module lost");
    assert.ok(fs.existsSync(at("CLAUDE.md")), "kept contract lost");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("no runtime is pointed at a hook or MCP server that was not installed", async () => {
    // Generalises a defect that shipped twice, once per runtime: hook CONFIG is written from a
    // static table while hook FILES are filtered by feature, so a filtered install registers
    // scripts that are not on disk. Claude failed a node spawn on every tool call; Cursor
    // registered 12 missing shell hooks AND launched `npx gitnexus@latest mcp` for a graph the
    // user declined. Assert the invariant directly rather than per-runtime.
    const { execSync } = await import("node:child_process");
    const kit = path.join(BUNDLE_ROOT, "../lib/kit.mjs");

    for (const feats of ["northstars,taskcore,microscope", "all"]) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-dangle-"));
      execSync(
        "git init -q && echo x > f.js && echo '{\"name\":\"t\",\"version\":\"1.0.0\"}' > package.json && git add -A && git commit -qm init",
        { cwd: tmp, shell: "/bin/bash" },
      );
      // No --no-setup for the intel-only case: setup is skipped by FEATURE there (no indexer to
      // run), so this exercises the real reporting path. With --no-setup the Index row always says
      // "not changed" and would mask what it claims. A full install still needs it — bearing-setup
      // shells out to the gitnexus CLI, which is not present in a test environment.
      const stdout = execSync(
        `node ${JSON.stringify(kit)} install ${JSON.stringify(tmp)} --runtime all --features ${feats}${feats === "all" ? " --no-setup" : ""} --skip-verify`,
        { cwd: path.join(BUNDLE_ROOT, ".."), encoding: "utf8" },
      );

      // The installer's own Next steps are the user's first instruction, so a line naming an npm
      // script the install did not create fails at the worst possible moment (NS-5). Intel-only
      // installs listed four of them, plus an MCP approval and a Zed profile that never existed.
      // The summary must not claim graph work in a repo with no graph. Without the module there is
      // no indexer at all, yet the Index row reported "built" — so `update-all` told the user an
      // index had been built for every intel-only repo on the machine.
      if (feats !== "all") {
        assert.doesNotMatch(
          stdout,
          /Index\s+built/,
          "reported an index build in a repo with no gitnexus module",
        );
      }

      const pkgScripts = Object.keys(
        JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")).scripts ?? {},
      );
      for (const line of stdout.split("\n").filter((l) => /^\s*\d+\.\s/.test(l))) {
        for (const [, script] of line.matchAll(/npm run ([\w.:-]+)/g)) {
          assert.ok(
            pkgScripts.includes(script),
            `${feats}: Next steps say "npm run ${script}" but install never added it`,
          );
        }
      }

      for (const [cfgRel, hookDir] of [
        [".cursor/hooks.json", ".cursor/hooks"],
        [".claude/settings.json", ".claude/hooks"],
      ]) {
        const cfgPath = path.join(tmp, cfgRel);
        if (!fs.existsSync(cfgPath)) continue;
        const raw = fs.readFileSync(cfgPath, "utf8");
        for (const script of new Set(raw.match(/bearing-[\w.-]+\.(?:sh|mjs)/g) ?? [])) {
          assert.ok(
            fs.existsSync(path.join(tmp, hookDir, script)),
            `${feats}: ${cfgRel} registers ${script}, which install did not place on disk`,
          );
        }
      }

      // The MCP server may only be configured where the module that needs it is installed.
      const wantsGraph = feats === "all";
      for (const mcpRel of [".mcp.json", ".cursor/mcp.json"]) {
        const p = path.join(tmp, mcpRel);
        if (!fs.existsSync(p)) continue;
        const hasGn = JSON.stringify(JSON.parse(fs.readFileSync(p, "utf8"))).includes("gitnexus");
        assert.ok(
          !hasGn || wantsGraph,
          `${feats}: ${mcpRel} configures the gitnexus MCP server without the module`,
        );
      }
      if (wantsGraph) {
        assert.ok(
          fs.existsSync(path.join(tmp, ".mcp.json")) ||
            fs.existsSync(path.join(tmp, ".cursor/mcp.json")),
          "a full install must still configure the MCP server",
        );
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("intel-only install: session banner emits no GitNexus prose (NS-13)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-intel-only-"));
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".claude/hooks"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });

    // Mirror a REAL intel-only install. check-staleness.mjs IS present here — session-primer
    // imports it, so coreLibClosure() absorbs the whole staleness chain into core and it ships
    // even when the user declined GitNexus. That is exactly why file-presence cannot be the
    // feature flag; the manifest is the only authoritative record of what was chosen.
    for (const f of libClosure([
      "claude-emit.mjs",
      "session-primer.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ])) {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".bearing/lib", f),
        path.join(tmp, ".bearing/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/bearing-session.mjs"),
      path.join(tmp, ".claude/hooks/bearing-session.mjs"),
    );
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/agent-kit-manifest.json"),
      JSON.stringify({ features: ["northstars", "taskcore", "microscope"] }),
    );
    fs.writeFileSync(path.join(tmp, ".bearing/northstars.md"), "- **NS-1** — anchor.\n");

    const run = (source) =>
      JSON.parse(
        spawnSync(process.execPath, [path.join(tmp, ".claude/hooks/bearing-session.mjs")], {
          cwd: tmp,
          input: JSON.stringify({ source }),
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, HOME: tmp },
        }).stdout.trim() || "{}",
      ).hookSpecificOutput.additionalContext;

    // The negative case is the whole point (NS-12): assert the prose is ABSENT. Every one of
    // these instructs an agent to use a tool or npm script that does not exist in this repo.
    for (const source of ["startup", "compact"]) {
      const out = run(source);
      assert.doesNotMatch(out, /agent-refresh/, `${source}: names a script that doesn't exist`);
      assert.doesNotMatch(out, /graph-first/i, `${source}: graph-first without a graph`);
      assert.doesNotMatch(out, /gitnexus_query|detect_changes/, `${source}: MCP tools absent`);
      assert.doesNotMatch(out, /Index is (STALE|fresh)/, `${source}: there is no index`);
      // ...while the intel layer it DID install still anchors.
      assert.match(out, /NORTH-STARS/, `${source}: north-stars must still lead`);
    }

    // Same repo, gitnexus SELECTED → the prose must come back (proves the assertion can fail).
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/agent-kit-manifest.json"),
      JSON.stringify({ features: ["northstars", "taskcore", "microscope", "gitnexus"] }),
    );
    assert.match(run("compact"), /graph-first/i, "gitnexus selected → discipline restated");

    // Pre-1.0.3 manifest has no features field → must fall back to file probe, not go dark.
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/agent-kit-manifest.json"),
      JSON.stringify({ runtime: "claude" }),
    );
    assert.match(run("compact"), /graph-first/i, "legacy manifest → fall back to file probe");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the minion nudge fires on serial grinding, once, and never blocks (NS-5)", () => {
    // The fan-out trigger lived only in the contract, which means it fired when the agent happened
    // to recall it. The ninth Read in a row is when it is actionable.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-nudge-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"n"}\n');
    installKit(tmp, { runtime: "claude", features: "minions", runSetup: false, skipVerify: true });
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.local.json"),
      JSON.stringify({ minionFanoutThreshold: 3 }),
    );
    const hook = path.join(tmp, ".claude/hooks/bearing-minion-nudge.mjs");
    const fire = (tool, target) => {
      const r = spawnSync(process.execPath, [hook], {
        cwd: tmp,
        encoding: "utf8",
        input: JSON.stringify({ cwd: tmp, tool_name: tool, tool_input: { file_path: target } }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      });
      return { status: r.status, nudged: /fan it out/.test(r.stdout || "") };
    };

    assert.equal(fire("Read", "/a.js").nudged, false);
    assert.equal(fire("Read", "/b.js").nudged, false);
    assert.equal(fire("Read", "/c.js").nudged, true, "no nudge at the threshold");
    assert.equal(fire("Read", "/d.js").nudged, false, "nudged twice — once per session is the budget");

    // Re-reading ONE file is editing, not grinding. Counting calls instead of distinct targets
    // would nag through every normal edit loop, which is how a nudge gets ignored forever (NS-5).
    fs.rmSync(path.join(tmp, ".bearing/.bearing-minion-scan.json"), { force: true });
    for (let i = 0; i < 5; i++) {
      assert.equal(fire("Read", "/same.js").nudged, false, "the same file counted as a new target");
    }

    // It advises; it must never deny. Every call exits 0, including the nudging one.
    fs.rmSync(path.join(tmp, ".bearing/.bearing-minion-scan.json"), { force: true });
    for (const t of ["/x.js", "/y.js", "/z.js"]) {
      assert.equal(fire("Read", t).status, 0, "the nudge hook exited non-zero — that blocks a tool call");
    }

    // Delegating resets the run: the agent is already doing the right thing.
    assert.equal(fire("Task", "").nudged, false);
    assert.equal(fire("Read", "/p.js").nudged, false, "the run did not reset after a delegation");

    // And it can be turned off entirely.
    fs.rmSync(path.join(tmp, ".bearing/.bearing-minion-scan.json"), { force: true });
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.local.json"),
      JSON.stringify({ minionFanoutThreshold: 0 }),
    );
    for (const t of ["/1.js", "/2.js", "/3.js", "/4.js"]) {
      assert.equal(fire("Read", t).nudged, false, "threshold 0 must disable the nudge");
    }
  });

  it("citation checking catches a fabricated file:line", async () => {
    // The one failure FOUND/CHECKED/MISSED cannot catch by itself is a citation that was never
    // real. "Spot-check one per minion" was advice, and advice is a claim nothing verifies.
    const { parseCitations, checkCitation } = await import(
      new URL("../bundle/.bearing/lib/verify-citations.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cite-"));
    fs.writeFileSync(path.join(tmp, "a.ts"), "one\ntwo\nthree\n");

    const parsed = parseCitations("FOUND a.ts:2 — two\nFOUND a.ts:2 — dupe\nFOUND b.ts:9 — nope");
    assert.deepEqual(parsed, [
      { file: "a.ts", line: 2 },
      { file: "b.ts", line: 9 },
    ], "citations must be deduped and parsed out of the FOUND line");

    const good = checkCitation({ file: "a.ts", line: 2 }, tmp);
    assert.equal(good.ok, true);
    assert.equal(good.text, "two", "must report what is ACTUALLY on the line, not just that it exists");

    // The two shapes a fabrication takes: invented file, invented position in a real file.
    assert.equal(checkCitation({ file: "ghost.ts", line: 1 }, tmp).ok, false);
    assert.equal(checkCitation({ file: "a.ts", line: 999 }, tmp).ok, false);
    assert.equal(checkCitation({ file: "a.ts", line: 0 }, tmp).ok, false);
  });

  it("every documented hook-config key is actually honored from a config file", async () => {
    // applyHookConfigFile is a per-key whitelist, so adding a default is only HALF of adding a
    // setting — `minionModel` shipped with a default, a skill and a contract line telling users to
    // override it in .bearing/hooks.local.json, and no code reading it. The documentation was a
    // claim nothing checked (NS-20). This asserts the pair for every scalar key, so the next
    // setting cannot go one-sided.
    const { loadHookConfig } = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cfg-"));
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    const defaults = loadHookConfig(tmp);
    const scalars = Object.entries(defaults).filter(
      ([, v]) => typeof v === "number" || typeof v === "string",
    );
    assert.ok(scalars.length >= 8, "expected the scalar settings to be discoverable");

    for (const [key, value] of scalars) {
      // Enums take one of their own values; a `${value}-override` string is correctly REJECTED by
      // the reader, which reads as "never wired" when it is the opposite.
      const ENUMS = { mode: ["enforce", "guide"], stalenessGate: ["off", "block"] };
      const override = ENUMS[key]
        ? ENUMS[key].find((v) => v !== value)
        : typeof value === "number"
          ? value + 7
          : `${value}-override`;
      fs.writeFileSync(
        path.join(tmp, ".bearing/hooks.local.json"),
        JSON.stringify({ [key]: override }),
      );
      assert.equal(
        loadHookConfig(tmp)[key],
        override,
        `${key} has a default but applyHookConfigFile never reads it — the documented override is a no-op`,
      );
    }
  });

  it("every shared fragment is identical in every skill that embeds it", async () => {
    // Derived from FRAGMENT_TARGETS, so registering a fragment gets drift detection for free.
    // Two registered today:
    //
    // anchored-spawn — microscope and minions both spawn anchored subagents and the mechanics are
    // the same: one pinned persona, the north-star subset, parallel-if-supported, the duty to
    // report what went unchecked.
    //
    // graph-uncertainty — 18 skills carry the same three lines about what a zero, a near-0.5 edge
    // and a lower-bound count mean. They were hand-maintained across 17 files and identical only by
    // luck; GP-11 says a list kept in sync by hand falls out of sync. bearing-pr keeps its
    // PR-specific paragraph OUTSIDE the markers — the RULE is shared, the local reason is not.
    //
    // The RETURN CONTRACT is deliberately not shared — the two are opposite on the axis that
    // matters. A microscope lens must reason; opinions are the entire point of it. A minion must
    // not (NS-24). Unifying those would silence the lenses or let the minions editorialise.
    const { FRAGMENT_TARGETS, renderFragment, skillPath, beginMarker, endMarker } = await import(
      new URL("../scripts/gen-skill-fragments.mjs", import.meta.url).href
    );
    for (const [id, skills] of Object.entries(FRAGMENT_TARGETS)) {
      const expected = renderFragment(id);
      for (const skill of skills) {
        const md = fs.readFileSync(skillPath(skill), "utf8");
        const start = md.indexOf(beginMarker(id));
        const end = md.indexOf(endMarker(id));
        assert.ok(start >= 0 && end > start, `${skill} lost its "${id}" markers`);
        assert.equal(
          md.slice(start, end + endMarker(id).length),
          expected,
          `${skill}/SKILL.md is stale — run \`npm run gen:skills\` after editing scripts/skill-fragments/${id}.md`,
        );
      }
    }
    // And the block must actually carry the anchoring rules, not just exist.
    const shared = renderFragment("anchored-spawn");
    for (const rule of [/domain\.json/, /north-stars/i, /unchecked/i, /spot-check/i]) {
      assert.match(shared, rule, `the shared harness dropped ${rule}`);
    }
  });

  it("gold practices ship with north-stars, refresh on update, and never outrank the project's own", () => {
    // The two-tier anchor: NS-# is what THIS project is and the user owns it; GP-# is how the work
    // is done anywhere and bearing owns it. Getting the ownership backwards either way is silent —
    // a seed-once GP would freeze at whatever version first installed, and an overwritten NS would
    // destroy the user's own invariants on the next update.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gp-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"p"}\n');
    execSync("git add -A && git commit -qm i", { cwd: tmp, shell: "/bin/bash" });

    // Declining north-stars must decline the gold practices with it — one module, two files.
    installKit(tmp, { runtime: "claude", features: "taskcore", runSetup: false, skipVerify: true });
    assert.ok(
      !fs.existsSync(path.join(tmp, ".bearing/gold-practices.md")),
      "gold practices shipped to a repo that declined the north-stars module",
    );

    installKit(tmp, { runtime: "claude", features: "northstars,taskcore", runSetup: false, skipVerify: true });
    const gp = path.join(tmp, ".bearing/gold-practices.md");
    assert.ok(fs.existsSync(gp), "the north-stars module did not bring the gold practices");

    const body = fs.readFileSync(gp, "utf8");
    assert.match(body, /GP-1\b/, "the rules are not numbered, so they cannot be cited");

    // GP-11 applied to itself: citations scattered across the contract, the skills and the README
    // are a hand-maintained mirror of this file, so compute the check rather than trust it. Renumber
    // once and a citation either dangles or — worse — still resolves and now means something else.
    const defined = new Set(body.match(/^- \*\*GP-\d+\*\*/gm).map((m) => m.match(/GP-\d+/)[0]));
    const citers = [
      "scripts/contract/enforcement-contract.md",
      "bundle/skills/bearing-pr/SKILL.md",
      "bundle/skills/bearing-northstars/SKILL.md",
      "README.md",
    ];
    for (const rel of citers) {
      const src = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      for (const cite of src.match(/GP-\d+/g) ?? []) {
        assert.ok(defined.has(cite), `${rel} cites ${cite}, which no longer exists`);
      }
    }
    // Every rule earns its place with a scar — that is the whole selection rule, and without it this
    // file drifts back into generic advice the model already follows.
    // Split rather than match: with the `m` flag `$` ends the LINE, so a lazy match captured only
    // each rule's first line and every assertion below passed for the wrong reason (GP-5).
    const rules = body.split(/\n- \*\*GP-/).slice(1);
    assert.equal(rules.length, defined.size, "rule count disagrees with the numbering");
    for (const r of rules) {
      assert.match(r, /\*Scar:/, `GP-${r.match(/^\d+/)[0]} has no scar — it is generic advice`);
    }
    assert.match(
      body,
      /north-stars outrank gold practices/i,
      "precedence is unstated — a general rule could be cited over a project invariant",
    );

    // bearing owns its BLOCK — a stale copy must not outlive its fix — but not the whole file any
    // more. Agents promote lessons here, correctly: a practice learned while working is not a
    // statement about what the project IS, so northstars.md was never the right home for it. One
    // repo had fourteen of them sitting in the path of the next update.
    fs.writeFileSync(gp, fs.readFileSync(gp, "utf8").replace("Executed, or unverified", "VANDALISED"));
    fs.appendFileSync(gp, "\n- **PP-1** — **Mine.** *Scar: mine.*\n");
    updateKit(tmp, { runSetup: false, skipVerify: true });
    const merged = fs.readFileSync(gp, "utf8");
    assert.match(merged, /Executed, or unverified/, "bearing's own block did not refresh");
    assert.doesNotMatch(merged, /VANDALISED/, "an edit inside bearing's block survived");
    assert.match(merged, /- \*\*PP-1\*\* — \*\*Mine\.\*\*/, "the project's own rules were destroyed");

    // Idempotent, or the file grows: splicing the block back in verbatim left bearing's trailing
    // newline against the tail's leading one and the gap widened on every single update (NS-3).
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.equal(fs.readFileSync(gp, "utf8"), merged, "a second update changed the file again");
    assert.equal(
      (merged.match(/BEGIN GENERATED: gold-practices/g) ?? []).length,
      1,
      "the managed block was duplicated",
    );

    // The user's own north-stars are the opposite: bearing must never touch them.
    const ns = path.join(tmp, ".bearing/northstars.md");
    fs.writeFileSync(ns, "# mine\n- NS-1 — my invariant\n");
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.match(
      fs.readFileSync(ns, "utf8"),
      /my invariant/,
      "an update overwrote the user's north-stars",
    );

    // The always-on contract has to carry it, or the file is one nobody opens.
    const claude = fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8");
    assert.match(claude, /gold-practices\.md/, "nothing points the agent at the gold practices");
    assert.match(claude, /GP-\d/, "the contract names no GP rule, so none will be cited");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the PR skill teaches house style first and works without a graph", async () => {
    const rel = "skills/bearing-pr/SKILL.md";
    const body = fs.readFileSync(path.join(BUNDLE_ROOT, rel), "utf8");

    // It rides with microscope, not gitnexus: both fire at a milestone, and it must survive in a
    // repo with no index.
    const { featureOf, parseFeatures } = await import("./features.mjs");
    assert.equal(featureOf(rel), "microscope");
    // The installed path, not the bundle path — `skills/` is the Cursor/Zed form and
    // `.bearing/skills/` is where Claude reads them, so asserting the wrong one proves nothing.
    const installed = `.bearing/${rel}`;
    assert.equal(shouldCopyBundleFile(installed, "claude", parseFeatures("microscope")), true);
    assert.equal(shouldCopyBundleFile(installed, "claude", parseFeatures("taskcore")), false);
    assert.match(body, /Without it:\*\*\s*`git diff/, "no fallback for a repo with no graph");

    // The whole point of step 0: a repo that HAS a convention must keep it.
    assert.match(body, /pull_request_template/i, "does not look for the repo's own template");
    assert.match(body, /Never impose this structure/i, "would overwrite a house style");

    // And the part a generic template cannot do — reconciling the tool's blast radius with reality.
    assert.match(body, /reconcile the tool against reality/i);

    // Distinct trigger from the review skill, or the model will load the wrong one.
    const review = fs.readFileSync(path.join(BUNDLE_ROOT, "skills/bearing-pr-review/SKILL.md"), "utf8");
    assert.match(body, /bearing-pr-review/, "does not point at the reviewing skill");
    assert.notEqual(
      body.match(/^description:.*$/m)[0],
      review.match(/^description:.*$/m)[0],
      "two skills with the same description cannot be told apart",
    );
  });

  it("no block names a raw indexer command, and stealth never lets analyze touch tracked docs", async () => {
    // Reported from a live session. The block read "Run yourself — never ask the user to run npx
    // gitnexus analyze", where the ONLY concrete command in the sentence was the one it meant to
    // forbid — so the agent ran `npx gitnexus analyze` and skipped the resolved refresh entirely.
    // Naming a command in order to prohibit it is naming it.
    const policy = fs.readFileSync(
      new URL("../bundle/.bearing/lib/stale-policy.mjs", import.meta.url),
      "utf8",
    );
    const strings = policy
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    assert.doesNotMatch(strings, /npx gitnexus/, "a block names a raw npx invocation");
    assert.doesNotMatch(strings, /gitnexus analyze/, "a block names the indexer directly");

    // The same session showed the agent adding `--skip-agents-md` by hand — which bearing should be
    // doing in stealth, where writing the stats block into a tracked file and stripping it afterwards
    // leaves a window in which the repo IS dirty.
    const { planRefresh } = await import(
      new URL("../bundle/.bearing/lib/refresh-plan.mjs", import.meta.url).href
    );
    const st = { fresh: false, reason: "behind", behindFiles: 3, nodeCount: 50, embeddingsReady: true };
    for (const opts of [{}, { wantPdg: true }, { force: true }]) {
      assert.ok(
        !planRefresh(st, opts).args.includes("--skip-agents-md"),
        "a shared install should let analyze write the block; the stabilizer commits the clean form",
      );
      assert.ok(
        planRefresh(st, { ...opts, stealth: true }).args.includes("--skip-agents-md"),
        `stealth tier ${JSON.stringify(opts)} would dirty a tracked doc`,
      );
    }
    // And the runner has to actually detect stealth, or the flag never gets passed.
    const cli = fs.readFileSync(
      new URL("../bundle/.bearing/lib/refresh-cli.mjs", import.meta.url),
      "utf8",
    );
    assert.match(cli, /stealth:\s*isStealth\(\)/, "refresh-cli never tells the planner it is stealth");
  });

  it("no hook or lib hardcodes an npm alias into text an agent will act on", () => {
    // The point fix was one message; this is the invariant. Roughly twenty sites hardcoded
    // `npm run bearing:…`, which is a lie in any stealth install, and fixing them one at a time
    // leaves nothing stopping the twenty-first (GP-11 — a list kept by memory falls out of sync).
    //
    // Scope: the hook and lib code that RUNS in a target repo. Setup scripts print to a human at
    // install time, where npm scripts do exist, and are exempt below.
    const roots = [
      [".bearing/lib", ".mjs"],
      [".claude/hooks", ".mjs"],
    ];
    /** Sites that must stay literal: detectors matching what a USER typed, not instructions. */
    const ALLOW = [/\/\\bnpm run bearing:/];
    const offenders = [];
    for (const [dir, ext] of roots) {
      const abs = path.join(BUNDLE_ROOT, dir);
      for (const f of fs.readdirSync(abs)) {
        if (!f.endsWith(ext)) continue;
        const lines = fs.readFileSync(path.join(abs, f), "utf8").split("\n");
        lines.forEach((line, i) => {
          if (!/npm run bearing:/.test(line)) return;
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("*")) return; // prose about the past is fine
          if (ALLOW.some((re) => re.test(line))) return;
          offenders.push(`${dir}/${f}:${i + 1}  ${t.slice(0, 80)}`);
        });
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these name an npm alias a stealth repo has not got — use howToRun():\n  ${offenders.join("\n  ")}`,
    );
  });

  it("a block never names a command the repo does not have", () => {
    // Reported from a live stealth install: the stale-index block said "Agent MUST run npm run
    // bearing:agent-refresh", and stealth adds NO npm scripts — editing package.json is precisely
    // what that mode exists to avoid. The agent noticed the script was missing and had to work out
    // the real invocation itself. NS-6 says every block must have a discoverable exit; naming one
    // that does not exist is worse than naming none, because it looks like an answer.
    const mk = (stealth) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-howto-"));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"x","scripts":{"build":"echo"}}\n');
      fs.mkdirSync(path.join(tmp, "src"));
      fs.writeFileSync(path.join(tmp, "src/a.js"), "export const a = 1;\n");
      execSync("git add -A && git commit -qm i", { cwd: tmp, shell: "/bin/bash" });
      installKit(tmp, { runtime: "claude", features: "all", stealth, runSetup: false, skipVerify: true });
      fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".gitnexus/meta.json"),
        JSON.stringify({ lastCommit: "deadbeef", stats: { nodes: 50, embeddings: 50 } }),
      );
      const out = execSync(`node ${path.join(tmp, ".bearing/lib/check-staleness.mjs")} ${tmp}`, {
        cwd: tmp,
        encoding: "utf8",
      });
      return { tmp, detail: JSON.parse(out).detail || "" };
    };

    const shared = mk(false);
    assert.match(shared.detail, /npm run bearing:agent-refresh/, "the npm alias exists and should be preferred");

    const stealth = mk(true);
    assert.equal(
      Object.keys(JSON.parse(fs.readFileSync(path.join(stealth.tmp, "package.json"), "utf8")).scripts)
        .filter((k) => k.startsWith("bearing:")).length,
      0,
      "fixture is wrong — stealth must add no npm scripts, or this proves nothing",
    );
    assert.doesNotMatch(stealth.detail, /npm run bearing:/, "named an npm script a stealth repo has not got");
    // And what it DOES name has to be there.
    const named = stealth.detail.match(/node (\S+\.mjs)/)?.[1];
    assert.ok(named, `no runnable command named: ${stealth.detail}`);
    assert.ok(fs.existsSync(path.join(stealth.tmp, named)), `named a file that does not exist: ${named}`);

    for (const t of [shared.tmp, stealth.tmp]) fs.rmSync(t, { recursive: true, force: true });
  });

  it("every bundle path is a name a repo can actually hold", () => {
    // A stray file called `hook-helpers.mjs\n      cfg.contextCheckpointEvery = …` — a shell loop of
    // mine that expanded a multi-line variable into a filename — was committed by `git add -A`,
    // shipped in a release tag, and copied into two real repositories before anyone saw it. Nothing
    // checked, because every test asked what the bundle CONTAINS and none asked what it is CALLED.
    for (const rel of listBundleFiles()) {
      assert.ok(
        !/[\x00-\x1f]/.test(rel),
        `bundle path contains a control character: ${JSON.stringify(rel)}`,
      );
      assert.ok(!/^\s|\s$/.test(path.basename(rel)), `bundle path has stray whitespace: ${JSON.stringify(rel)}`);
      // Windows rejects these outright, so a repo on one would fail the install rather than the file.
      assert.ok(!/[<>:"|?*]/.test(rel), `bundle path is not portable: ${JSON.stringify(rel)}`);
    }
  });

  it("the commands bearing installs are RUN, and the checks know which runtime is installed", () => {
    // Three defects of one shape got through a check that compares invocation SHAPE and never
    // executes: `bearing --version` answered "Missing target repo path"; `bearing install --stealth`
    // died on a path nobody typed; and a correct CLAUDE-ONLY install was reported broken by three
    // shipped reporters looking for Cursor files, signing off with "restart Cursor" — advice for a
    // problem that did not exist. That last one was found by writing this check.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cmdrun-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"c"}\n');
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src/a.js"), "export const a = 1;\n");
    execSync("git add -A && git commit -qm i", { cwd: tmp, shell: "/bin/bash" });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    const commandsCheck = () => {
      const r = runPostChecks(tmp, {});
      const list = Array.isArray(r) ? r : r.checks || [];
      return list.find((c) => c.id === "commands_run");
    };

    // A CLAUDE-only install must not be reported broken for Cursor files it never wanted.
    const clean = commandsCheck();
    assert.ok(clean, "the commands check is not wired into runPostChecks");
    assert.equal(clean.ok, true, `a correct claude install failed: ${clean.detail}`);

    // And a genuinely broken command must be caught — which shape-comparison could never do.
    const agent = path.join(tmp, "scripts/bearing-agent.mjs");
    const original = fs.readFileSync(agent, "utf8");
    fs.writeFileSync(agent, 'throw new Error("boom");\n');
    const broken = commandsCheck();
    assert.equal(broken.ok, false, "a command that throws on startup was reported healthy");
    fs.writeFileSync(agent, original);

    // Exiting non-zero is NOT the same as crashing: several reporters signal a stale index that way,
    // in prose. Requiring a ✓/✗ marker flagged the three that answer in plain sentences.
    const r2 = spawnSync(process.execPath, [agent, "status"], { cwd: tmp, encoding: "utf8", timeout: 20000 });
    assert.ok(r2.stdout.trim().length > 0, "status produced no report at all");
    assert.equal(commandsCheck().ok, true, "an honest non-zero diagnostic was treated as a crash");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("every skill that names a graph tool warns the graph can be wrong", () => {
    // The contract carried "a zero is not evidence of absence" and NOT ONE of the twenty skills did
    // — and the skills are where the work happens, so each read as "run this tool, get the answer".
    // Computed rather than listed: a skill qualifies if it names a gitnexus tool, so a new skill
    // that uses the graph cannot quietly skip the caveat (GP-11).
    const dir = new URL("../bundle/skills/", import.meta.url);
    const missing = [];
    for (const name of fs.readdirSync(dir)) {
      const file = new URL(`${name}/SKILL.md`, dir);
      let body;
      try {
        body = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const usesGraph = /\b(gitnexus_|mcp__gitnexus__)[a-z_]+/.test(body);
      if (!usesGraph) continue;
      if (!/graph can be wrong|not evidence of absence|reconcile the tool against reality/i.test(body)) {
        missing.push(name);
      }
    }
    assert.deepEqual(missing, [], `these drive the graph with no caveat: ${missing.join(", ")}`);
  });

  it("the graph teaching covers the type layer and the tool's own uncertainty", () => {
    // The contract described the 2024 graph: a call graph plus fields. Checked against a live index
    // of a real TypeScript repo, the type layer is LARGER than the call graph — 23,018 Property,
    // 2,941 Interface, 7,280 USES against 27,611 CALLS — and none of it was taught, so an agent
    // grepped for "who uses this interface" against a graph that answers it exactly.
    const contract = fs.readFileSync(
      new URL("../scripts/contract/enforcement-contract.md", import.meta.url),
      "utf8",
    );

    // The type layer.
    for (const term of ["USES", "HAS_PROPERTY", "Interface", "TypeAlias", "Property"]) {
      assert.ok(contract.includes(term), `the contract never mentions ${term}`);
    }

    // AND ITS CONFIDENCE. Teaching `USES` without this overclaims: ~92% of those edges sit at
    // 0.51–0.55 — the indexer's best guess at a type reference it could not resolve — while `CALLS`
    // and resolved `ACCESSES` come back at 0.85–1.0. A first pass at this teaching called them
    // "exact answers", which is the graph's own uncertainty thrown away one paragraph after telling
    // the agent to read it.
    assert.match(contract, /confidence/, "edge confidence is never mentioned");

    // The contract used to say a positive result "is strong evidence: what it found is really there.
    // Use it." True before anyone measured confidence — ~92% of USES edges sit near 0.5, and an
    // inverted helper once carried a wrong conclusion straight through. The graph can be confidently
    // WRONG, not only silently empty, and the always-on teaching has to say so.
    assert.match(
      contract,
      /confidently wrong|derived, not ground truth/i,
      "the contract still presents positive results as unconditionally trustworthy",
    );
    assert.doesNotMatch(
      contract,
      /positive\*\* result is strong evidence: what it found is really there/,
      "the unqualified positive-result claim is back",
    );

    // THE SILENT OFF-BY-ONE. startLine/endLine are 0-based in raw cypher and 1-based from every
    // other tool, so the same symbol comes back with different numbers depending how you asked.
    // Verified against a real index: cypher reports a function at 149; line 149 is ` */`, the close
    // of its docblock, and the function is on 150. Jumping from a cypher result into Read/sed lands
    // one line early, every time, and nothing says so.
    assert.match(contract, /0-BASED|0-based/, "the raw-cypher line base is never stated");
    assert.match(contract, /startLine/, "startLine is never mentioned");
    assert.match(contract, /startLine\+1|startLine \+ 1/, "does not say how to correct it");

    // The audit of the remaining tools. Each of these is a way to be confidently wrong that the
    // tool reports and the teaching did not: rename's regex edits, trace's give-up flag, context's
    // dropped call sites, and the windowed candidate list every disambiguating tool shares.
    for (const term of ["text_search", "receiverTyping", "totalCandidates", "truncated", "furthest reachable"]) {
      assert.ok(contract.includes(term), `the contract never mentions ${term}`);
    }
    // query's defaults make one call a slice, not a survey.
    assert.match(contract, /max_symbols/, "query's symbol cap is never mentioned");

    // The escapes for a hub symbol. A truncated impact result is a blast radius that reads SMALLER
    // than it is — the dangerous direction — and the tool's own description says to use these.
    for (const param of ["summaryOnly", "includeTests", "relationTypes", "offset"]) {
      assert.ok(contract.includes(param), `the contract never mentions impact's ${param}`);
    }
    // Tests are excluded by default, so "no callers" without includeTests is a different claim.
    assert.match(contract, /excluded by default/, "does not warn what the defaults leave out");
    assert.match(contract, /minConfidence/, "the filter for it is never named");
    const typeSection = contract.slice(contract.indexOf("The TYPE layer is indexed"));
    assert.doesNotMatch(
      typeSection.slice(0, 1200),
      /exact answers/,
      "USES is described as exact when ~92% of its edges are near 0.5",
    );

    // Tools that exist and were taught nowhere. `group_*` and `list_repos` stay out by choice —
    // cross-repo is out of scope for this kit and the contract says so.
    for (const tool of ["check", "tool_map"]) {
      assert.ok(contract.includes(tool), `the contract never mentions the ${tool} tool`);
    }

    // THE ONE THAT MATTERS MOST, and it is not TypeScript-specific: `impact` now reports its own
    // limits in `epistemic` / `boundaries` / `causes`. Reporting `impactedCount` as the answer while
    // the same response says "may be higher" is the confident zero wearing a number.
    for (const field of ["epistemic", "boundaries", "lower-bound"]) {
      assert.ok(contract.includes(field), `the contract does not teach reading \`${field}\``);
    }

    // PDG is opt-in since it stopped being built on every commit, so its tools return zero rows by
    // default — the contract has to say that, or the agent reads an empty result as an answer.
    const pdgSection = contract.slice(contract.indexOf("Deep precision"), contract.indexOf("Full tool surface"));
    assert.match(pdgSection, /not built by default|opt-in/i, "PDG is still described as always available");
    assert.match(pdgSection, /zero rows/i, "does not warn that the tools return nothing without it");

    // And the skills must agree with the contract, or the agent gets two stories.
    const impactSkill = fs.readFileSync(
      new URL("../bundle/skills/bearing-impact-analysis/SKILL.md", import.meta.url),
      "utf8",
    );
    assert.match(impactSkill, /epistemic/, "the impact skill still treats the count as the answer");
    assert.match(impactSkill, /USES/, "the impact skill does not know a type has consumers");
  });

  it("the domain comes from the graph's own area labels, not just prose", async () => {
    // A real repo resolved to `domain: null` and the generic persona, while its graph had already
    // labelled it `upwork-scraper`, `extraction`, `ingestion`, `enrichment`, `leads`. Inference read
    // package.json, the README and CLAUDE.md — prose ABOUT the code — while a description derived
    // FROM the code sat unread on disk (GP-14).
    const { inferDomain, graphAreas } = await import("./domain.mjs");
    const mk = (areas, extra = {}) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-area-"));
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: extra.name || "thing", description: extra.description || "" }),
      );
      if (extra.readme) fs.writeFileSync(path.join(tmp, "README.md"), extra.readme);
      for (const [label, symbols] of areas) {
        const d = path.join(tmp, ".claude/skills", `gitnexus-area-${label}`);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(
          d + "/SKILL.md",
          `---\nname: gitnexus-area-${label}\ndescription: "Skill for the ${label} area. ${symbols} symbols across 3 files."\n---\n`,
        );
      }
      return tmp;
    };

    // Tooling areas and unnamed clusters are not the product.
    const noise = mk([["cluster-47", 90], ["bearing-teaching", 50], ["auth", 80], ["components", 99]]);
    assert.deepEqual(graphAreas(noise).map((a) => a.label), [], "generic and tooling areas leaked in");

    // SEVERAL areas pointing one way is the product — and it beats a stray term in the README.
    const scraper = mk(
      [["upwork-scraper", 85], ["extraction", 40], ["ingestion", 24], ["enrichment", 20]],
      { readme: "We issue a JWT for the dashboard session." },
    );
    const d1 = inferDomain(scraper);
    assert.equal(d1.domain, "data-acquisition", `a stray README term outscored the graph: ${d1.domain}`);

    // ONE area is a feature, not the product. An events platform with a `stripe` integration is not
    // a payments company — promoting any single area hit branded one as exactly that.
    const oneArea = mk([["stripe", 60], ["venues", 90], ["artists", 70]]);
    const d2 = inferDomain(oneArea);
    assert.notEqual(d2.domain, "payments", "a single integration area was adopted as the domain");

    // And when nothing matches, the areas come out anyway — the question becomes answerable instead
    // of a dead end.
    const unknown = mk([["widgets", 90], ["sprockets", 40]]);
    const d3 = inferDomain(unknown);
    assert.equal(d3.domain, null);
    assert.deepEqual(d3.areas, ["widgets", "sprockets"], "the evidence was dropped on the floor");

    for (const t of [noise, scraper, oneArea, unknown]) fs.rmSync(t, { recursive: true, force: true });
  });

  it("a stale index blocks NOTHING by default, and still refreshes on commit", () => {
    // Turned off deliberately: deciding a graph is too far behind to answer with means predicting
    // whether the drift touches what is being asked, and neither a file count nor a commit count
    // knows that. The gate stopped work it did not need to stop, and the cost landed on whoever was
    // typing. What remains is refresh on commit and on demand, plus the staleness being REPORTED.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gateoff-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"g"}\n');
    fs.mkdirSync(path.join(tmp, "src"));
    for (let i = 1; i <= 12; i++) {
      fs.writeFileSync(path.join(tmp, "src", `f${i}.js`), `export const f${i} = ${i};\n`);
    }
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    // A badly stale index: indexed commit is not in this history at all.
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/meta.json"),
      JSON.stringify({ lastCommit: "0".repeat(40), stats: { nodes: 50, embeddings: 50 } }),
    );

    const ask = (tool, input, hook) => {
      try {
        fs.unlinkSync(path.join(tmp, ".bearing/.gitnexus-staleness-cache.json"));
      } catch { /* none yet */ }
      const r = spawnSync(process.execPath, [path.join(tmp, ".claude/hooks", hook)], {
        cwd: tmp,
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
        input: JSON.stringify({ tool_name: tool, tool_input: input, cwd: tmp }),
        timeout: 20000,
      });
      if (!r.stdout.trim()) return "allow";
      try {
        return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision || "allow";
      } catch {
        return "allow";
      }
    };

    // Nothing staleness-driven may deny.
    assert.equal(ask("Read", { file_path: path.join(tmp, "src/f1.js") }, "bearing-read-guard.mjs"), "allow");
    assert.equal(ask("mcp__gitnexus__query", { search_query: "x" }, "bearing-mcp-guard.mjs"), "allow");
    assert.equal(ask("Bash", { command: "ls -la" }, "bearing-bash-guard.mjs"), "allow");

    // Turning it back on restores the block, so this is a switch and not a deletion.
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.json"),
      JSON.stringify({ stalenessGate: "block" }),
    );
    assert.equal(
      ask("mcp__gitnexus__query", { search_query: "x" }, "bearing-mcp-guard.mjs"),
      "deny",
      'stalenessGate: "block" no longer restores the gate',
    );

    // And the commit-time refresh is NOT part of the gate — it still runs.
    const hook = fs.readFileSync(path.join(tmp, ".githooks/pre-commit"), "utf8");
    assert.match(hook, /refresh-cli\.mjs/, "commit-time refresh was removed along with the gate");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("drift counts YOUR edits since the index, and resets when it is rebuilt", () => {
    // Two properties that decide whether the gate is livable.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-count-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"c"}\n');
    fs.mkdirSync(path.join(tmp, "src"));
    for (let i = 1; i <= 15; i++) {
      fs.writeFileSync(path.join(tmp, "src", `f${i}.js`), `export const f${i} = ${i};\n`);
    }
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    const head = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
    const indexAt = (whenMs) => {
      fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".gitnexus/meta.json"),
        JSON.stringify({
          lastCommit: head,
          indexedAt: new Date(whenMs).toISOString(),
          stats: { nodes: 50, embeddings: 50 },
        }),
      );
      try {
        fs.unlinkSync(path.join(tmp, ".bearing/.gitnexus-staleness-cache.json"));
      } catch { /* none yet */ }
    };
    const drift = () =>
      JSON.parse(
        execSync(`node ${path.join(tmp, ".bearing/lib/check-staleness.mjs")} ${tmp}`, {
          encoding: "utf8",
        }),
      ).driftingFiles;

    // 1. BEARING'S OWN FILES ARE NOT YOUR DRIFT. The exclusion was a list of prefixes and missed
    // everything bearing ships that is not named `bearing-*` — scripts/lib/setup-ui.mjs,
    // scripts/run-with-project-tmp.sh, scripts/install-git-hooks.sh and more. Measured 12 against 10
    // edited files right after an install, which is the tool gating itself for its own writes.
    indexAt(Date.now() - 300_000);
    assert.equal(drift(), 0, "bearing's own installed files counted as the user's drift");

    // 2. THE COUNT IS EDITS SINCE THE INDEX, NOT FILES DIRTY IN GIT.
    for (let i = 1; i <= 10; i++) fs.appendFileSync(path.join(tmp, "src", `f${i}.js`), "// e\n");
    assert.equal(drift(), 10);

    // 3. A REBUILD RESETS THE BASELINE — the ten stay dirty in git, but the graph now has them.
    const rebuiltAt = Date.now();
    indexAt(rebuiltAt);
    assert.equal(drift(), 0, "a refresh did not clear the drift it just indexed");
    assert.equal(
      execSync("git status --porcelain src | wc -l", { cwd: tmp, encoding: "utf8", shell: "/bin/bash" }).trim(),
      "10",
      "fixture wrong — the files should still be dirty in git, which is the point",
    );

    // 4. So the next edit counts 1, not 11. Ten more would be needed to reach the gate again.
    // mtime set explicitly rather than sleeping: drift is mtime-vs-indexedAt, and a test that races
    // the filesystem clock is a test that fails on someone else's machine.
    const f11 = path.join(tmp, "src", "f11.js");
    fs.appendFileSync(f11, "// later\n");
    fs.utimesSync(f11, new Date(rebuiltAt + 5000), new Date(rebuiltAt + 5000));
    assert.equal(drift(), 1, "drift accumulated across a refresh instead of resetting");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("committed and uncommitted gaps of the same size get the same verdict", async () => {
    // The two halves of one condition used to disagree below the threshold: a few UNCOMMITTED dirty
    // files left the graph tools open, while the same few files COMMITTED closed them. The verdict
    // turned on whether you had run `git commit`, not on how far the graph had drifted.
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const { classifyMcpDrift, classifyGraphBehind } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    const cfgRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gn-thr-"));
    fs.mkdirSync(path.join(cfgRoot, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(cfgRoot, ".bearing/hooks.json"), JSON.stringify({ stalenessGate: "block" }));
    const cfg = helpers.loadHookConfig(cfgRoot);

    // Pinned deliberately: 3 fired during an ordinary few minutes of editing, so the gate
    // interrupted routine work rather than real drift. Changing this is a product decision, and
    // should have to change this line too.
    assert.equal(cfg.driftRefreshThreshold, 8, "the drift threshold moved without a decision");

    const t = cfg.driftRefreshThreshold;
    for (const n of [1, 2, t - 1, t, t + 4]) {
      const uncommitted = classifyMcpDrift(
        "mcp__gitnexus__query",
        { fresh: true, nodeCount: 50, embeddingsReady: true, driftingFiles: n },
        cfg,
        "fresh",
      ).decision;
      // Below the threshold the committed side reaches graph_behind; at or above it the policy
      // returns must_refresh, which denies everything and is asserted elsewhere.
      const committed =
        n < t
          ? classifyGraphBehind("mcp__gitnexus__query", { behindFiles: n }).decision
          : "deny";
      assert.equal(
        uncommitted,
        committed,
        `${n} files: uncommitted=${uncommitted} but committed=${committed} — same gap, different answer`,
      );
      assert.equal(uncommitted, n >= t ? "deny" : "allow", `${n} files should be ${n >= t ? "blocked" : "allowed"}`);
    }
  });

  it("generated area-skills reach a teammate WITHOUT bearing, and never reach the indexer", () => {
    // Two failures that only show up together. GitNexus renamed its generated area-skills from
    // `.claude/skills/generated/<area>/` to `.claude/skills/gitnexus-area-<area>/` — which landed
    // inside the folder bearing ignores for its own symlink farm. So the replacements reached
    // nobody: a teammate without bearing pulled 16 deletions and got nothing back.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-skillshare-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"s"}\n');
    execSync("git add -A && git commit -qm i", { cwd: tmp, shell: "/bin/bash" });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    // Stand in for what `gitnexus analyze --skills` writes.
    const area = path.join(tmp, ".claude/skills/gitnexus-area-apis");
    fs.mkdirSync(area, { recursive: true });
    fs.writeFileSync(path.join(area, "SKILL.md"), "---\nname: gitnexus-area-apis\n---\n");

    const ignored = (rel) =>
      spawnSync("git", ["check-ignore", "-q", rel], { cwd: tmp }).status === 0;

    // 1. The generated skills must be COMMITTABLE — that is the only way they travel to someone who
    // does not run bearing or gitnexus themselves.
    assert.equal(
      ignored(".claude/skills/gitnexus-area-apis/SKILL.md"),
      false,
      "generated area-skills are ignored, so a teammate without bearing gets none",
    );
    // 2. Bearing's OWN symlink farm must stay ignored — it is regenerated per machine and points
    // into the tracked .bearing/skills/.
    assert.equal(
      ignored(".claude/skills/bearing-microscope"),
      true,
      "bearing's per-machine symlinks became tracked",
    );
    // 3. And nothing in the agent layer may reach the INDEXER. The graph answers questions about
    // this project's source; instructions written for an agent are not source, and the generated
    // skills are derived FROM the index, so indexing them feeds it its own output.
    const gni = fs.readFileSync(path.join(tmp, ".gitnexusignore"), "utf8");
    for (const rule of [".claude/", ".bearing/", ".cursor/", "AGENTS.md", "CLAUDE.md"]) {
      assert.ok(
        gni.split("\n").some((l) => l.trim() === rule),
        `.gitnexusignore does not exclude ${rule} — the index will swallow the agent layer`,
      );
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the refresh planner is safe on every diagnosis the checker can emit", async () => {
    // Found by walking a REAL repo through every state instead of unit-testing the happy ones.
    const { planRefresh } = await import(
      new URL("../bundle/.bearing/lib/refresh-plan.mjs", import.meta.url).href
    );
    const ok = { nodeCount: 50, embeddingsReady: true };

    // 1. THE REGRESSION MY OWN OPTIMISATION CAUSED. Working-tree drift is only measured when HEAD
    // has not moved, and the docs-only exemption declares the index FRESH — so one README commit
    // landing on top of dirty source made drift read 0 and the planner answer "nothing to do" while
    // four source files were modified. The graph then answers from code that is not there.
    assert.equal(
      planRefresh({ ...ok, fresh: true, reason: "behind_non_source", behindFiles: 0, driftingFiles: 4 }).tier,
      "incremental",
      "a docs-only commit blinded the working-tree check",
    );
    assert.equal(
      planRefresh({ ...ok, fresh: true, reason: "behind_non_source", behindFiles: 0, driftingFiles: 0 }).tier,
      "none",
      "a genuinely clean tree must still skip",
    );

    // 1b. THE SAME BUG AT ITS REAL SEAM. Everything above hands the planner a hand-written stale
    // object, and the planner was always correct given drift=4 — the CHECKER never produced it.
    // Reverting the checker fix left every assertion above green (GP-3), so this drives the real
    // check-staleness against a real repo in exactly the failing shape.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-drift-"));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"d"}\n');
      fs.writeFileSync(path.join(tmp, "README.md"), "# d\n");
      fs.mkdirSync(path.join(tmp, "src"));
      for (const i of [1, 2, 3]) {
        fs.writeFileSync(path.join(tmp, "src", `s${i}.js`), `export const s${i} = ${i};\n`);
      }
      execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
      installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
      // An index that is current as of a moment in the past, so later edits count as drift.
      fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
      const head = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf8" }).trim();
      fs.writeFileSync(
        path.join(tmp, ".gitnexus/meta.json"),
        JSON.stringify({
          lastCommit: head,
          indexedAt: new Date(Date.now() - 60_000).toISOString(),
          stats: { nodes: 50, embeddings: 50 },
        }),
      );
      const look = () => {
        try {
          fs.unlinkSync(path.join(tmp, ".bearing/.gitnexus-staleness-cache.json"));
        } catch { /* none yet */ }
        return JSON.parse(
          execSync(`node ${path.join(tmp, ".bearing/lib/check-staleness.mjs")} ${tmp}`, {
            encoding: "utf8",
          }),
        );
      };
      // Dirty source, HEAD unchanged — the path that always worked.
      for (const i of [1, 2, 3]) fs.appendFileSync(path.join(tmp, "src", `s${i}.js`), "// edit\n");
      assert.ok(look().driftingFiles >= 3, "baseline drift detection is broken");

      // Now a DOCS-ONLY commit on top. The source files are still dirty.
      fs.appendFileSync(path.join(tmp, "README.md"), "docs\n");
      execSync("git add README.md && git commit -qm docs", { cwd: tmp, shell: "/bin/bash" });
      const after = look();
      assert.equal(after.reason, "behind_non_source", "fixture did not reach the docs-only path");
      assert.ok(
        after.driftingFiles >= 3,
        `a docs-only commit blinded the working-tree check: drift=${after.driftingFiles} with 3 dirty source files`,
      );
      assert.equal(planRefresh(after).tier, "incremental");
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // 2. An unmeasurable gap must not get the CHEAPEST treatment. countBehindSource returns -1 when
    // git cannot answer, and -1 < threshold is true, so it fell through to incremental.
    for (const st of [
      { ...ok, fresh: false, reason: "behind_unmeasured", behindFiles: -1 },
      { ...ok, fresh: false, reason: "behind", behindFiles: -1 },
    ]) {
      const p = planRefresh(st);
      assert.equal(p.tier, "full", "an unknown gap was treated as small");
      assert.ok(p.args.includes("--force"));
    }

    // 3. Every reason the checker can actually emit must land somewhere deliberate. `unreadable` was
    // branched on and never emitted; `invalid_meta` is emitted and was never named.
    const checker = fs.readFileSync(
      new URL("../bundle/.bearing/lib/check-staleness.mjs", import.meta.url),
      "utf8",
    );
    // Pull every quoted token out of each `reason =` STATEMENT, not just the simple assignments —
    // one reason is emitted through a ternary, and a narrower pattern silently missed it, which is
    // the same class of blind spot this test exists to close.
    const emitted = [...checker.matchAll(/\breason\s*=\s*([^;\n]+)/g)].flatMap((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((q) => q[1]),
    );
    assert.ok(emitted.includes("invalid_meta") && emitted.includes("not_git"), "checker changed shape");
    for (const reason of new Set(emitted)) {
      const p = planRefresh({ ...ok, fresh: false, reason, behindFiles: 1 });
      assert.ok(
        ["none", "incremental", "embeddings", "pdg", "full"].includes(p.tier),
        `reason ${reason} produced no valid tier`,
      );
      if (reason === "not_git") {
        assert.equal(p.tier, "none", "would run the analyzer outside a git worktree");
      }
    }
    // And no branch may test a reason the checker cannot produce.
    const planner = fs.readFileSync(
      new URL("../bundle/.bearing/lib/refresh-plan.mjs", import.meta.url),
      "utf8",
    );
    for (const m of planner.matchAll(/reason === "([a-z_]+)"/g)) {
      assert.ok(emitted.includes(m[1]), `planner branches on "${m[1]}", which the checker never emits`);
    }
  });

  it("the refresh is chosen from the diagnosis, not forced every time", async () => {
    // Every AUTOMATIC refresh path asked for the most expensive option unconditionally: pre-commit
    // ran `analyze --force --embeddings --skills --pdg` on every commit, and the staleness gate told
    // the agent to run the same thing for ANY staleness, two files behind included. `analyze` is
    // already incremental — --force is the opt-in — so the full rebuild bought nothing a plain
    // analyze does not, and cost minutes per commit on a large repository.
    const { planRefresh } = await import(
      new URL("../bundle/.bearing/lib/refresh-plan.mjs", import.meta.url).href
    );
    const healthy = { nodeCount: 1795, embeddingsReady: true };

    // Nothing the graph indexes moved → do nothing at all. This is the common case and the big win.
    assert.equal(planRefresh({ ...healthy, fresh: true }).tier, "none");
    assert.equal(
      planRefresh({ ...healthy, fresh: true, reason: "behind_non_source", behindFiles: 0 }).tier,
      "none",
    );

    // THE PRE-COMMIT SHAPE, and the one every fixture below originally missed. The hook runs while
    // the change is STAGED: HEAD has not moved, so the index is commit-fresh and behindFiles is 0,
    // while the working tree is full of edited source. Reading only the committed side reported
    // "nothing to do" for a commit that changed everything.
    const staged = { ...healthy, fresh: true, behindFiles: 0, driftingFiles: 4 };
    assert.equal(planRefresh(staged).tier, "incremental", "staged source edits were skipped");
    assert.match(planRefresh(staged).why, /4 source file/);

    // A normal gap is incremental, and must NOT carry --force or --pdg.
    for (const n of [1, 2, 20, 500]) {
      const p = planRefresh({ ...healthy, fresh: false, reason: "behind", behindFiles: n });
      assert.equal(p.tier, "incremental", `${n} files behind should be incremental`);
      assert.ok(!p.args.includes("--force"), `${n} files behind forced a full rebuild`);
      assert.ok(!p.args.includes("--pdg"), `${n} files behind built the PDG substrate`);
    }

    // THE ONE CASE THAT GENUINELY NEEDS --force. analyze short-circuits on "already up to date"
    // before it reaches the embedder, so a graph with no embeddings cannot gain them incrementally.
    // Verified against the real binary: two `--embeddings 0` runs left it at 0 embeddings, and only
    // --force produced them. Downgrading this to incremental would leave semantic search dead while
    // reporting success.
    const noEmb = planRefresh({ nodeCount: 1795, embeddingsReady: false, reason: "missing_embeddings" });
    assert.equal(noEmb.tier, "embeddings");
    assert.ok(noEmb.args.includes("--force"), "a missing-embeddings index was 'fixed' without --force");
    assert.ok(noEmb.args.includes("--embeddings"));

    // Diverged history cannot be reconciled incrementally either.
    assert.ok(planRefresh({ ...healthy, fresh: false, reason: "diverged" }).args.includes("--force"));
    // No index, or a checker that could not answer → build one; never claim "nothing to do".
    assert.equal(planRefresh({ reason: "missing", nodeCount: 0 }).tier, "full");
    assert.equal(planRefresh(null).tier, "full");

    // PDG is on demand. Asking for it on a CURRENT graph still needs --force, for the same
    // short-circuit reason as embeddings.
    const pdg = planRefresh({ ...healthy, fresh: true }, { wantPdg: true });
    assert.equal(pdg.tier, "pdg");
    assert.ok(pdg.args.includes("--pdg") && pdg.args.includes("--force"));

    // And the two callers must actually be off the forced path.
    const hook = fs.readFileSync(
      new URL("../bundle/.githooks/pre-commit", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(hook, /npm run bearing:full-pdg/, "pre-commit still forces a full rebuild");
    assert.match(hook, /refresh-cli\.mjs/, "pre-commit does not use the tiered refresh");
    const agent = fs.readFileSync(
      new URL("../bundle/scripts/bearing-agent.mjs", import.meta.url),
      "utf8",
    );
    // Scoped to what it RUNS, not what it mentions: the comment there records the history on
    // purpose, and a bare /bearing:full-pdg/ over the block matched that comment (GP-5).
    const refreshBlock = agent.slice(agent.indexOf('cmd === "refresh"'));
    assert.doesNotMatch(
      refreshBlock,
      /runAllowFail\([^)]*bearing:full-pdg/,
      "agent-refresh still forces a full rebuild for any staleness",
    );
    assert.match(refreshBlock, /refresh-cli\.mjs/, "agent-refresh does not use the tiered refresh");
  });

  it("a stale index blocks in proportion to what actually changed", () => {
    // The commit path counted COMMITS, not files, and applied no source filter: `commitsBehind > 0`
    // meant everything — Read, Grep, MCP — was denied until a reindex. So a commit touching one file
    // stopped the session, and a commit touching only README.md stopped it too, while the graph was
    // accurate for every line of code in the repo. The drift path, which is the same condition
    // reached through the working tree, measured source files and gated only the graph tools.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gate-"));
    const sh = (c) => execSync(c, { cwd: root, encoding: "utf8", shell: "/bin/bash" }).trim();
    execSync("git init -q", { cwd: root });
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"g"}\n');
    fs.mkdirSync(path.join(root, "src"));
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      fs.writeFileSync(path.join(root, "src", `f${i}.js`), `export const f${i} = () => ${i};\n`);
    }
    fs.writeFileSync(path.join(root, "README.md"), "# r\n");
    sh("git add -A && git commit -qm init");
    installKit(root, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    // The staleness gate is opt-in now; this test is about how it blocks when ON.
    fs.writeFileSync(
      path.join(root, ".bearing/hooks.json"),
      JSON.stringify({ stalenessGate: "block" }),
    );
    // Commit the kit itself first — otherwise IT is the delta being measured.
    sh("git add -A && git commit -qm kit");
    fs.mkdirSync(path.join(root, ".gitnexus"), { recursive: true });

    const anchor = (ref) => {
      fs.writeFileSync(
        path.join(root, ".gitnexus", "meta.json"),
        JSON.stringify({
          lastCommit: sh(`git rev-parse ${ref}`),
          indexedAt: new Date().toISOString(),
          stats: { nodes: 50, embeddings: 50 },
        }),
      );
      // The verdict is cached for latency; without clearing it each tier reuses the first.
      try {
        fs.unlinkSync(path.join(root, ".bearing", ".gitnexus-staleness-cache.json"));
      } catch {
        /* none yet */
      }
    };
    const stale = () => JSON.parse(sh(`node ${path.join(root, ".bearing/lib/check-staleness.mjs")}`));
    const ask = (tool, input, hook) => {
      const r = spawnSync(process.execPath, [path.join(root, ".claude/hooks", hook)], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        input: JSON.stringify({ tool_name: tool, tool_input: input, cwd: root }),
        timeout: 20000,
      });
      if (!r.stdout.trim()) return "allow";
      try {
        return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision || "allow";
      } catch {
        return "allow";
      }
    };
    const read = () => ask("Read", { file_path: path.join(root, "src/f1.js") }, "bearing-read-guard.mjs");
    const query = () => ask("mcp__gitnexus__query", { search_query: "x" }, "bearing-mcp-guard.mjs");

    // A commit that touches no source at all: the graph is not stale, because nothing it indexes moved.
    fs.appendFileSync(path.join(root, "README.md"), "\nmore\n");
    sh("git add -A && git commit -qm docs");
    anchor("HEAD~1");
    let s = stale();
    assert.equal(s.behindFiles, 0, "non-source files were counted as source");
    assert.equal(s.fresh, true, "a docs-only commit still marked the graph stale");
    assert.equal(query(), "allow", "a docs-only commit still blocked the graph");

    // Under the threshold: the graph is close enough to answer with, and NOTHING is taken away.
    //
    // This used to deny the graph tools here. That made the two halves of one condition disagree —
    // a few UNCOMMITTED dirty files left the graph open, while the same few files COMMITTED closed
    // it, so the verdict turned on whether you had run `git commit` rather than on how far the graph
    // had drifted. Under the threshold both are now permissive; over it, must_refresh still stops.
    for (const i of [1, 2]) fs.appendFileSync(path.join(root, "src", `f${i}.js`), "//a\n");
    sh("git add -A && git commit -qm two");
    anchor("HEAD~1");
    s = stale();
    assert.equal(s.behindFiles, 2);
    assert.equal(s.reason, "behind_small");
    assert.equal(query(), "allow", "a 2-file gap blocked the graph tools");
    assert.equal(read(), "allow", "a 2-file gap took away Read — that is the over-reach being fixed");

    // Over it: the hard block is unchanged. Nine files, because the threshold is 8.
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) fs.appendFileSync(path.join(root, "src", `f${i}.js`), "//b\n");
    sh("git add -A && git commit -qm nine");
    anchor("HEAD~1");
    s = stale();
    assert.equal(s.behindFiles, 9);
    assert.equal(s.reason, "behind");
    assert.equal(read(), "deny", "a materially stale index must still stop the session");
    assert.equal(query(), "deny");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the pre-commit hook reports a broken index instead of blocking the commit (NS-5, NS-8)", () => {
    // It ran `npm run bearing:full-pdg` unguarded under `set -e`, so ANY indexer failure blocked
    // every commit in the repo. That happened to a real team: analyze ended "graph write collapsed,
    // 200,722 relationships produced, 64,983 readable" and they committed with --no-verify for
    // days. Blocking a commit because an INDEX could not be built fails the developer for something
    // that is not their fault and cannot be fixed from there, and --no-verify teaches people to
    // skip the hook permanently — a far bigger loss than one stale index.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-hook-"));
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".githooks"), { recursive: true });
    const hook = path.join(tmp, ".githooks/pre-commit");
    fs.copyFileSync(path.join(BUNDLE_ROOT, ".githooks/pre-commit"), hook);
    fs.chmodSync(hook, 0o755);
    // Records that the graph was marked untrustworthy, standing in for the real flag writer.
    fs.writeFileSync(
      path.join(tmp, ".bearing/lib/set-refresh-pending.mjs"),
      `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(path.join(tmp, "FLAG"))}, process.argv[3]);\n`,
    );
    // The hook refreshes through .bearing/lib/refresh-cli.mjs now, not `npm run bearing:full-pdg`,
    // so the stub that decides "did the index build succeed" moves there with it.
    const scripts = (refresh, smoke) => {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "h", scripts: { "bearing:graph-smoke": smoke } }),
      );
      fs.writeFileSync(
        path.join(tmp, ".bearing/lib/refresh-cli.mjs"),
        refresh === "exit 1" ? "process.exit(1);\n" : "console.log('refreshed');\n",
      );
    };
    const run = (env = {}) => {
      fs.rmSync(path.join(tmp, "FLAG"), { force: true });
      const r = spawnSync(hook, [], { cwd: tmp, encoding: "utf8", env: { ...process.env, ...env } });
      let flag = null;
      try {
        flag = fs.readFileSync(path.join(tmp, "FLAG"), "utf8");
      } catch {
        /* not marked */
      }
      return { status: r.status, out: `${r.stdout}${r.stderr}`, flag };
    };

    // A failing index must NOT block, and must leave the graph marked untrustworthy — fail open for
    // the developer, fail closed for the graph (NS-8).
    scripts("exit 1", "echo ok");
    const broken = run();
    assert.equal(broken.status, 0, "a failed index blocked the commit");
    assert.equal(broken.flag, "set-failed", "commit allowed but the graph was left looking trustworthy");
    // Every exit named (NS-6): how to fix it, how to report it, how to make it strict.
    for (const hint of [/agent-refresh/, /bearing:fallback/, /BEARING_PRECOMMIT/]) {
      assert.match(broken.out, hint, `the warning does not name ${hint}`);
    }

    // Teeth are opt-in, exactly like GITNEXUS_CI_MODE=block.
    assert.equal(run({ BEARING_PRECOMMIT: "block" }).status, 1, "block mode did not block");

    // A healthy run must not cry wolf — marking a working graph failed would send every agent
    // into refresh-first mode for nothing (NS-5).
    scripts("echo indexed", "echo ok");
    const healthy = run();
    assert.equal(healthy.status, 0);
    assert.equal(healthy.flag, null, "a healthy index was marked failed");

    // The smoke test is the other way the graph can be wrong, and gets the same treatment.
    scripts("echo indexed", "exit 1");
    const smoke = run();
    assert.equal(smoke.status, 0, "a failed smoke test blocked the commit");
    assert.equal(smoke.flag, "set-failed");
  });

  it("release notes are cut from the changelog exactly, at the right commit", async () => {
    // Parsing lives in lib/ because the INSTALLER needs it at runtime; the script only adds the
    // git lookup. Importing both here keeps that split honest.
    const { parseChangelog, releasableVersions, versionsSince } = await import(
      new URL("./changelog.mjs", import.meta.url).href
    );
    const { commitForVersion } = await import(
      new URL("../scripts/release-notes.mjs", import.meta.url).href
    );
    const md = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "- pending",
      "",
      "## 2.0.0 — newest",
      "",
      "### Fixed",
      "",
      "- a thing",
      "",
      "## 1.0.0 — first public release (as `bearing`)",
      "",
      "- the rename",
      "",
      "## 1.2.0 — old scheme",
      "",
      "- predates the rename",
    ].join("\n");

    const entries = parseChangelog(md);
    const two = entries.find((e) => e.version === "2.0.0");
    assert.equal(two.title, "newest");
    // The section must stop at the next heading, or a release ships the whole rest of the file.
    assert.equal(two.body, "### Fixed\n\n- a thing");

    const releasable = releasableVersions(md).map((e) => e.version);
    assert.deepEqual(releasable, ["2.0.0", "1.0.0"]);
    // Unreleased is not a release, and 1.2.0 predates the rename despite the higher number —
    // publishing it would drop a v1.2.0 tag newer than every real one (position decides, not sort).
    assert.ok(!releasable.includes("Unreleased"));
    assert.ok(!releasable.includes("1.2.0"));

    // The commit is resolved from package.json history, not the commit message: `--grep '^1.0.4'`
    // anchors to any line of the message, so a later commit MENTIONING the version won the match
    // and the tag would have landed on the wrong code.
    const sha = commitForVersion("1.0.4");
    if (sha) {
      const declared = JSON.parse(
        execSync(`git show ${sha}:package.json`, {
          cwd: path.join(BUNDLE_ROOT, ".."),
          encoding: "utf8",
        }),
      ).version;
      assert.equal(declared, "1.0.4", "resolved commit does not declare that version");
    }

    // What `bearing update` prints: the releases between the version this repo HAD and now.
    assert.deepEqual(versionsSince(md, "1.0.0").map((e) => e.version), ["2.0.0"]);
    // Silent rather than wrong. An unknown previous version cannot yield an honest range, and
    // already-current must not announce anything (NS-20).
    assert.deepEqual(versionsSince(md, "0.9.9-old"), []);
    assert.deepEqual(versionsSince(md, "2.0.0"), []);
    assert.deepEqual(versionsSince(md, undefined), []);
  });

  it("the contract never names an npm script this install does not have (NS-13, NS-20)", async () => {
    // Every npm script is owned by the gitnexus module, so an intel-only install has NONE — and the
    // contract still said "Print them anytime: `npm run bearing:northstars`". The north-stars module
    // was advertising a command you only get by installing a DIFFERENT module, in the one file every
    // agent reads as authoritative. Docs elsewhere mention commands illustratively; the contract is
    // an instruction, so it is held to what is actually installed.
    const { runPostChecks } = await import(new URL("./postcheck.mjs", import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-cmd-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    const manifest = installKit(tmp, {
      runtime: "all",
      features: "northstars,taskcore,microscope",
      runSetup: false,
      skipVerify: true,
    });
    const ctx = { features: new Set(manifest.features), mcpTransport: manifest.mcpTransport };
    const dangling = () => runPostChecks(tmp, ctx).find((c) => c.id === "no_dangling_refs");
    assert.ok(dangling().ok, `intel-only contract names a missing command: ${dangling().detail}`);

    // ...and the check must be able to SEE it (NS-9): put the old line back and it goes red. An
    // install with zero npm scripts is the case the original scan skipped entirely.
    const claude = path.join(tmp, "CLAUDE.md");
    fs.appendFileSync(claude, "\n- Print them anytime: `npm run bearing:northstars`.\n");
    assert.equal(dangling().ok, false, "the contract scan cannot see an uninstallable command");
  });

  it("intel-only install leaves no gitnexus artifacts in the repo (NS-13)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-intel-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, {
      runtime: "claude",
      features: "northstars",
      runSetup: false,
      skipVerify: true,
    });

    // The manifest is the install's identity — it must not be parked inside the graph tool's
    // index directory, because writing it CREATES that directory in a repo that declined the
    // module. This is the fifth channel NS-13 does not list.
    assert.ok(
      fs.existsSync(path.join(tmp, MANIFEST_PATH)),
      "manifest missing from its own directory",
    );
    assert.ok(
      !fs.existsSync(path.join(tmp, ".gitnexus")),
      "install created .gitnexus/ in a repo that declined the gitnexus module",
    );

    // ...and the ignore block must not describe graph artifacts either.
    const ignoreLines = () =>
      fs
        .readFileSync(path.join(tmp, ".gitignore"), "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"));
    const intel = ignoreLines();
    assert.ok(
      !intel.includes(".gitnexus/"),
      `gitignore names the graph index: ${intel.join(" ")}`,
    );
    assert.ok(
      !intel.includes("docs/ARCHITECTURE.gitnexus.md"),
      "gitignore names a doc only the graph module generates",
    );
    // Session state IS still written by the core session-primer (the north-star counter lives
    // there), so that line must survive the split — gating it would start tracking runtime junk.
    assert.ok(intel.includes(".bearing/.gitnexus-*"), "core session state must stay ignored");
    assert.ok(intel.includes(".bearing/manifest.json"), "manifest must stay untracked");

    // NEGATIVE CONTROL (NS-12): select the module and the same lines must come back, or the
    // assertions above would pass against a permanently empty ignore block.
    installKit(tmp, {
      runtime: "claude",
      features: "northstars,gitnexus",
      runSetup: false,
      skipVerify: true,
    });
    const withGraph = ignoreLines();
    assert.ok(withGraph.includes(".gitnexus/"), "graph module selected → index must be ignored");
    assert.ok(
      withGraph.includes("docs/ARCHITECTURE.gitnexus.md"),
      "graph module selected → derived arch doc must be ignored",
    );
    // NS-3: the block is rewritten, not accumulated.
    assert.equal(
      withGraph.filter((l) => l === ".gitnexus/").length,
      1,
      "re-install duplicated an ignore line",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("still finds and migrates an install whose manifest is at the legacy path", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-oldmanifest-"));
    execSync("git init -q", { cwd: tmp });
    // Exactly what a pre-rename install left behind.
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gitnexus/agent-kit-manifest.json"),
      JSON.stringify({ version: 1, runtime: "claude", features: ["northstars"], files: [] }),
    );

    // The manifest IS the install's identity: miss the old path and update-all silently stops
    // seeing every repo installed before the rename.
    assert.deepEqual(findInstalledRepos(tmp), [tmp], "legacy install went undiscovered");
    const prev = readManifest(tmp);
    assert.equal(prev?.data.runtime, "claude", "legacy manifest unreadable");

    updateKit(tmp, { runSetup: false, skipVerify: true });

    assert.ok(fs.existsSync(path.join(tmp, MANIFEST_PATH)), "manifest was not moved");
    assert.ok(
      !fs.existsSync(path.join(tmp, ".gitnexus/agent-kit-manifest.json")),
      "legacy manifest left behind — two manifests can now disagree",
    );
    // The prior module selection has to survive the move, or the upgrade silently re-adds the
    // graph gates to a repo that turned them off.
    assert.deepEqual(readManifest(tmp)?.data.features, ["northstars"]);
    // Nothing selected the graph module, so the emptied index dir should not linger.
    assert.ok(!fs.existsSync(path.join(tmp, ".gitnexus")), "orphaned .gitnexus/ left behind");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("upgrading over the old AGENTS.md marker replaces the block instead of doubling it", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-marker-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(
      path.join(tmp, "AGENTS.md"),
      [
        "# House rules",
        "",
        "<!-- gitnexus-agent-kit:BEGIN -->",
        "stale contract from the previous name",
        "<!-- gitnexus-agent-kit:END -->",
        "",
        "## Notes the user keeps below the block",
        "",
      ].join("\n"),
    );

    installKit(tmp, {
      runtime: "zed",
      features: "northstars",
      runSetup: false,
      skipVerify: true,
    });

    const agents = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    const count = (re) => (agents.match(re) ?? []).length;
    // The exact failure GITIGNORE_MARKERS_LEGACY documents: match only the current marker and
    // every already-installed repo keeps its old block AND gains a new one.
    assert.equal(count(/bearing:BEGIN/g), 1, "expected exactly one managed block");
    assert.equal(count(/gitnexus-agent-kit:BEGIN/g), 0, "old marker survived the upgrade");
    assert.ok(!agents.includes("stale contract"), "stale contract body survived");
    assert.ok(agents.includes("# House rules"), "user content above the block was lost");
    assert.ok(
      agents.includes("## Notes the user keeps below the block"),
      "user content below the block was lost",
    );
    assert.ok(
      agents.indexOf("# House rules") < agents.indexOf("<!-- bearing:BEGIN -->"),
      "block moved out of its original position",
    );

    // NS-3: a second upgrade converges rather than accumulating.
    installKit(tmp, {
      runtime: "zed",
      features: "northstars",
      runSetup: false,
      skipVerify: true,
    });
    const again = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    assert.equal((again.match(/bearing:BEGIN/g) ?? []).length, 1, "re-install doubled the block");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("uninstall after an update leaves the repo as it found it (NS-1)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-leftover-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    const before = fs.readdirSync(tmp).sort();

    const opts = {
      runtime: "claude,zed",
      features: "northstars,taskcore",
      runSetup: false,
      skipVerify: true,
    };
    installKit(tmp, opts);
    // The UPDATE is the point: .bearing/hooks.json is seeded only when absent, so the second pass
    // skips it — and skipping it used to drop it out of the manifest's file list, after which
    // uninstall no longer knew the kit had put it there.
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.ok(
      readManifest(tmp)?.data.files.includes(".bearing/hooks.json"),
      "an update disowned a file the install created",
    );

    uninstallKit(tmp);

    assert.deepEqual(
      fs.readdirSync(tmp).sort(),
      before,
      `uninstall left artifacts behind: ${fs.readdirSync(tmp).sort().join(", ")}`,
    );
  });

  // The test above runs claude+zed with the intel modules — a configuration in which none of the
  // defects below can appear: no .cursor adapter at all, and .zed/settings.json is written only
  // when the gitnexus module is on. Everything installed on every runtime is where uninstall is
  // actually hard, and it was leaving three things behind (NS-9: the fixture picked the easy case).
  it("the installer never tells you to run something this install does not have (NS-20)", () => {
    // A stealth install has NO npm scripts by design, and the summary told the user to run five of
    // them — verify, health, agent-status, setup, and a gate doc — plus "Read CLAUDE.md", a file
    // stealth deliberately never writes. The install computed `features.has("gitnexus") && !stealth`
    // and the SUMMARY re-derived the same fact without the stealth half. Every line printed is a
    // claim; these were checked against nothing.
    for (const stealth of [false, true]) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gn-say-${stealth ? "s" : "n"}-`));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"s"}\n');
      execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

      const r = spawnSync(
        process.execPath,
        [
          path.join(BUNDLE_ROOT, "../lib/kit.mjs"),
          "install", tmp, "--runtime", "claude", "--features", "all",
          ...(stealth ? ["--stealth"] : []), "--no-setup", "--skip-verify",
        ],
        { encoding: "utf8" },
      );
      const out = `${r.stdout}${r.stderr}`;
      assert.match(out, /Next steps/, `${stealth ? "stealth" : "normal"}: the summary did not print`);

      const scripts = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")).scripts ?? {};
      const badNpm = [...new Set([...out.matchAll(/npm run ([\w.:@-]+)/g)].map((m) => m[1]))]
        .filter((name) => !scripts[name]);
      assert.deepEqual(badNpm, [], `${stealth ? "stealth" : "normal"}: named absent npm scripts: ${badNpm.join(", ")}`);

      // Direct invocations are the stealth substitute, so they have to resolve too.
      const badFile = [...new Set([...out.matchAll(/(?:node|bash) (scripts\/[\w./-]+)/g)].map((m) => m[1]))]
        .filter((rel) => !fs.existsSync(path.join(tmp, rel)));
      assert.deepEqual(badFile, [], `${stealth ? "stealth" : "normal"}: named absent files: ${badFile.join(", ")}`);

      // And it must not point at a contract file it did not write.
      for (const m of out.matchAll(/Read ([\w./-]+\.md)/g)) {
        assert.ok(
          fs.existsSync(path.join(tmp, m[1])),
          `${stealth ? "stealth" : "normal"}: told the user to read ${m[1]}, which does not exist`,
        );
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the CLI documents every flag it accepts, and every module (NS-20)", async () => {
    const { FEATURE_IDS } = await import(new URL("./features.mjs", import.meta.url).href);
    // `--features` named four modules for a build that shipped five, and --stealth, --mcp and
    // --gitnexus-cmd were accepted but absent from the usage text entirely. A flag nobody can
    // discover is a feature that does not exist for most users, and the omission is the same class
    // as an over-claim: the help is a CLAIM about the program, and nothing was checking it.
    const src = fs.readFileSync(path.join(BUNDLE_ROOT, "../lib/kit.mjs"), "utf8");
    const usage = spawnSync(process.execPath, [path.join(BUNDLE_ROOT, "../lib/kit.mjs")], {
      encoding: "utf8",
    });
    const help = `${usage.stdout}${usage.stderr}`;
    assert.match(help, /^Usage:/m, "the CLI no longer prints usage with no arguments");

    // Every flag the parser reads must be reachable from the help.
    const accepted = [
      ...new Set(
        [...src.matchAll(/(?:flags\.has|rest\.indexOf)\(\s*"(--[a-z-]+)"/g)].map((m) => m[1]),
      ),
    ].sort();
    const undocumented = accepted.filter((f) => !help.includes(f));
    assert.deepEqual(undocumented, [], `accepted but undocumented: ${undocumented.join(", ")}`);

    // ...and every installable module must be nameable. Derived, not listed, so adding a sixth
    // module cannot leave the help describing five.
    const unnamed = FEATURE_IDS.filter((id) => !help.includes(id));
    assert.deepEqual(unnamed, [], `installable but not in --features help: ${unnamed.join(", ")}`);
  });

  it("the task-core nudge counts unsaved EDITS, not context fullness (NS-20)", () => {
    // The old trigger fired at ~90% of the context window, and the window is not knowable at
    // runtime: the transcript does not record it, the model id does not settle it, and the only
    // real measurement arrives after a compaction has already happened. Two shipped attempts at
    // inferring it were wrong in opposite directions. What actually makes a compaction expensive is
    // unwritten work, so that is what this counts.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-tcn-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"t"}\n');
    installKit(tmp, { runtime: "claude", features: "taskcore", runSetup: false, skipVerify: true });
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.local.json"),
      JSON.stringify({ taskCoreEveryEdits: 3 }),
    );
    const hook = path.join(tmp, ".claude/hooks/bearing-taskcore-nudge.mjs");
    const fire = (tool) => {
      const r = spawnSync(process.execPath, [hook], {
        cwd: tmp,
        encoding: "utf8",
        input: JSON.stringify({
          cwd: tmp,
          tool_name: tool,
          transcript_path: "/tmp/x/chat.jsonl",
          tool_input: {},
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      });
      return { status: r.status, nudged: /edits since your TASK-CORE/.test(r.stdout || "") };
    };

    assert.equal(fire("Edit").nudged, false);
    assert.equal(fire("Edit").nudged, false);
    assert.equal(fire("Edit").nudged, true, "no nudge at the edit threshold");
    assert.equal(fire("Edit").nudged, false, "nudged again immediately — the count did not reset");

    // Reads change nothing a compaction could lose, so they must not count toward it.
    for (let i = 0; i < 5; i++) {
      assert.equal(fire("Read").nudged, false, "a Read counted as unsaved work");
    }

    // Writing the core resets the count — via the file's own mtime, so there is no second counter
    // to fall out of sync with it.
    const core = path.join(tmp, ".bearing/task-cores/chat.md");
    fs.mkdirSync(path.dirname(core), { recursive: true });
    fs.writeFileSync(core, "# core\n");
    fire("Edit");
    assert.equal(fire("Edit").nudged, false, "the core was written but the count kept climbing");

    // Advisory only: it must never fail a tool call (NS-5/NS-8).
    assert.equal(fire("Edit").status, 0);

    // And it can be turned off.
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.local.json"),
      JSON.stringify({ taskCoreEveryEdits: 0 }),
    );
    for (let i = 0; i < 5; i++) {
      assert.equal(fire("Edit").nudged, false, "taskCoreEveryEdits: 0 must disable the nudge");
    }
  });

  it("a module that no active runtime supports is skipped, loudly (NS-14)", async () => {
    const { FEATURE_IDS: FEATURE_IDS_FOR_TEST } = await import(new URL("./features.mjs", import.meta.url).href);
    // `runtimes` on each module was documentation and nothing read it, so
    // `--runtime cursor --features minions` installed the skill AND wrote the fan-out trigger into
    // Cursor's always-on rule — telling a Cursor agent to spawn subagents on a chosen model tier,
    // which only Claude Code can do. Overstated parity, shipped by the installer itself. Cursor is
    // gone; zed is the same shape — minions declares ["claude"] — so the case stays covered.
    const mk = () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-rt-"));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"r"}\n');
      execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
      return tmp;
    };

    const zedOnly = mk();
    const m = installKit(zedOnly, {
      runtime: "zed",
      features: "minions,microscope",
      runSetup: false,
      skipVerify: true,
    });
    assert.ok(!m.features.includes("minions"), "an inert module stayed in the manifest");
    assert.ok(m.features.includes("microscope"), "a supported module was dropped with it");
    assert.ok(
      !fs.existsSync(path.join(zedOnly, ".bearing/skills/bearing-minions")),
      "the skill installed for a runtime that cannot use it",
    );
    const contract = fs.readFileSync(path.join(zedOnly, "AGENTS.md"), "utf8");
    assert.doesNotMatch(
      contract,
      /bearing-minions/,
      "the always-on contract told the agent to fan out",
    );

    // The negative that keeps this from over-firing: with Claude among the runtimes it must stay.
    const withClaude = mk();
    const m2 = installKit(withClaude, {
      runtime: "all",
      features: "all",
      runSetup: false,
      skipVerify: true,
    });
    assert.ok(m2.features.includes("minions"), "dropped a module one of the runtimes supports");
    assert.equal(m2.features.length, FEATURE_IDS_FOR_TEST.length, "some module was lost");

    // north-stars declares runtimes:["claude"] because only Claude RE-ANCHORS, yet its contract
    // ships everywhere. Using that field to filter contracts would delete it from three runtimes.
    const zed = mk();
    const m3 = installKit(zed, {
      runtime: "zed",
      features: "northstars",
      runSetup: false,
      skipVerify: true,
    });
    assert.ok(m3.features.includes("northstars"), "north-stars must survive on a non-claude runtime");
    assert.match(
      fs.readFileSync(path.join(zed, "AGENTS.md"), "utf8"),
      /north-star/i,
      "the north-stars contract vanished from AGENTS.md",
    );
    for (const t of [zedOnly, withClaude, zed]) fs.rmSync(t, { recursive: true, force: true });
  });

  it("consult ships its judgment and its one-way-door rule, or not at all (NS-13)", () => {
    // The module IS the judgment — there is no tool to install, since AskUserQuestion belongs to the
    // runtime. So the only thing that can be wrong is the trigger being absent when selected, or
    // present when declined, and the contract is where an agent actually meets it.
    const mk = (features) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-consult-"));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"c"}\n');
      execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
      installKit(tmp, { runtime: "claude", features, runSetup: false, skipVerify: true });
      return tmp;
    };

    const on = mk("northstars,consult");
    const contract = fs.readFileSync(path.join(on, "CLAUDE.md"), "utf8");
    assert.ok(fs.existsSync(path.join(on, ".bearing/skills/bearing-consult")), "skill did not install");
    // Both halves must reach the agent: consultation AND the separate confirmation rule. Blurring
    // them is the failure mode — one fires on ambiguity, the other on irreversibility.
    assert.match(contract, /bearing-consult/, "no trigger in the contract");
    assert.match(contract, /discoverable/i, "the ask-vs-decide test is missing");
    assert.match(contract, /CONFIRM, do not consult/, "the one-way-door rule is missing");
    assert.match(contract, /reversible/i, "the do-not-ask side is missing");

    // Declined: no skill, and not a word of it in the contract (NS-13).
    const off = mk("northstars,taskcore");
    assert.ok(!fs.existsSync(path.join(off, ".bearing/skills/bearing-consult")), "skill leaked");
    const bare = fs.readFileSync(path.join(off, "CLAUDE.md"), "utf8");
    assert.doesNotMatch(bare, /bearing-consult/, "trigger leaked into a repo that declined it");
    assert.doesNotMatch(bare, /CONFIRM, do not consult/, "one-way-door rule leaked");
    for (const t of [on, off]) fs.rmSync(t, { recursive: true, force: true });
  });

  it("no module exports a symbol nothing references (any file type)", () => {
    // The mirror of the unused-import check, and it caught the leftovers of a retired feature:
    // setCheckpointBand and lastCheckpointBand outlived the percentage checkpoints they served.
    //
    // COVERAGE IS THE WHOLE TRICK. The first version of this sweep read only .mjs and reported
    // `writePromptHint` as dead — it is called from bundle/.cursor/hooks/bearing-prompt-router.sh,
    // a SHELL hook that inlines JS. A checker that looks in fewer places than the code lives in
    // reports confident false positives, which is how a live function gets deleted.
    const exts = /\.(mjs|js|cjs|sh|json|md|mdc|ya?ml)$/;
    const all = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (exts.test(e.name)) all.push(p);
      }
    };
    const root = path.join(BUNDLE_ROOT, "..");
    for (const dir of ["lib", "scripts", "bundle", "docs"]) walk(path.join(root, dir));
    const src = new Map(all.map((f) => [f, fs.readFileSync(f, "utf8")]));

    const dead = [];
    for (const f of all.filter((f) => f.endsWith(".mjs") && !f.includes(".test."))) {
      for (const m of src.get(f).matchAll(/export (?:async )?function (\w+)|export const (\w+) =/g)) {
        const name = m[1] ?? m[2];
        const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
        let total = 0;
        for (const o of all) total += (src.get(o).match(re) ?? []).length;
        // 1 = the declaration itself. Anything more is a reference somewhere.
        if (total <= 1) dead.push(`${path.relative(root, f)}: ${name}`);
      }
    }
    assert.deepEqual(dead, [], `exported but referenced nowhere:\n  ${dead.join("\n  ")}`);
  });

  it("no module imports a symbol it never uses", () => {
    // `removeExclude` was written, exported, imported into kit.mjs — and never called, so a stealth
    // uninstall left its own concealment in place and `git status` lied about the repo being clean.
    // The import was the visible half of that bug and nothing was looking for it. An unused import
    // is usually harmless; the reason to fail on it is that it is the cheapest available signal
    // that a function which was meant to be called is not.
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".mjs") && !e.name.includes(".test.")) files.push(p);
      }
    };
    const root = path.join(BUNDLE_ROOT, "..");
    for (const dir of ["lib", "scripts", "bundle/.bearing/lib", "bundle/.claude/hooks"]) {
      walk(path.join(root, dir));
    }

    const dead = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
        for (const raw of m[1].split(",")) {
          const name = raw.trim().split(/\s+as\s+/).pop().trim();
          if (!name) continue;
          // A mention ANYWHERE outside the import counts as used — including inside a comment or a
          // JSDoc type. Deliberately generous: a false alarm here would be noise on every run, and
          // noise is how a check stops being read (NS-5). The bug this exists for had zero mentions.
          const body = src.replace(m[0], "");
          const used = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body);
          if (!used) dead.push(`${path.relative(root, f)} imports ${name}`);
        }
      }
    }
    assert.deepEqual(dead, [], `imported but never used:\n  ${dead.join("\n  ")}`);
  });

  it("a STEALTH uninstall leaves nothing registered, and takes its concealment with it (NS-1)", () => {
    // The existing leftover tests all install VISIBLY, so none of them could see this: stealth
    // writes hooks to .claude/settings.local.json and mergeClaudeSettings knew that, while
    // removeClaudeSettings hardcoded settings.json. Eleven guards stayed registered against
    // scripts the same uninstall deleted — a failed spawn on every session start, prompt and tool
    // call. Worse, the .git/info/exclude block also survived, so `git status` came back CLEAN and
    // the user concluded bearing was gone while it was still wired in.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealth-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"s"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    const before = fs.readdirSync(tmp).sort();

    const manifest = installKit(tmp, {
      runtime: "claude",
      features: "all",
      stealth: true,
      runSetup: false,
      skipVerify: true,
    });
    // A file we create must be recorded at the moment we create it, or uninstall cannot take it
    // back (NS-22). 21KB of generated contract survived every stealth uninstall for want of this.
    assert.ok(
      manifest.files.includes(".bearing/contract.md"),
      "the stealth contract is written but not recorded, so uninstall cannot remove it",
    );

    uninstallKit(tmp);

    assert.deepEqual(
      fs.readdirSync(tmp).sort(),
      before,
      `stealth uninstall left artifacts: ${fs.readdirSync(tmp).sort().join(", ")}`,
    );
    const local = path.join(tmp, ".claude/settings.local.json");
    if (fs.existsSync(local)) {
      const hooks = JSON.stringify(JSON.parse(fs.readFileSync(local, "utf8")).hooks ?? {});
      assert.doesNotMatch(hooks, /bearing-/, "hooks stayed registered against deleted scripts");
    }
    const exclude = path.join(tmp, ".git/info/exclude");
    if (fs.existsSync(exclude)) {
      assert.doesNotMatch(
        fs.readFileSync(exclude, "utf8"),
        /bearing/,
        "the concealment survived — leftovers stay invisible and `git status` lies",
      );
    }
  });

  it("a stealth uninstall keeps the user's own hooks and exclude lines (NS-12)", () => {
    // Cleaning both settings files and stripping the exclude block are removals in someone else's
    // repository (NS-1). The negative control is the half that proves they are surgical.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealth-keep-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"s"}\n');
    fs.writeFileSync(path.join(tmp, ".git/info/exclude"), "# my own\nscratch/\n");
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".claude/settings.local.json"),
      JSON.stringify({
        permissions: { allow: ["Bash"] },
        hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo MINE" }] }] },
      }),
    );
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    installKit(tmp, { runtime: "claude", features: "all", stealth: true, runSetup: false, skipVerify: true });
    uninstallKit(tmp);

    const kept = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.local.json"), "utf8"));
    assert.ok(JSON.stringify(kept.hooks ?? {}).includes("echo MINE"), "removed the user's own hook");
    assert.ok(kept.permissions?.allow?.includes("Bash"), "removed the user's own permissions");
    const exclude = fs.readFileSync(path.join(tmp, ".git/info/exclude"), "utf8");
    assert.match(exclude, /scratch\//, "removed the user's own exclude entry");
    assert.match(exclude, /# my own/, "removed the user's own comment");
  });

  it("uninstall leaves no shell behind on a full install, and never restores its OWN config (NS-1)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-shell-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    const before = fs.readdirSync(tmp).sort();

    const opts = { runtime: "all", features: "all", runSetup: false, skipVerify: true };
    installKit(tmp, opts);
    // The UPDATE is the trigger: by the second pass .cursor/hooks.json exists because WE wrote it,
    // so the backup step captured our own file and uninstall dutifully restored it — leaving Cursor
    // registering hooks whose scripts the same uninstall had just deleted.
    updateKit(tmp, { runSetup: false, skipVerify: true });

    // A backup exists to preserve a file of the USER'S, and this repo had none — so any .bak here
    // is one we took of our own artifact, which is the mechanism behind the resurrection above.
    // Assert it before uninstall consumes the evidence.
    const baks = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === ".git") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".bak")) baks.push(path.relative(tmp, p));
      }
    };
    walk(tmp);
    assert.deepEqual(baks, [], `update backed up our own files: ${baks.join(", ")}`);

    uninstallKit(tmp);

    assert.deepEqual(
      fs.readdirSync(tmp).sort(),
      before,
      `uninstall left artifacts behind: ${fs.readdirSync(tmp).sort().join(", ")}`,
    );
    for (const rel of [".cursor/hooks.json", ".cursor/mcp.json", ".zed/settings.json"]) {
      assert.ok(!fs.existsSync(path.join(tmp, rel)), `${rel} survived uninstall`);
    }
  });

  it("uninstall takes back the engines floor it added, and leaves the user's alone (NS-1)", () => {
    const opts = { runtime: "claude", features: "all", runSetup: false, skipVerify: true };
    const mk = (pkg) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-eng-"));
      execSync("git init -q", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg) + "\n");
      return tmp;
    };
    const engines = (t) =>
      JSON.parse(fs.readFileSync(path.join(t, "package.json"), "utf8")).engines;

    // Ours: added at install, gone at uninstall. Left behind, it fails their build on Node 20 —
    // npm under engine-strict, Yarn always, CI — for a tool they removed.
    const a = mk({ name: "a" });
    installKit(a, opts);
    assert.equal(engines(a)?.node, ">=22.9.0", "install should declare the floor its scripts need");
    // The reinstall is the trap: by now the field exists BECAUSE WE ADDED IT, so re-deriving
    // ownership reads it as the user's and strands it forever.
    installKit(a, opts);
    assert.equal(readManifest(a)?.data.addedEngines, true, "reinstall disowned our own field");
    uninstallKit(a);
    assert.equal(engines(a)?.node, undefined, "uninstall left its Node floor in their manifest");

    // Theirs: untouched in both directions.
    const b = mk({ name: "b", engines: { node: ">=20.0.0" } });
    installKit(b, opts);
    assert.equal(engines(b)?.node, ">=20.0.0", "install overwrote the user's own floor");
    uninstallKit(b);
    assert.equal(engines(b)?.node, ">=20.0.0", "uninstall deleted a floor the user set");
  });

  it("a user's own cursor + zed config survives install/update/uninstall (NS-1, NS-12)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-theirs-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    const write = (rel, obj) => {
      fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), JSON.stringify(obj) + "\n");
    };
    write(".cursor/hooks.json", { version: 1, hooks: { sessionStart: [{ command: "THEIRS" }] } });
    // Their OWN gitnexus server: the cleanup that strips ours must not take theirs with it.
    write(".cursor/mcp.json", {
      mcpServers: { theirs: { command: "x" }, gitnexus: { command: "THEIR-OWN-GITNEXUS" } },
    });
    write(".zed/settings.json", { theme: "One Dark" });

    installKit(tmp, { runtime: "all", features: "all", runSetup: false, skipVerify: true });
    updateKit(tmp, { runSetup: false, skipVerify: true });
    uninstallKit(tmp);

    const read = (rel) => JSON.parse(fs.readFileSync(path.join(tmp, rel), "utf8"));
    assert.equal(read(".cursor/hooks.json").hooks.sessionStart[0].command, "THEIRS");
    assert.equal(read(".cursor/mcp.json").mcpServers.theirs.command, "x");
    assert.equal(
      read(".cursor/mcp.json").mcpServers.gitnexus?.command,
      "THEIR-OWN-GITNEXUS",
      "stripping our MCP entry also removed the user's own gitnexus server",
    );
    assert.equal(read(".zed/settings.json").theme, "One Dark");
  });

  it("post-install checks pass on a good install, and each one can fail", async () => {
    // The point of these checks is that they CATCH things, so a test that only proves them green
    // proves nothing (NS-9/NS-12). Every case below breaks exactly one post-condition — each drawn
    // from a defect that actually shipped — and asserts the matching check goes red.
    const { runPostChecks } = await import(new URL("./postcheck.mjs", import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-post-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    const manifest = installKit(tmp, {
      runtime: "claude",
      features: "all",
      gitnexusCmd: "gitnexus",
      runSetup: false,
      skipVerify: true,
    });
    const ctx = {
      features: new Set(manifest.features),
      mcpTransport: manifest.mcpTransport,
      gitnexusCmd: manifest.gitnexusCmd,
    };
    const run = () => runPostChecks(tmp, ctx);
    const red = (id) => run().find((f) => f.id === id && !f.ok);

    const clean = run().filter((f) => !f.ok);
    assert.deepEqual(clean, [], `fresh install should be clean, got: ${clean.map((f) => f.id).join(", ")}`);

    // 1. a script reverted to the published analyzer (the setup-step regression)
    const pkgPath = path.join(tmp, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const orig = pkg.scripts["bearing:refresh"];
    pkg.scripts["bearing:refresh"] = "npx gitnexus@latest analyze";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    assert.ok(red("scripts_binary"), "a reverted npm script went unnoticed");
    pkg.scripts["bearing:refresh"] = orig;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    // 2. an MCP entry overwritten with a hardcoded npx spawn (setup / Zed adapter)
    const mcpPath = path.join(tmp, ".mcp.json");
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    const origEntry = mcp.mcpServers.gitnexus;
    mcp.mcpServers.gitnexus = { command: "npx", args: ["-y", "gitnexus@latest", "mcp"] };
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));
    assert.ok(
      red("mcp_entries"),
      "an MCP entry naming a different binary than the manifest went unnoticed",
    );
    mcp.mcpServers.gitnexus = origEntry;
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));

    // 3. machine-local state became committable (the three ignore gaps)
    const gi = path.join(tmp, ".gitignore");
    const giOrig = fs.readFileSync(gi, "utf8");
    fs.writeFileSync(gi, giOrig.replace("*.bearing-backup\n", ""));
    assert.ok(red("local_state_ignored"), "install backups would have been committed, silently");
    fs.writeFileSync(gi, giOrig);

    // 4. a second managed block, the failure a marker rename causes
    const agents = path.join(tmp, "CLAUDE.md");
    const aOrig = fs.readFileSync(agents, "utf8");
    fs.writeFileSync(agents, aOrig + "\n<!-- gitnexus-agent-kit:BEGIN -->\nold\n<!-- gitnexus-agent-kit:END -->\n");
    assert.ok(red("agent_docs"), "a duplicated contract block went unnoticed");
    fs.writeFileSync(agents, aOrig);

    // 5. a legacy manifest left beside the current one — two that can disagree
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".gitnexus/agent-kit-manifest.json"), "{}");
    assert.ok(red("no_legacy"), "a second, stale manifest went unnoticed");
    fs.rmSync(path.join(tmp, ".gitnexus"), { recursive: true, force: true });

    // 6. an installed file pointing at a script that does not exist. This is the one a REVIEWER
    //    caught, not us: the CI workflow ran `node scripts/gitnexus-ci.mjs` while the bundle
    //    installs `bearing-ci.mjs`, so the merge gate died with "Cannot find module" on every PR.
    //    Every file was individually present and correct — only the reference between two was
    //    wrong, which files_present is structurally unable to see.
    // Pick a workflow that actually invokes a script — there is more than one now, and the
    // index-cache one shells out to npx rather than `node scripts/…`, so breaking it proves nothing.
    const wf = manifest.files.find(
      (f) =>
        /^\.github\/workflows\/.*\.ya?ml$/.test(f) &&
        /node scripts\/[\w.-]+\.mjs/.test(fs.readFileSync(path.join(tmp, f), "utf8")),
    );
    if (wf) {
      const wfAbs = path.join(tmp, wf);
      const wfOrig = fs.readFileSync(wfAbs, "utf8");
      fs.writeFileSync(wfAbs, wfOrig.replace(/node scripts\/[\w.-]+\.mjs/, "node scripts/does-not-exist.mjs"));
      assert.ok(red("no_dangling_refs"), "a workflow calling a missing script went unnoticed");
      fs.writeFileSync(wfAbs, wfOrig);
    }
    const hook = manifest.files.find((f) => f === ".githooks/pre-commit");
    if (hook) {
      const hAbs = path.join(tmp, hook);
      const hOrig = fs.readFileSync(hAbs, "utf8");
      fs.writeFileSync(hAbs, hOrig.replace(/npm run [\w:-]+/, "npm run bearing:no-such-script"));
      assert.ok(red("no_dangling_refs"), "a git hook calling an undefined npm script went unnoticed");
      fs.writeFileSync(hAbs, hOrig);
    }

    // 7. an UNSUBSTITUTED placeholder. Both of them: the check originally looked only for
    //    __BEARING_PERSONA__, so it could not have caught the very bug it was written for —
    //    __GITNEXUS_REPO__ shipped verbatim in the Cursor rule for an unknown number of releases.
    //    Each placeholder is asserted in each doc, because covering the FILE is not the same as
    //    covering the TOKEN.
    for (const doc of ["CLAUDE.md", "AGENTS.md"]) {
      const abs = path.join(tmp, doc);
      if (!fs.existsSync(abs)) continue;
      const before = fs.readFileSync(abs, "utf8");
      for (const ph of ["__BEARING_PERSONA__", "__GITNEXUS_REPO__"]) {
        fs.writeFileSync(abs, `${before}\nrepo: ${ph}\n`);
        assert.ok(red("persona"), `${ph} left in ${doc} went unnoticed`);
        fs.writeFileSync(abs, before);
      }
    }

    // 8. a file the manifest claims is simply gone
    const victim = manifest.files.find((f) => f.startsWith(".bearing/lib/"));
    const victimAbs = path.join(tmp, victim);
    const body = fs.readFileSync(victimAbs);
    fs.unlinkSync(victimAbs);
    assert.ok(red("files_present"), "a missing installed file went unnoticed");
    fs.writeFileSync(victimAbs, body);

    // back to clean — proves each restore above was complete, not just the assertion passing
    assert.deepEqual(run().filter((f) => !f.ok), [], "checks did not return to green");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("an intel-only install is checked too, and a declined module leaves no trace", async () => {
    // scripts/bearing-verify.mjs is owned by the gitnexus feature and the fallback lib is too, so
    // the intel-only configuration — the one least exercised by the author — had NO verification
    // at all. These checks live in lib/ precisely so they run regardless of feature selection.
    const { runPostChecks } = await import(new URL("./postcheck.mjs", import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-postintel-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    const manifest = installKit(tmp, {
      runtime: "claude",
      features: "northstars,taskcore",
      runSetup: false,
      skipVerify: true,
    });
    const ctx = { features: new Set(manifest.features), mcpTransport: manifest.mcpTransport };
    assert.deepEqual(
      runPostChecks(tmp, ctx).filter((f) => !f.ok),
      [],
      "intel-only install failed its own post-conditions",
    );

    // The NS-13 leak that started all of this: creating the graph tool's directory in a repo that
    // declined the graph module.
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    const f = runPostChecks(tmp, ctx).find((x) => x.id === "declined_clean");
    assert.ok(f && !f.ok, "a gitnexus artifact in a repo that declined gitnexus went unnoticed");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("domain inference adopts a specialism only when the repo warrants it", async () => {
    const { inferDomain, NEUTRAL_PERSONA } = await import(
      new URL("./domain.mjs", import.meta.url).href
    );
    const mk = (pkg, readme) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "gn-dom-"));
      fs.writeFileSync(path.join(d, "package.json"), JSON.stringify(pkg));
      fs.writeFileSync(path.join(d, "README.md"), readme);
      return d;
    };

    // Declared in the package's own metadata → adopt it.
    let d = mk({ name: "ledger-core", description: "Double-entry ledger and settlement" }, "# x");
    assert.equal(inferDomain(d).domain, "payments");
    fs.rmSync(d, { recursive: true, force: true });

    // An unambiguous term in the README, corroborated → adopt it.
    d = mk({ name: "portal", description: "Patient onboarding" }, "# p\nClinical HIPAA PHI handling.");
    assert.equal(inferDomain(d).domain, "healthcare");
    fs.rmSync(d, { recursive: true, force: true });

    // THE REGRESSION that made this necessary: a doc that merely DISCUSSES a domain must not brand
    // the repo. bearing's own README explains the feature with a trading example, and equal
    // weighting classified bearing itself as a trading repo — which would have written
    // "quantitative trader" into its own contract.
    d = mk({ name: "docs-site", description: "Marketing site" }, "# s\nWe explain trading and portfolio examples.");
    let r = inferDomain(d);
    assert.equal(r.domain, null, `prose mention branded the repo as ${r.domain}`);
    assert.equal(r.persona, NEUTRAL_PERSONA);
    fs.rmSync(d, { recursive: true, force: true });

    // A lone strong term in prose: surfaced as a SUGGESTION, never adopted. A wrong specialism
    // skews every downstream judgement; "senior engineer" skews nothing.
    d = mk({ name: "blog", description: "My blog" }, "# b\nI once wrote about double-entry bookkeeping.");
    r = inferDomain(d);
    assert.equal(r.domain, null);
    assert.equal(r.persona, NEUTRAL_PERSONA);
    assert.equal(r.suggested, "payments", "a near-miss should still be offered to the user");
    fs.rmSync(d, { recursive: true, force: true });

    // bearing itself, for real.
    assert.equal(
      inferDomain(path.resolve(new URL(".", import.meta.url).pathname, "..")).domain,
      "developer-tooling",
    );

    // SELF-CONTAMINATION. bearing injects a contract into CLAUDE.md that talks about MCP servers,
    // code graphs, impact analysis and linters — all developer-tooling vocabulary. Reading that
    // back as evidence about the REPO is a tool treating its own output as the world's input.
    // Observed on a real health platform with no package description: the sole signal was
    // `CLAUDE.md: "mcp"`, from our own block, and it suggested "developer-tooling".
    const { AGENTS_MARKER_BEGIN: B, AGENTS_MARKER_END: E } = await import(
      new URL("./constants.mjs", import.meta.url).href
    );
    d = mk({ name: "enter-front-end" }, "# Enter Front end\n\nMain repository for all front end projects.\n");
    fs.writeFileSync(
      path.join(d, "CLAUDE.md"),
      `${B}\nUse the mcp server, the code graph, impact analysis and the linter.\n${E}\n`,
    );
    r = inferDomain(d);
    assert.equal(r.domain, null, "our own contract branded the repo");
    assert.equal(r.suggested, null, `suggested "${r.suggested}" from bearing's own prose`);

    // GitNexus writes its OWN stats block into CLAUDE.md, outside our markers: "indexed by
    // GitNexus … use the GitNexus MCP tools to …". Stripping only ours still left that, and it
    // alone suggested "developer-tooling" for a healthcare claims platform.
    fs.writeFileSync(
      path.join(d, "CLAUDE.md"),
      "<!-- gitnexus:start -->\n# GitNexus — Code Intelligence\nUse the GitNexus MCP tools to assess impact.\n<!-- gitnexus:end -->\n",
    );
    r = inferDomain(d);
    assert.equal(r.domain, null, "the analyzer's own stats block branded the repo");
    assert.equal(r.suggested, null, `suggested "${r.suggested}" from GitNexus's own prose`);

    // Negative control: the same vocabulary OUTSIDE any tool block is legitimate evidence again.
    fs.appendFileSync(path.join(d, "CLAUDE.md"), "\nThis project ships an mcp server and a linter.\n");
    assert.equal(inferDomain(d).suggested ?? inferDomain(d).domain, "developer-tooling");
    fs.rmSync(d, { recursive: true, force: true });

    // A repo that names its own domain must win. `\bhealth\b` does not match "Healthcare" — the
    // boundary fails on the trailing "care" — so a package described as a "Healthcare …
    // Application" scored zero for healthcare and lost to a passing mention of something else.
    d = mk({ name: "ctrl", description: "Healthcare Screen Capture and Voice Recording Application" }, "# c\nUses an mcp server.");
    assert.equal(inferDomain(d).domain, "healthcare", "the repo's own description lost");
    fs.rmSync(d, { recursive: true, force: true });

    // Dependencies are implementation, not identity: almost every web app has a JWT library.
    //
    // The description here deliberately carries only WEAK domain signal ("clinics"). An earlier
    // version of this test said "Healthcare Screen Capture", which is a STRONG signal that wins
    // either way — so it passed with dependencies counted or not, and proved nothing. Third
    // vacuous assertion of this kind in this file; NS-9 keeps being right.
    d = mk(
      {
        name: "capture",
        description: "Screen capture and voice recording for clinics",
        dependencies: { jsonwebtoken: "^9", jwt: "^1", oidc: "^2" },
      },
      "# c\nDesktop capture tool.",
    );
    r = inferDomain(d);
    assert.notEqual(r.domain, "identity", "a JWT dependency branded the repo as an identity product");
    fs.rmSync(d, { recursive: true, force: true });
  });

  it("the persona is persisted, injected into the contract, and never overwritten", async () => {
    const { DOMAIN_PATH } = await import(new URL("./domain.mjs", import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-persona-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "pay", description: "Double-entry ledger and chargeback handling" }),
    );
    installKit(tmp, {
      runtime: "claude",
      features: "northstars,taskcore,microscope",
      runSetup: false,
      skipVerify: true,
    });

    const pinned = JSON.parse(fs.readFileSync(path.join(tmp, DOMAIN_PATH), "utf8"));
    assert.equal(pinned.domain, "payments");
    // It must reach the ALWAYS-ON contract, not just a skill — that reach is the whole point.
    const claude = fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8");
    assert.match(claude, /You are working as \*\*staff payments and ledger engineer\*\*/);
    assert.ok(!claude.includes("__BEARING_PERSONA__"), "template placeholder leaked into CLAUDE.md");

    // NS-1: the user's correction survives an update. Silently reverting it would be the same
    // class of bug as overwriting their hooks.json.
    fs.writeFileSync(
      path.join(tmp, DOMAIN_PATH),
      JSON.stringify({ domain: "aerospace", persona: "flight-software engineer" }),
    );
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(tmp, DOMAIN_PATH), "utf8")).persona,
      "flight-software engineer",
      "update overwrote the user's pinned persona",
    );
    assert.match(
      fs.readFileSync(path.join(tmp, "CLAUDE.md"), "utf8"),
      /You are working as \*\*flight-software engineer\*\*/,
      "the contract did not follow the user's correction",
    );
    fs.rmSync(tmp, { recursive: true, force: true });

    // EVERY runtime must agree. Two bugs lived here: the Cursor rule was written by a hand-rolled
    // function that bypassed substitution entirely (it had been shipping three literal
    // __GITNEXUS_REPO__ placeholders) — that surface is gone with Cursor — and codex shares zed's
    // AGENTS.md writer but did not forward
    // the persona — so under `--runtime all` codex ran last and overwrote zed's correct block with
    // the neutral fallback. A per-runtime disagreement means an agent's expertise depends on which
    // editor it happens to be running in.
    const multi = fs.mkdtempSync(path.join(os.tmpdir(), "gn-persona-all-"));
    execSync("git init -q", { cwd: multi });
    fs.writeFileSync(
      path.join(multi, "package.json"),
      JSON.stringify({ name: "qd", description: "Backtest engine with slippage and order-book replay" }),
    );
    installKit(multi, { runtime: "all", features: "all", runSetup: false, skipVerify: true });
    const personas = ["CLAUDE.md", "AGENTS.md"].map(
      (f) => (fs.readFileSync(path.join(multi, f), "utf8").match(/You are working as \*\*(.+?)\*\*/) ?? [])[1],
    );
    assert.equal(new Set(personas).size, 1, `runtimes disagree on the persona: ${personas.join(" | ")}`);
    assert.match(personas[0], /quantitative trader/);
    for (const f of ["CLAUDE.md", "AGENTS.md"]) {
      const body = fs.readFileSync(path.join(multi, f), "utf8");
      assert.ok(!/__GITNEXUS_REPO__|__BEARING_PERSONA__/.test(body), `template syntax leaked into ${f}`);
    }
    fs.rmSync(multi, { recursive: true, force: true });
  });

  it("an intel-only install ships no skill instruction it cannot follow (NS-13)", () => {
    // The session banner already had this discipline and a test to prove it; the SKILLS never did.
    // bearing-microscope declares needsGitnexus:false, yet its routine had 13 GitNexus references
    // and no fallback — so an intel-only install told the agent to run `impact`, READ clusters, and
    // `npm run bearing:agent-refresh`, none of which exist there. Advice the user cannot follow is
    // worse than silence (NS-5).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-skillleak-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    installKit(tmp, {
      runtime: "claude",
      features: "northstars,taskcore,microscope",
      runSetup: false,
      skipVerify: true,
    });

    const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8")).scripts ?? {});
    const store = path.join(tmp, ".bearing/skills");
    const offenders = [];
    for (const name of fs.readdirSync(store)) {
      const p = path.join(store, name, "SKILL.md");
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, "utf8").split("\n")) {
        // An npm script named in a shipped skill must exist in this repo.
        for (const m of line.matchAll(/npm run ([\w.:-]+)/g)) {
          if (!scripts.includes(m[1])) offenders.push(`${name}: \`npm run ${m[1]}\` (not installed)`);
        }
      }
    }
    assert.deepEqual(offenders, [], `skills reference commands this install does not have:\n${offenders.join("\n")}`);

    // ...and the graph steps must be presented as conditional, not as the only way.
    const micro = fs.readFileSync(path.join(store, "bearing-microscope/SKILL.md"), "utf8");
    assert.match(micro, /classical:/, "microscope offers no non-graph path");
    assert.match(micro, /does not require GitNexus/i, "microscope does not say it works without the graph");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the CI report is informational and cannot fail a build by default", async () => {
    // Deliberate product decision, so it gets a test: the graph cannot distinguish "no callers"
    // from "could not resolve callers", and a hard gate built on that signal fails honest PRs
    // until people route around it. If someone flips the default back to blocking, this fails.
    const ci = fs.readFileSync(path.join(BUNDLE_ROOT, "scripts/bearing-ci.mjs"), "utf8");
    assert.match(
      ci,
      /GITNEXUS_CI_MODE\s*\|\|\s*['"]report['"]/,
      "the default CI mode is no longer report-only",
    );
    const wf = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".github/workflows/gitnexus-ci.yml"),
      "utf8",
    );
    assert.match(wf, /GITNEXUS_CI_MODE:\s*report/, "the shipped workflow does not run in report mode");
    // It has to be able to write the comment, or the whole report lands only in a log nobody opens.
    assert.match(wf, /pull-requests:\s*write/, "workflow cannot post its report");
    assert.match(wf, /contents:\s*read/, "workflow should not have write access to code");

    // A repo with nothing to report must exit 0 rather than erroring on a missing index.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-ci-"));
    execSync("git init -q", { cwd: tmp });
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    fs.copyFileSync(path.join(BUNDLE_ROOT, "scripts/bearing-ci.mjs"), path.join(tmp, "scripts/bearing-ci.mjs"));
    // This asserts the missing-INDEX path, so the fixture has to be an INSTALLED repo that simply
    // has not been analysed yet. Copying the one script into a bare directory also simulated a
    // missing install, which bearing-ci now refuses with a diagnosis rather than a stack trace —
    // correctly, since `scripts/bearing-ci.mjs` only exists because bearing put it there.
    fs.cpSync(path.join(BUNDLE_ROOT, "scripts/lib"), path.join(tmp, "scripts/lib"), {
      recursive: true,
    });
    fs.cpSync(path.join(BUNDLE_ROOT, ".bearing/lib"), path.join(tmp, ".bearing/lib"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".bearing/lib/gitnexus-cmd.mjs"),
      path.join(tmp, ".bearing/lib/gitnexus-cmd.mjs"),
    );
    fs.writeFileSync(path.join(tmp, "a.txt"), "x");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    const r = spawnSync(process.execPath, ["scripts/bearing-ci.mjs", "HEAD"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, GITNEXUS_CI_SKIP_BUILD: "1" },
      timeout: 60000,
    });
    assert.equal(r.status, 0, `report exited ${r.status}: ${r.stderr}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("an unresolved domain is raised in the contract, not just at install", () => {
    // A missing persona is the one gap the installer cannot close alone — it needs a human who
    // knows what the project is. A single warn line at install is read once and forgotten, so the
    // ask lives in the always-on contract where the agent meets it every session.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-nodomain-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"mystery"}\n');
    fs.writeFileSync(path.join(tmp, "README.md"), "# mystery\n\nInternal tool.\n");
    installKit(tmp, { runtime: "all", features: "all", runSetup: false, skipVerify: true });

    for (const f of ["CLAUDE.md", "AGENTS.md"]) {
      const body = fs.readFileSync(path.join(tmp, f), "utf8");
      assert.match(body, /No domain is pinned for this project/, `${f} does not raise it`);
      assert.match(body, /offer to write it to/, `${f} asks but proposes no action`);
      assert.ok(!body.includes("__BEARING_PERSONA_NOTE__"), `placeholder leaked into ${f}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });

    // NEGATIVE CONTROL (NS-12): a repo whose domain IS resolved must not be nagged. Without this
    // the assertions above would pass against a note that is simply always present.
    const ok2 = fs.mkdtempSync(path.join(os.tmpdir(), "gn-domain-"));
    execSync("git init -q", { cwd: ok2 });
    fs.writeFileSync(
      path.join(ok2, "package.json"),
      '{"name":"led","description":"Double-entry ledger and settlement"}\n',
    );
    installKit(ok2, { runtime: "all", features: "all", runSetup: false, skipVerify: true });
    for (const f of ["CLAUDE.md", "AGENTS.md"]) {
      const body = fs.readFileSync(path.join(ok2, f), "utf8");
      assert.ok(!/No domain is pinned/.test(body), `${f} nags a repo that has a domain`);
      assert.match(body, /staff payments and ledger engineer/, `${f} lost the resolved persona`);
    }
    fs.rmSync(ok2, { recursive: true, force: true });
  });

  it("a stealth install is invisible to git and still functional", async () => {
    const { STEALTH_CONTRACT_PATH } = await import(new URL("./stealth.mjs", import.meta.url).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealth-"));
    execSync("git init -q", { cwd: tmp });
    // A realistic contributor's repo: every file bearing normally merges into already exists and
    // is TRACKED. Each one is a leak if stealth touches it.
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"app","scripts":{"build":"tsc"}}\n');
    fs.writeFileSync(path.join(tmp, "CLAUDE.md"), "# App\n\nHouse rules.\n");
    fs.writeFileSync(path.join(tmp, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(path.join(tmp, ".mcp.json"), '{"mcpServers":{"figma":{"command":"npx"}}}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    const before = execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" });

    installKit(tmp, {
      runtime: "claude",
      features: "all",
      stealth: true,
      runSetup: false,
      skipVerify: true,
    });

    // THE PROMISE: git must be exactly as clean as before. This is the whole mode.
    const after = execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" });
    assert.equal(after, before, `git can see the install:\n${after}`);
    for (const f of [".gitignore", "package.json", "CLAUDE.md", ".mcp.json"]) {
      assert.equal(
        execSync(`git diff --stat -- ${f}`, { cwd: tmp, encoding: "utf8" }).trim(),
        "",
        `${f} was modified — that edit is the leak stealth exists to avoid`,
      );
    }

    // ...and it still has to WORK, or invisibility is worthless.
    const local = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.local.json"), "utf8"));
    assert.ok(
      Object.values(local.hooks).flat().length > 0,
      "no hooks registered in the per-user settings file",
    );
    assert.ok(
      !fs.existsSync(path.join(tmp, ".claude/settings.json")),
      "stealth wrote the SHARED settings file",
    );
    // The contract cannot live in tracked CLAUDE.md, so it lives here and the SessionStart hook
    // injects it. If this is missing the agent is anchored to nothing.
    const contract = fs.readFileSync(path.join(tmp, STEALTH_CONTRACT_PATH), "utf8");
    assert.match(contract, /You are working as \*\*/, "contract carries no persona");
    assert.ok(contract.length > 2000, "contract looks truncated");
    // No npm scripts: package.json is tracked.
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(pkg.scripts), ["build"], "stealth added npm scripts");
    // .githooks/pre-commit calls those absent scripts, so it must not be installed.
    assert.ok(!fs.existsSync(path.join(tmp, ".githooks")), "stealth installed a hook that would fail every commit");
    // The exclude rules live where they cannot travel.
    const excl = fs.readFileSync(path.join(tmp, ".git/info/exclude"), "utf8");
    assert.match(excl, /bearing — stealth install/);
    assert.equal(
      fs.readFileSync(path.join(tmp, ".gitignore"), "utf8"),
      "node_modules/\n",
      "stealth wrote ignore rules into the SHARED .gitignore",
    );

    // An update must not silently un-hide it.
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.equal(
      execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" }),
      before,
      "an update leaked the install",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("stealth hides the files it CREATES, not only the ones it avoids", () => {
    // The gap this closes was found on a real repo, not here: the fixture above happens to have a
    // TRACKED .mcp.json, so the adapter skips it and the create-path never ran. In a repo with no
    // .mcp.json the adapter writes one — correctly, since a new file is untracked — and it sat
    // visible in `git status` because it was missing from the exclude list. Avoiding tracked files
    // is only half of invisibility; everything bearing creates has to be hidden too.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealthnew-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"app"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    assert.ok(!fs.existsSync(path.join(tmp, ".mcp.json")), "fixture must NOT have an .mcp.json");

    installKit(tmp, {
      runtime: "claude",
      features: "all",
      stealth: true,
      runSetup: false,
      skipVerify: true,
    });

    assert.ok(fs.existsSync(path.join(tmp, ".mcp.json")), "adapter should create one when absent");
    assert.equal(
      execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" }).trim(),
      "",
      "a file bearing created is visible to git",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a flag is never taken as the target repo", () => {
    // `bearing install --stealth` died with `Not a git repository: /cwd/--stealth` — a path the user
    // never typed. The second positional was taken as the target no matter what it looked like.
    for (const flag of ["--stealth", "--interactive", "--runtime", "-q"]) {
      const { target, rest } = parseCliArgs(["install", flag]);
      assert.equal(target, undefined, `${flag} was taken as a path`);
      assert.deepEqual(rest, [flag], `${flag} was swallowed instead of parsed`);
    }
    // The quieter half of the same bug: the eaten flag vanished from the list the parser searches,
    // so the VALUE was lost too and the install silently fell back to the default runtime.
    const { rest } = parseCliArgs(["install", "--runtime", "claude"]);
    assert.equal(rest[rest.indexOf("--runtime") + 1], "claude", "runtime value lost");
    // A real path still works, and still keeps its flags.
    const real = parseCliArgs(["install", "/tmp/repo", "--stealth"]);
    assert.equal(real.target, "/tmp/repo");
    assert.deepEqual(real.rest, ["--stealth"]);
  });

  it("every bare invocation the docs promise actually resolves", () => {
    // The README and changelog both print `npx bearing --stealth`. It answered "Missing target repo
    // path" — a leading `-` suppressed the implied `install` verb, so the flagship invocation of the
    // release was one the docs promised and the binary rejected (NS-20: a printed line is a claim).
    const bin = path.join(BUNDLE_ROOT, "..", "bin", "cli.mjs");
    const run = (args) =>
      spawnSync(process.execPath, [bin, ...args], {
        encoding: "utf8",
        input: "",
        timeout: 20000,
        cwd: os.tmpdir(),
      });

    const version = run(["--version"]);
    assert.equal(version.status, 0, "--version exited non-zero");
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/, `--version printed: ${version.stdout}`);

    assert.match(run(["--help"]).stdout, /Usage:/, "--help lost its usage text");

    // Routed to the wizard, which refuses a non-TTY — that refusal IS the proof it got there,
    // rather than being turned away at the argument parser.
    const stealth = run(["--stealth"]);
    const said = stealth.stdout + stealth.stderr;
    assert.doesNotMatch(said, /Missing target repo path/, "`bearing --stealth` never reached install");
    assert.match(said, /interactive install|requires a TTY/i, `got: ${said.slice(0, 200)}`);
  });

  it("the wizard can reach stealth — the flag survives the handoff", () => {
    // `npx bearing --stealth` with no path routes to the interactive wizard, which was spawned with
    // NO argv: the flag was dropped and the user got a normal committed install into the very repo
    // they had chosen because they must not commit to it.
    const src = fs.readFileSync(new URL("./kit.mjs", import.meta.url), "utf8");
    const spawn = src.slice(src.indexOf("interactive.mjs"));
    assert.match(
      spawn.slice(0, 200),
      /\.\.\.rest/,
      "interactive.mjs is spawned without forwarding flags",
    );
    // Scoped deliberately: a bare /stealth/ over the whole file would be satisfied by a comment.
    const wiz = fs.readFileSync(new URL("./interactive.mjs", import.meta.url), "utf8");
    assert.match(wiz, /flags\.has\(['"]--stealth['"]\)/, "the wizard ignores the --stealth flag");
    const call = wiz.slice(wiz.indexOf("installKit("));
    assert.match(call.slice(0, 300), /^\s*stealth,$/m, "stealth never reaches installKit");
  });

  it("stealth survives what the ANALYZER writes, not just what bearing writes", async () => {
    // Found on a real stealth install the moment its index was built. `gitnexus analyze` appends a
    // `<!-- gitnexus:start -->` stats block to CLAUDE.md and creates AGENTS.md from nothing — so a
    // repo that was invisible after install went dirty on first refresh: a MODIFIED tracked file
    // and a stray untracked one. Stealth had accounted for what bearing writes and not for what it
    // causes a third-party tool to write.
    //
    // Normally the pre-commit hook or a refresh script strips it, but stealth installs neither
    // (package.json and .githooks are both off-limits), so nothing was cleaning up. SessionStart is
    // the one thing guaranteed to run.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealthzap-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"app"}\n');
    fs.writeFileSync(path.join(tmp, "CLAUDE.md"), "# App\n\nHouse rules.\n");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    installKit(tmp, { runtime: "claude", features: "all", stealth: true, runSetup: false, skipVerify: true });
    const clean = execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" });

    // Exactly what analyze does.
    fs.appendFileSync(
      path.join(tmp, "CLAUDE.md"),
      "\n<!-- gitnexus:start -->\n# GitNexus — Code Intelligence\n(16500 symbols)\n<!-- gitnexus:end -->\n",
    );
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "<!-- gitnexus:start -->\nstats\n<!-- gitnexus:end -->\n");
    assert.notEqual(
      execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" }),
      clean,
      "fixture should be dirty — otherwise this proves nothing",
    );

    const r = spawnSync(process.execPath, [path.join(tmp, ".claude/hooks/bearing-session.mjs")], {
      cwd: tmp,
      input: JSON.stringify({ source: "startup" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, HOME: tmp },
      timeout: 30000,
    });
    assert.equal(r.status, 0, `session hook failed: ${r.stderr}`);
    assert.equal(
      execSync("git status --porcelain -uall", { cwd: tmp, encoding: "utf8" }),
      clean,
      "the analyzer's output survived a session start",
    );
    // The block held ALL of AGENTS.md, so the file is litter and must go — not be left at 0 bytes.
    assert.ok(!fs.existsSync(path.join(tmp, "AGENTS.md")), "an emptied analyzer doc was left behind");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("stealth refuses a repo where bearing is already committed", () => {
    // Converting a shared install means removing ~80 files from teammates' checkouts. That is a
    // deliberate, visible act and must not hide behind an install flag (NS-1).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealthref-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"shared"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    execSync("git add -A && git commit -qm 'add bearing'", { cwd: tmp, shell: "/bin/bash" });

    assert.throws(
      () => installKit(tmp, { runtime: "claude", features: "all", stealth: true, runSetup: false, skipVerify: true }),
      /already COMMITTED/,
      "stealth half-converted a shared install instead of refusing",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("machine-local bearing state never becomes committable", () => {
    // Found by staging a real install for commit: git would have taken the agent's in-flight
    // task-core, a session flag, and ~30 install backups into the repo's history.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-ignore-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    installKit(tmp, {
      runtime: "claude",
      features: "northstars,taskcore",
      runSetup: false,
      skipVerify: true,
    });

    // Each of these is real: the flag is written by the core session-primer, the task-core by the
    // taskcore module, and the backup by install itself when it overwrites a colliding file.
    fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
    for (const rel of [
      ".bearing/.bearing-session-primed.flag",
      ".bearing/.task-core.md",
      ".bearing/lib/agent-brief.mjs.bearing-backup",
      ".bearing/manifest.json",
      ".bearing/hooks.local.json",
    ]) {
      fs.writeFileSync(path.join(tmp, rel), "x");
      assert.equal(
        execSync(`git check-ignore -q ${JSON.stringify(rel)} && echo yes || echo no`, {
          cwd: tmp,
          shell: "/bin/bash",
          encoding: "utf8",
        }).trim(),
        "yes",
        `${rel} would be committed`,
      );
    }

    // Negative control (NS-12): the tracked payload must still be committable, or this rule has
    // quietly excluded the thing teammates actually need from git.
    for (const rel of [".bearing/hooks.json", ".bearing/lib/hook-helpers.mjs"]) {
      assert.equal(
        execSync(`git check-ignore -q ${JSON.stringify(rel)} && echo yes || echo no`, {
          cwd: tmp,
          shell: "/bin/bash",
          encoding: "utf8",
        }).trim(),
        "no",
        `${rel} must stay tracked — teammates get it via git`,
      );
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("uninstall never removes a file the user owned first (NS-1)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-userown-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"v"}\n');
    // All three are paths the kit also writes to. Each existed BEFORE the install, so each is
    // the user's and must survive — this is the negative control for the cleanup above.
    fs.writeFileSync(path.join(tmp, ".gitignore"), "node_modules/\n");
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".bearing/hooks.json"), '{"mode":"guide"}\n');
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".claude/settings.json"),
      JSON.stringify({ model: "opus" }) + "\n",
    );

    installKit(tmp, {
      runtime: "claude,zed",
      features: "northstars,taskcore",
      runSetup: false,
      skipVerify: true,
    });
    uninstallKit(tmp);

    // Byte-identical, not merely equivalent: losing the trailing newline is enough to show the
    // file as modified in the user's diff after an uninstall that should be invisible.
    assert.equal(
      fs.readFileSync(path.join(tmp, ".gitignore"), "utf8"),
      "node_modules/\n",
      "uninstall did not restore the user's .gitignore byte-for-byte",
    );
    assert.equal(
      fs.readFileSync(path.join(tmp, ".bearing/hooks.json"), "utf8").trim(),
      '{"mode":"guide"}',
      "uninstall removed a hooks.json the kit never installed",
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf8")),
      { model: "opus" },
      "uninstall discarded the user's Claude settings",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("runs as a CLI when its own path traverses a symlink", () => {
    // macOS /tmp -> /private/tmp is the everyday case. isMain compared argv[1] to import.meta.url
    // without resolving links, so the whole CLI became a no-op that still exited 0 — the worst
    // possible failure for an installer: it looks like it worked.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-symlink-"));
    const link = path.join(tmp, "kit-link");
    fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link);
    const r = spawnSync(process.execPath, [path.join(link, "kit.mjs"), "--help"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /install/, "CLI produced no output through a symlinked path");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("no shipped file names a .bearing/lib module that does not exist", () => {
    // A hand-maintained list of hook libs drifts the moment a lib is added or retired, and the
    // failure lands on the USER: `bearing update` aborted mid-install with
    // "Missing hook lib: .bearing/lib/context-pressure.mjs" — a module retired by NS-19 that two
    // shell scripts still demanded. The reverse drift is quieter and worse: six libs that DID
    // exist were never packed, so a bundle install shipped hooks whose imports were absent.
    // Derive the invariant instead of restating it: every `.bearing/lib/x.mjs` any shipped file
    // mentions must be a file we actually ship.
    const libDir = path.join(BUNDLE_ROOT, ".bearing/lib");
    const have = new Set(fs.readdirSync(libDir).filter((f) => f.endsWith(".mjs")));
    const missing = [];
    for (const rel of listBundleFiles()) {
      if (/\.(png|jpg|gif|ico|woff2?|zip|gz)$/.test(rel)) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(BUNDLE_ROOT, rel), "utf8");
      } catch {
        continue; // a symlink or a directory entry — nothing to scan
      }
      for (const m of text.matchAll(/\.bearing\/lib\/([\w.-]+\.mjs)/g)) {
        if (!have.has(m[1])) missing.push(`${rel} → .bearing/lib/${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], `shipped files reference libs that do not exist:\n  ${missing.join("\n  ")}`);
  });

  it("packs every .bearing/lib module it ships", () => {
    // The pack script listed libs by hand. Anything added after it was written travelled nowhere,
    // and the omission is invisible until a teammate's hook fails on a machine you cannot see.
    const pack = fs.readFileSync(path.join(BUNDLE_ROOT, "scripts/pack-bearing-teaching.sh"), "utf8");
    const globbed = /\.bearing\/lib\/\*\.mjs|for .*\.bearing\/lib/.test(pack);
    if (globbed) return; // expands at run time — covers whatever is on disk
    const listed = new Set([...pack.matchAll(/\.bearing\/lib\/([\w.-]+\.mjs)/g)].map((m) => m[1]));
    const shipped = fs.readdirSync(path.join(BUNDLE_ROOT, ".bearing/lib")).filter((f) => f.endsWith(".mjs"));
    assert.deepEqual(
      shipped.filter((f) => !listed.has(f)),
      [],
      "pack-bearing-teaching.sh does not pack every lib the kit installs",
    );
  });


  it("a stealth install never writes bearing scripts into package.json", () => {
    // Stealth exists for ONE reason: you are in someone else's repo and nothing you do may show up
    // in `git status`. installKit knows this — `wantsScripts = features.has("gitnexus") && !stealth`
    // and it calls removePackageScripts(). Then step 7 runs bearing-setup.sh, whose step 2 runs
    // this merge unconditionally and puts all 38 of them straight back. Observed on a real repo:
    // 75 lines added to a TRACKED package.json, ` M package.json` in a colleague-visible worktree.
    // Guarding the actor covers every caller — setup, install-from-bundle, a hand-run command.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealth-pkg-"));
    execSync("git init -q", { cwd: tmp });
    const pkg = { name: "theirs", version: "1.0.0", scripts: { build: "tsc" } };
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".bearing/manifest.json"), JSON.stringify({ stealth: true }));
    fs.cpSync(
      path.join(BUNDLE_ROOT, "scripts/bearing-teaching"),
      path.join(tmp, "scripts/bearing-teaching"),
      { recursive: true },
    );

    const before = fs.readFileSync(path.join(tmp, "package.json"), "utf8");
    const r = spawnSync(
      process.execPath,
      ["scripts/bearing-teaching/merge-package-scripts.mjs", "--write"],
      { cwd: tmp, encoding: "utf8" },
    );
    assert.equal(r.status, 0, `merge failed outright: ${r.stderr}`);
    const after = fs.readFileSync(path.join(tmp, "package.json"), "utf8");
    const keys = Object.keys(JSON.parse(after).scripts ?? {});
    assert.deepEqual(
      keys.filter((k) => k.startsWith("bearing") || k.startsWith("gitnexus")),
      [],
      "stealth install injected bearing scripts into a tracked package.json",
    );
    assert.equal(after, before, "stealth install modified package.json at all");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("setup RUNS on the default runtime — the configuration no other test exercises", () => {
    // Every other test in this file passes runSetup:false, so nothing ever ran bearing-setup.sh.
    // It had been broken since Cursor was removed: `wants_cursor` matched `all` and `both`, so
    // step 3 demanded `.cursor/rules/00-bearing-enforcement.mdc` and every setup-enabled install
    // died there — with the kit files already written. `all` is the DEFAULT and the recommended
    // runtime, which makes this the least-verified configuration and the most-used one at once
    // (NS-21). The check is the exit code and nothing else: asserting on source TEXT is exactly
    // what let the earlier "the teaching sync reads the recorded runtime" test pass over this.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-setup-runs-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"setup-runs"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: true });
    installKit(tmp, { runtime: "all", features: "all", runSetup: false, skipVerify: true });

    // --skip-index: the graph build needs a network and minutes, and is not what this asserts.
    const r = spawnSync("bash", ["scripts/bearing-setup.sh", "--skip-index"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, GITNEXUS_RUNTIME: "all" },
    });
    assert.equal(
      r.status,
      0,
      `bearing-setup.sh failed on the default runtime:\n${r.stdout}\n${r.stderr}`,
    );
    // And it must have DONE the work, not skipped its way to a clean exit (NS-20).
    assert.ok(
      fs.existsSync(path.join(tmp, ".claude/skills/bearing-workspace/SKILL.md")),
      "setup exited 0 without linking the Claude skills",
    );
    assert.ok(
      fs.existsSync(path.join(tmp, ".agents/skills/bearing-workspace/SKILL.md")),
      "setup exited 0 without linking the Zed skills",
    );
    assert.ok(!fs.existsSync(path.join(tmp, ".cursor")), "setup re-created .cursor/");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a `both` install gets Claude's skills — the alias means zed+claude now", () => {
    // The teaching sync matched claude on `*claude*|*all*`, which never included `both`. Right
    // while `both` meant cursor+zed; wrong the moment it became zed+claude — a `both` install then
    // linked .agents/skills and no .claude/skills, so microscope and consult, the two modules
    // delivered ONLY by a skill, would report as unavailable in Claude Code. That exact report is
    // what the runtime-detection work was built from.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-both-skills-"));
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email t@t.com && git config user.name t", { cwd: tmp, shell: true });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"both-app"}\n');
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: true });
    installKit(tmp, { runtime: "both", features: "all", runSetup: false, skipVerify: true });

    const r = spawnSync("bash", ["scripts/sync-cursor-bearing-teaching.sh"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, GITNEXUS_RUNTIME: "both" },
    });
    assert.equal(r.status, 0, `the teaching sync failed on "both":\n${r.stdout}\n${r.stderr}`);
    assert.ok(
      fs.existsSync(path.join(tmp, ".claude/skills/bearing-workspace/SKILL.md")),
      '"both" linked no Claude skills, so skill-delivered modules look unavailable there',
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("bearing-setup.sh only requires files a stealth install actually creates", () => {
    // Stealth writes `.claude/settings.local.json` — Claude Code reads it, and it is the personal
    // file, so it stays out of a shared `settings.json` the team owns. bearing-setup.sh demanded
    // `.claude/settings.json` regardless, so `bearing update` on a stealth repo died at step 3 with
    // "Missing: .claude/settings.json" having already written every kit file.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealth-req-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", stealth: true, runSetup: false, skipVerify: true });

    // The script branches on stealth, so read the stealth arm — the FIRST CLAUDE_SOURCES block.
    const setup = fs.readFileSync(path.join(BUNDLE_ROOT, "scripts/bearing-setup.sh"), "utf8");
    const block = setup.match(/if is_stealth; then\s*CLAUDE_SOURCES=\(([^)]*)\)/)?.[1] ?? "";
    const required = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(required.length, "could not read the stealth CLAUDE_SOURCES out of bearing-setup.sh");

    const missing = required.filter((f) => !fs.existsSync(path.join(tmp, f)));
    assert.deepEqual(missing, [], "bearing-setup.sh requires files a stealth install never writes");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("verify does not fail a stealth repo for the npm scripts stealth refuses to add", () => {
    // checkPackageGates demanded `bearing:*` keys in package.json. Stealth deliberately adds none —
    // package.json is tracked — so every stealth repo failed verification permanently, and the
    // remedy it printed ("run kit install/update") could never fix it. A check that cannot pass and
    // an instruction that cannot work: NS-5 and NS-6 in four words.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-stealth-verify-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "theirs" }, null, 2));
    installKit(tmp, { runtime: "claude", stealth: true, runSetup: false, skipVerify: true });

    const r = spawnSync(process.execPath, ["scripts/bearing-verify.mjs", tmp, "--json"], {
      cwd: tmp,
      encoding: "utf8",
    });
    const checks = JSON.parse(r.stdout).checks ?? JSON.parse(r.stdout);
    const gate = (Array.isArray(checks) ? checks : []).find((c) => c.id === "pkg_gates");
    assert.ok(gate, `no pkg_gates check in verify output: ${r.stdout.slice(0, 400)}`);
    assert.notEqual(gate.ok, false, `stealth repo failed pkg_gates: ${gate.detail}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("clears skill symlinks left pointing at a kit directory that has been renamed", () => {
    // The kit dir has been renamed twice — `.gitnexus/agent-kit/` → `.gnkit/` → `.bearing/` — and the
    // migration moved the CONTENT each time without touching the symlinks that named the old path.
    // 313 dangling links across 5 real repos, and they are not inert: `fs.mkdir(p, {recursive:true})`
    // through a dangling symlink throws ENOENT, so the analyzer could not install its own skills.
    // Observed on lead-sniffer and Sourcerer-Be as six "Could not install skill" warnings per run,
    // in a log nobody reads.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-dangling-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", runSetup: false, skipVerify: true });

    const linkDir = path.join(tmp, ".claude/skills");
    fs.mkdirSync(linkDir, { recursive: true });
    fs.symlinkSync("../../.gnkit/skills/gitnexus-exploring", path.join(linkDir, "gitnexus-exploring"));
    fs.symlinkSync(
      "../../.gitnexus/agent-kit/skills/gitnexus-refactoring",
      path.join(linkDir, "gitnexus-refactoring"),
    );
    // A dangling link that is NOT ours stays: bearing does not clean up after other tools (NS-1).
    fs.symlinkSync("../../somewhere-else/theirs", path.join(linkDir, "theirs"));

    updateKit(tmp, { runSetup: false, skipVerify: true });

    const gone = (n) => !fs.existsSync(path.join(linkDir, n)) && !fs.lstatSync(path.join(linkDir, n), { throwIfNoEntry: false });
    assert.ok(gone("gitnexus-exploring"), "left a link pointing at the retired .gnkit/ layout");
    assert.ok(gone("gitnexus-refactoring"), "left a link pointing at the retired .gitnexus/agent-kit/ layout");
    assert.ok(
      fs.lstatSync(path.join(linkDir, "theirs"), { throwIfNoEntry: false }),
      "removed a dangling symlink bearing did not create",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("the shipped .gitnexusignore excludes bundled build output", () => {
    // A minified bundle is not code anyone reads, and indexing it is not merely wasteful. Measured
    // on a real repo: 446 of 1123 indexed files were Capacitor-copied Next.js chunks, and they
    // produced 21 `Route` nodes describing a STALE MINIFIED COPY of the app — so a route lookup
    // answered with a webpack chunk instead of the handler. `dist/ build/ coverage/` never caught
    // any of it, because none of those is where Next.js puts its output.
    const ig = fs.readFileSync(path.join(BUNDLE_ROOT, ".gitnexusignore"), "utf8");
    const lines = new Set(
      ig.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")),
    );
    for (const pat of [".next/", "out/", "**/_next/", "*.min.js"]) {
      assert.ok(lines.has(pat), `.gitnexusignore no longer excludes ${pat}`);
    }
    // `**/_next/` and not a Capacitor path: the copy lives under android/ or ios/ in a mobile
    // wrapper, and hardcoding one framework's layout would miss every other.
    assert.ok(
      !ig.includes("android/app/src/main/assets"),
      "pinned a single framework's layout instead of matching _next anywhere",
    );
  });


  it("warns when a repo plainly has an API but the graph has no Route nodes", async () => {
    // `api_impact`, `route_map` and `shape_check` all read Route nodes, and route detection is
    // framework-dependent. On a NestJS backend with 33 @Controller classes and 210 route decorators
    // the index held THREE Route nodes, none of them an endpoint — so
    // `api_impact({route: "/venues"})` answered `error: No routes found matching "/venues"` for a
    // live route. A not-found reads as a safe change, which is the worst shape a wrong answer takes.
    // The smoke test already counted Route nodes and said nothing about them; now it compares that
    // count against evidence of an API and warns when they disagree.
    const { routeCoverageWarning } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/graph-smoke.mjs")).href + "?probe"
    );

    // The real numbers, from the two repos that exposed this.
    assert.ok(routeCoverageWarning(3, 38), "Sourcerer-Be (38 route-ish files, 3 Route nodes)");
    assert.ok(routeCoverageWarning(0, 9), "lead-sniffer (9 controllers, 0 Route nodes)");

    // And must NOT fire where coverage is fine, or where there is no API to speak of.
    assert.ok(!routeCoverageWarning(8, 3), "Sourcerer-fe has more Route nodes than route-ish files");
    assert.ok(!routeCoverageWarning(0, 0), "a repo with no API at all is not a finding");
    assert.ok(!routeCoverageWarning(0, 3), "3 route-ish files is too little evidence to warn on");
    assert.ok(!routeCoverageWarning(200, 210), "good coverage stays quiet");
  });


  it("doctor detects when the MCP server has diverged from the machine", async () => {
    // Two failures cost an afternoon and neither surfaced anywhere. A scratch repo was deleted and
    // removed from the registry, but the RUNNING server still served it — `context` failed with
    // "LadybugDB not found" at a path that no longer existed. And `npm i -g gitnexus@rc` replaced
    // the binary while launchd kept serving the old one, so every tool schema was a version behind.
    // Same shape both times: the server's view of the machine diverged from the machine. The doctor
    // used to end with "if MCP tools still fail, restart your editor" — a guess in place of a check.
    const { inspectMcpServer } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/persistence-health.mjs")).href
    );

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gn-mcp-home-"));
    fs.mkdirSync(path.join(home, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".gitnexus/registry.json"),
      JSON.stringify({ repositories: [{ name: "alive", path: home }, { name: "ghost", path: "/tmp/gn-not-here-9f2" }] }),
    );
    const dead = inspectMcpServer({ home }).checks.find((c) => c.id === "registry_paths");
    assert.equal(dead.ok, false, "a registry entry pointing at a deleted directory went unreported");
    assert.match(dead.detail, /ghost/, "the failing entry is not named, so it cannot be acted on");

    // ...and stays quiet when every path is real.
    fs.writeFileSync(
      path.join(home, ".gitnexus/registry.json"),
      JSON.stringify({ repositories: [{ name: "alive", path: home }] }),
    );
    assert.equal(inspectMcpServer({ home }).checks.find((c) => c.id === "registry_paths").ok, true);

    // A missing/unreadable registry is not a finding — plenty of installs have never indexed.
    fs.rmSync(path.join(home, ".gitnexus/registry.json"));
    assert.equal(inspectMcpServer({ home }).checks.find((c) => c.id === "registry_paths").ok, true);
    fs.rmSync(home, { recursive: true, force: true });
  });


  it("the capability report says what a NEGATIVE result from each tool means here", async () => {
    // Five traps found by querying live indexes, each a per-repo FACT the agent otherwise has to
    // carry as a rule: route tools blind on NestJS, PDG opt-in, taint absent vs empty, Community
    // metadata never populated, embeddings missing. The report exists so an empty answer is never
    // read as an empty codebase — which is why every gap must carry its `negative` sentence.
    const { probeCapabilities, classifyCycles } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/graph-capabilities.mjs")).href
    );

    const table = (n) => ({ ok: true, stdout: JSON.stringify({ markdown: `| n |\n| --- |\n| ${n} |` }) });
    // A repo where nothing is available: no embeddings, no ACCESSES, no PDG, a real API the graph
    // did not see, and unenriched communities.
    const barren = (q) =>
      table(
        /embedding/.test(q) ? 0
        : /ACCESSES/.test(q) ? 0
        : /Route/.test(q) ? 0
        : /Controller/.test(q) ? 30
        : /CFG/.test(q) ? 0
        : /TAINTED/.test(q) ? 0
        : /enrichedBy <> /.test(q) ? 0
        : 40,
      );
    const caps = probeCapabilities(barren);
    const gaps = caps.filter((c) => !c.ok);
    assert.equal(gaps.length, 6, `expected every probe to report a gap, got ${gaps.map((g) => g.id)}`);
    for (const g of gaps) {
      assert.ok(g.negative, `${g.id} reports a gap without saying what a negative result means`);
    }
    // The route gap must name the false-safe, since that is the one that reads as "safe to change".
    assert.match(caps.find((c) => c.id === "route_tools").negative, /ABSENT|no routes found/i);
    // Taint with no layer must not be reported as "clean".
    assert.match(caps.find((c) => c.id === "taint").negative, /nothing looked|not.*clean/i);

    // A healthy repo stays quiet where it should. Match each query by its distinctive fragment:
    // a loose /Route/ also matches the route-FILES query, which made evidence 5000 against 40
    // routes and reported a gap on the fixture that was supposed to be clean.
    const healthy = (q) =>
      table(
        /enrichedBy <> /.test(q) ? 5
        : /\(r:Route\)/.test(q) ? 40
        : /ENDS WITH 'Controller'/.test(q) ? 12
        : /\.controller\./.test(q) ? 12
        : 5000,
      );
    const ok = probeCapabilities(healthy);
    assert.equal(ok.find((c) => c.id === "pdg").ok, true);
    assert.equal(ok.find((c) => c.id === "route_tools").ok, true);

    // Cycles are not one number: a `.module.ts` pair breaks init order, an entity pair is a
    // type-position import erased at compile time. Reporting "34 cycles" conflates them.
    const c = classifyCycles([
      { a: "src/a.module.ts", b: "src/b.module.ts" },
      { a: "src/x.entity.ts", b: "src/y.entity.ts" },
      { a: "src/p.service.ts", b: "src/q.service.ts" },
    ]);
    // Edges existing is not the question being answerable. A live index had 57 ACCESSES edges into
    // one property and `impact` still returned impactedCount 0 — it walks CALLS. The old probe
    // counted edges and reported the capability live, so the report itself produced the false
    // negative it exists to prevent.
    const withFields = (q) =>
      /ACCESSES.*count\(\*\)|ORDER BY n DESC/.test(q)
        ? { ok: true, stdout: JSON.stringify({ markdown: "| name | file | n |\n| --- |\n| event | a.entity.ts | 57 |" }) }
        : healthy(q);
    const cannotWalk = probeCapabilities(withFields, () => false);
    const fa = cannotWalk.find((x) => x.id === "field_access");
    assert.equal(fa.ok, false, "impact resolving nothing for the busiest field is a GAP, not a pass");
    assert.match(fa.negative, /CALLS, not ACCESSES/);
    assert.match(fa.detail, /event/, "name the field it actually probed, so the claim is checkable");
    // ...and when impact DOES walk them, it stays quiet.
    assert.equal(probeCapabilities(withFields, () => true).find((x) => x.id === "field_access").ok, true);
    // No impact runner supplied → falls back to the edge count, and must not claim more.
    assert.equal(probeCapabilities(withFields).find((x) => x.id === "field_access").ok, true);

    assert.equal(c.blocking.length, 1, "a module<->module cycle is the one that forces forwardRef");
    assert.equal(c.typeLevel.length, 1);
    assert.equal(c.other.length, 1);
  });

  it("staleness reports how much TIME the index is behind, not only how many commits", async () => {
    // "236 commits behind" reads the same whether that is a busy afternoon or most of a year. On a
    // real repo it was seven weeks, and the graph was answering about code from a different era.
    const src = fs.readFileSync(path.join(BUNDLE_ROOT, ".bearing/lib/check-staleness.mjs"), "utf8");
    assert.match(src, /driftSpan/, "the drift span was removed from the staleness checker");
    // The span is interpolated, so the literal "of drift (indexed" never appears in the source —
    // assert on the two halves that actually do.
    assert.match(src, /of drift`/, "the span is computed but never reaches a message");
    assert.match(src, /behind HEAD\$\{span\}/, "the message no longer interpolates the span");
    // It must degrade quietly: a shallow clone cannot date the indexed commit, and a missing span
    // has to leave the sentence grammatical rather than printing "undefined of drift".
    assert.match(src, /out\.driftSpan \? `, /, "an absent span would print as undefined");
  });


  it("repairs a hooks.json comment that documents a path two renames out of date", () => {
    // `.bearing/hooks.json` is SEED-ONCE: written at install and never overwritten, because it is
    // team config the user edits. That protects their SETTINGS — and freezes OUR DOCUMENTATION.
    // A user who installed before the .gnkit -> .bearing rename still reads:
    //
    //     create a gitignored .gnkit/gitnexus-hooks.local.json
    //
    // while the code reads `.bearing/hooks.local.json` (hook-helpers.mjs LOCAL_CONFIG_FILE).
    // Following the instruction creates a file nothing reads — it fails SILENTLY, the worst
    // outcome for a config override. Reported from a real install, and `bearing update` could
    // never have fixed it.
    //
    // Worse, that vintage also worked-example `"contextWindowTokens": 1000000`, a key NS-19
    // retired: a reader who follows it sets something that does nothing at all.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-hookscomment-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", runSetup: false, skipVerify: true });

    const hooksPath = path.join(tmp, ".bearing/hooks.json");
    const stale = {
      comment:
        'Optional hook tuning. For PER-MACHINE overrides that shouldn\'t be committed (e.g. ' +
        '"contextWindowTokens": 1000000 for a 1M-context session), create a gitignored ' +
        ".gnkit/gitnexus-hooks.local.json with the same shape — it wins over this file.",
      mode: "guide",
      readLineThreshold: 120,
      sourceGlobs: ["custom/**"],
    };
    fs.writeFileSync(hooksPath, JSON.stringify(stale, null, 2));

    updateKit(tmp, { runSetup: false, skipVerify: true });

    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    assert.ok(
      after.comment.includes(".bearing/hooks.local.json"),
      "the comment still names a file nothing reads",
    );
    assert.ok(!after.comment.includes(".gnkit"), "a path from two renames ago survived");
    assert.ok(
      !after.comment.includes("contextWindowTokens"),
      "the worked example still sets a key NS-19 retired",
    );

    // Their SETTINGS are theirs — repairing our prose must not touch a single one.
    assert.equal(after.mode, "guide", "overwrote the user's mode");
    assert.equal(after.readLineThreshold, 120, "overwrote the user's threshold");
    assert.deepEqual(after.sourceGlobs, ["custom/**"], "overwrote the user's globs");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("verify names a hook setting that was retired and now does nothing", async () => {
    // The other half of the seed-once problem. Repairing the comment stops NEW readers being
    // misdirected; anyone who already followed it has `"contextWindowTokens": 1000000` sitting in
    // hooks.json doing precisely nothing, and nothing tells them. A setting that silently no-ops
    // looks handled, which is exactly why it outlives the feature it configured (NS-19).
    const { retiredHookKeysInUse } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/hook-helpers.mjs")).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-retired-"));
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });

    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.json"),
      JSON.stringify({ mode: "enforce", contextWindowTokens: 1000000 }),
    );
    fs.writeFileSync(
      path.join(tmp, ".bearing/hooks.local.json"),
      JSON.stringify({ contextPressureThreshold: 0.8, taskCoreEveryEdits: 40 }),
    );

    const found = retiredHookKeysInUse(tmp);
    const keys = found.map((f) => f.key).sort();
    assert.deepEqual(keys, ["contextPressureThreshold", "contextWindowTokens"]);
    // Both files are searched — the per-machine override is where these tend to hide.
    assert.ok(found.some((f) => f.file.endsWith("hooks.local.json")), "the local override is not scanned");
    // A live setting must never be flagged.
    assert.ok(!keys.includes("taskCoreEveryEdits"));

    fs.writeFileSync(path.join(tmp, ".bearing/hooks.json"), JSON.stringify({ mode: "enforce" }));
    fs.rmSync(path.join(tmp, ".bearing/hooks.local.json"));
    assert.deepEqual(retiredHookKeysInUse(tmp), [], "a clean config reported a dead key");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("verify contradicts an agent that guesses a module is unavailable", async () => {
    // A user's agent reported `microscope` and `consult` as "not available in Claude Code". Both ARE
    // supported there, and both were installed. They are the only two modules delivered by a SKILL
    // and nothing else — northstars has npm scripts, taskcore a hook, gitnexus the MCP tools — so
    // when the agent could not see their skills it concluded the modules did not exist for its
    // runtime. Nothing in bearing could contradict it, because nothing reported what each module
    // ships. Now something does.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-moddeliv-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    const verify = () => {
      const r = spawnSync(process.execPath, ["scripts/bearing-verify.mjs", tmp, "--json"], {
        cwd: tmp,
        encoding: "utf8",
      });
      const checks = JSON.parse(r.stdout).checks ?? [];
      return checks.find((c) => c.id === "module_delivery");
    };

    const clean = verify();
    assert.ok(clean, "no module-delivery check in verify output");
    assert.equal(clean.ok, true, `a fresh install reported a broken module: ${clean.detail}`);

    // Reproduce what their install looks like from the agent's side.
    fs.rmSync(path.join(tmp, ".claude/skills/bearing-microscope"), { recursive: true, force: true });
    const broken = verify();
    assert.equal(broken.ok, false, "an unreadable skill is not reported");
    assert.match(broken.detail, /microscope/, "the failing module is not named");
    // It must say WHY it matters, or it reads as a cosmetic file check.
    assert.match(broken.detail, /report it as unavailable|cannot be read/i);
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("spots a stale hooks comment it has never been told about", () => {
    // The first version of this repair hardcoded the markers it knew — ".gnkit",
    // "contextWindowTokens". That is the same hand-maintained list that let the hook-lib manifests
    // drift in both directions this morning, rediscovered one commit later in a new costume: the
    // NEXT time this comment changes, a fixed list does not know, and the repair silently stops
    // working for exactly the people who need it.
    //
    // Derived rule: a stale comment references something the CURRENT one does not.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-derive-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", runSetup: false, skipVerify: true });
    const hooks = path.join(tmp, ".bearing/hooks.json");
    const write = (comment) => fs.writeFileSync(hooks, JSON.stringify({ comment, mode: "guide" }, null, 2));
    const commentNow = () => JSON.parse(fs.readFileSync(hooks, "utf8")).comment;

    // A key retired in some FUTURE release. No hardcoded list could contain it, and the derived
    // rule catches it anyway — this is the whole point.
    write('Optional hook tuning, TEAM-SHARED. Set "someKeyRetiredLater": 5 in .bearing/hooks.local.json');
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.ok(
      !commentNow().includes("someKeyRetiredLater"),
      "a key the current comment does not document survived the repair",
    );

    // The historical case still works.
    write('Optional hook tuning, TEAM-SHARED. For PER-MACHINE overrides create .gnkit/gitnexus-hooks.local.json');
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.ok(!commentNow().includes(".gnkit"), "the two-renames-old path survived");

    // And a team that wrote their OWN note keeps it, even naming a key we retired (NS-1).
    const theirs = 'Our team config. Ask #platform before touching "contextWindowTokens".';
    write(theirs);
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.equal(commentNow(), theirs, "overwrote a comment the team had written for themselves");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("the teaching sync reads the recorded runtime, not a default that assumes Cursor", () => {
    // Reported from a zed-only install: `bearing:agent-refresh` exited 1 on EVERY run.
    //
    //     Missing rule: .cursor/rules/00-bearing-enforcement.mdc
    //
    // The index refreshed fine; the run then died verifying a Cursor file the repo was never given.
    // `RUNTIME="${GITNEXUS_RUNTIME:-both}"`, and `both` means cursor+zed — so any caller that does
    // not export the variable gets Cursor checks. bearing-setup.sh exports it, which is why install
    // worked and this one path did not.
    //
    // It matters because `bearing:agent-status` tells the agent to run agent-refresh AUTONOMOUSLY.
    // The agent sees exit 1, concludes the graph is unusable, and may refuse to proceed — after a
    // refresh that actually succeeded.
    const sync = fs.readFileSync(
      path.join(BUNDLE_ROOT, "scripts/sync-cursor-bearing-teaching.sh"),
      "utf8",
    );
    assert.ok(
      !/RUNTIME="\$\{GITNEXUS_RUNTIME:-both\}"/.test(sync),
      "runtime still defaults to `both`, so an unset env var re-enables Cursor checks everywhere",
    );
    assert.match(
      sync,
      /manifest\.json/,
      "the recorded runtime in .bearing/manifest.json is still not consulted",
    );
  });


  it("a failing post-refresh step does not report the refresh itself as failed", () => {
    // A zed install's `bearing:agent-refresh` exited 1 on every run because the teaching sync
    // verified a Cursor file the repo never had. The runtime bug is fixed — but the reason a
    // COSMETIC step could sink the whole command is structural: the index refresh uses
    // runAllowFail and handles its own exit code, then the teaching sync runs under `run()`, which
    // throws into a catch that reports "agent-refresh failed (ENOSPC or command error)" and exits 1.
    //
    // By then the graph IS fresh. And `bearing:agent-status` tells the agent to run this
    // autonomously, so any future failure in that step will again be read as an unusable graph and
    // may stop work that had nothing wrong with it. Fix the class, not the instance.
    const agent = fs.readFileSync(path.join(BUNDLE_ROOT, "scripts/bearing-agent.mjs"), "utf8");
    const refresh = agent.slice(agent.indexOf('if (cmd === "refresh")'), agent.indexOf('if (cmd === "brief")'));

    assert.ok(
      !/\n\s*run\("bash", \["scripts\/sync-cursor-bearing-teaching\.sh"\]/.test(refresh),
      "the teaching sync still runs under run(), so its failure throws and sinks the refresh",
    );
    assert.match(
      refresh,
      /runAllowFail\([\s\S]*sync-cursor-bearing-teaching/,
      "the teaching sync should not be able to fail the command that already succeeded",
    );
    // And when it does fail, the reader must be told the index is fine — otherwise the warning is
    // just as ambiguous as the exit code was.
    assert.match(refresh, /index (is )?(refreshed|fresh)/i);
  });


  it("says so when you are running an agent this install does not cover", () => {
    // The real cause of the "microscope / consult not available in Claude Code" report, and the
    // agent was literally correct. That repo is a ZED install — its own agent-refresh failure said
    // "a zed install with no .cursor/ directory" — and the user runs Claude Code in it.
    //
    // A zed-only install writes .agents/skills/ and AGENTS.md, and NO .claude/ anything. So every
    // module delivered by npm scripts kept working (gitnexus, northstars, the new benchmark) while
    // the two delivered only by a Claude-readable skill were genuinely absent. Nothing in bearing
    // mentioned the mismatch, so it looked like two broken modules rather than one wrong runtime.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-rtmismatch-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "zed", features: "all", runSetup: false, skipVerify: true });

    const runVerify = (env) => {
      const r = spawnSync(process.execPath, ["scripts/bearing-verify.mjs", tmp, "--json"], {
        cwd: tmp,
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      return (JSON.parse(r.stdout).checks ?? []).find((c) => c.id === "runtime_covers_agent");
    };

    // Inside Claude Code, on a zed-only install: this is the reported situation.
    const mismatch = runVerify({ CLAUDECODE: "1" });
    assert.ok(mismatch, "no runtime-coverage check in verify output");
    assert.equal(mismatch.ok, false, "a zed-only install did not flag a Claude Code session");
    assert.match(mismatch.detail, /claude/i, "the uncovered runtime is not named");
    // It must give the command, not just the diagnosis (NS-6).
    assert.match(mismatch.detail, /--runtime[^"]*claude/, "no runnable fix offered");

    // Outside Claude Code, the same install is correct and must stay quiet.
    const quiet = runVerify({ CLAUDECODE: "" });
    assert.equal(quiet.ok, true, `flagged a zed install running outside Claude Code: ${quiet.detail}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("`bearing update` with no path means this repo, and says so when it cannot", () => {
    // Reported verbatim:
    //
    //     ~/Projects/boobs-from-sakartvelo $ npx bearing update
    //     Missing target repo path. Use: install <path> or install --interactive
    //
    // Two failures in one line. `update` with no argument obviously means THIS repo — that is what
    // every other tool does and what the user meant while standing in it. And the guidance names
    // `install` to someone who typed `update`, so following it literally does the wrong verb.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-noarg-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", runSetup: false, skipVerify: true });

    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "kit.mjs");
    const run = (cwd, args) =>
      spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

    // 1. Inside an installed repo: update it.
    const here = run(tmp, ["update", "--no-setup", "--skip-verify"]);
    assert.equal(here.status, 0, `update in an installed repo failed: ${here.stderr}`);
    assert.match(here.stdout, /Update complete|Update finished/, "did not actually update this repo");

    // 2. Somewhere with no install and none beneath: say so, and name the verb the user typed.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gn-noarg-empty-"));
    const nowhere = run(empty, ["update"]);
    assert.notEqual(nowhere.status, 0, "claimed success with nothing to update");
    const msg = nowhere.stderr + nowhere.stdout;
    assert.ok(!/Use: install </.test(msg), "still tells an `update` user to run `install`");
    assert.match(msg, /update/, "the message does not mention the verb that was run");

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  });


  it("detects the editor you are actually running before defaulting the runtime", async () => {
    // The whole reason a user ended up with `microscope` and `consult` "not available in Claude
    // Code": their repo was installed for zed while they work in Claude Code. Nothing asked, and
    // the silent default is `both` — which then meant cursor+zed and covered Claude Code not at all.
    //
    // The signal was there the whole time. CLAUDECODE=1 is set in every Claude Code shell, and the
    // repo's own directories say which editors have been used in it.
    const { detectRuntimes } = await import(pathToFileURL(path.join(BUNDLE_ROOT, "../lib/detect-runtime.mjs")).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-detect-"));

    // Nothing to go on: no guess, so the caller knows to ask rather than assume.
    assert.deepEqual(detectRuntimes(tmp, {}), [], "invented a runtime with no evidence");

    // Running inside Claude Code is the strongest signal there is — it is not inference.
    assert.deepEqual(detectRuntimes(tmp, { CLAUDECODE: "1" }), ["claude"]);

    // The repo's own directories say which editors have been used in it.
    fs.mkdirSync(path.join(tmp, ".zed"), { recursive: true });
    assert.deepEqual(detectRuntimes(tmp, {}), ["zed"]);

    // A LEGACY `.cursor/` directory must not be detected. Cursor stayed in the signal list after
    // support was removed, and detection feeds `--runtime` straight through
    // (`resolvedRuntime = detected.join(",")`) — so any repo that had ever been opened in Cursor
    // installed itself into `Invalid runtime "cursor"`. A detector may only name runtimes the
    // parser still accepts.
    fs.mkdirSync(path.join(tmp, ".cursor"), { recursive: true });
    assert.deepEqual(
      detectRuntimes(tmp, {}),
      ["zed"],
      "a legacy .cursor/ directory was detected as a runtime the installer rejects",
    );
    assert.deepEqual(detectRuntimes(tmp, { CURSOR_TRACE_ID: "x" }), ["zed"], "same via the env var");

    // `.claude/` ALONE is deliberately not evidence — Claude Code creates it in repos that have
    // never heard of bearing — so it takes a file an agent configuration actually needs.
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    assert.deepEqual(detectRuntimes(tmp, {}), ["zed"], ".claude/ alone was read as evidence");
    fs.writeFileSync(path.join(tmp, ".mcp.json"), "{}");
    assert.deepEqual(detectRuntimes(tmp, {}).sort(), ["claude", "zed"]);

    // Both kinds of evidence combine, deduped and stable.
    assert.deepEqual(detectRuntimes(tmp, { CLAUDECODE: "1" }).sort(), ["claude", "zed"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("never picks a runtime silently when it cannot ask", () => {
    // Non-interactive installs (CI, scripts, an agent running the command) cannot be prompted. They
    // must still not end up with an unannounced default — that is exactly how a repo gets wired for
    // an editor nobody uses. Say what was chosen and how to change it.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-silent-"));
    execSync("git init -q", { cwd: tmp });
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "kit.mjs");
    const r = spawnSync(process.execPath, [cli, "install", tmp, "--no-setup", "--skip-verify"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDECODE: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout + r.stderr;
    // It should have USED the detection, not the blind default.
    assert.equal(
      readManifest(tmp)?.data.runtime,
      "claude",
      "ignored CLAUDECODE=1 and installed for something else",
    );
    assert.match(out, /--runtime/, "did not say how to change the runtime it chose");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("doctor probes the MCP endpoint it recorded, instead of guessing about it", async () => {
    // bearing writes `mcpTransport: {mode:"http", url:"http://127.0.0.1:39100/mcp"}` into the
    // manifest and then never asks whether that URL answers. When the shared server is down every
    // MCP tool fails in the editor while doctor reports "backend reachable, server current" — it
    // checks the CLI and the registry, which are a different thing — and signs off with "If MCP
    // tools still fail, restart your editor". That is the same guess-instead-of-a-check that the
    // registry and version probes were added to remove, surviving in the one line below them.
    const { probeMcpEndpoint } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/persistence-health.mjs")).href
    );
    const http = await import("node:http");

    // A live server on the recorded URL. Closed in a finally: an assertion that throws while this
    // handle is open leaves the test runner waiting on it forever rather than reporting the failure.
    const server = http.createServer((_req, res) => { res.writeHead(200); res.end("{}"); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    try {
      const live = await probeMcpEndpoint({ mode: "http", url: `http://127.0.0.1:${port}/mcp` });
      assert.equal(live.ok, true, `a live endpoint reported unreachable: ${live.detail}`);
    } finally {
      await new Promise((r) => server.close(r));
    }

    // The same URL once nothing is listening — this is the case that was invisible.
    const dead = await probeMcpEndpoint({ mode: "http", url: `http://127.0.0.1:${port}/mcp` });
    assert.equal(dead.ok, false, "a dead endpoint was reported as fine");
    assert.match(dead.detail, new RegExp(String(port)), "does not name the endpoint that failed");
    assert.match(dead.detail, /launchctl|start|restart/i, "does not say how to bring it back");

    // stdio installs spawn per-client and have no endpoint to probe: silence, not a false alarm.
    assert.equal(await probeMcpEndpoint({ mode: "stdio" }), null);
    assert.equal(await probeMcpEndpoint(null), null);
  });


  it("warns when an update is landing on a branch that is not the default", () => {
    // The Branch line was added after 64 kit files went onto a live feature branch. Passive display
    // was not enough: that line WAS there when it happened again the next day. A line you do not
    // read is a line that does not exist (NS-6), so say when it matters.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-branchwarn-"));
    execSync("git init -q -b main", { cwd: tmp });
    execSync("git commit -q --allow-empty -m init", { cwd: tmp });
    execSync("git remote add origin https://example.invalid/x.git", { cwd: tmp });
    execSync("git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main", { cwd: tmp });
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "kit.mjs");
    const run = () =>
      spawnSync(process.execPath, [cli, "install", tmp, "--runtime", "claude", "--no-setup", "--skip-verify"], {
        encoding: "utf8",
      }).stdout;

    assert.ok(!/NOT main/.test(run()), "warned while on the default branch");
    execSync("git checkout -q -b payers-v2", { cwd: tmp });
    const warned = run();
    assert.match(warned, /payers-v2 — NOT main/, "did not warn on a feature branch");
    assert.match(warned, /this diff lands here/, "warned without saying what the consequence is");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the task-core routine says a refresh REPLACES rather than appends", () => {
    // The nudge fires every N edits and says "refresh". Nothing said that a refresh is a rewrite,
    // so the file grows monotonically and becomes the transcript it exists to replace — the same
    // problem of burying load-bearing detail in narrative, at the same cost in context.
    const skill = fs.readFileSync(
      path.join(BUNDLE_ROOT, "skills/bearing-taskcore/SKILL.md"),
      "utf8",
    );
    assert.match(skill, /rewrite, not an append/i, "no guidance that a refresh replaces");
    assert.match(skill, /[Gg]it already keeps the log/, "does not say where finished work belongs");
    // The wording here is user-tested and deliberately terse. A 27-line table of keep/drop rules
    // sat here first and was replaced by one sentence that measurably worked better, because a
    // skill long enough to skim is a skill that gets skimmed.
    assert.match(skill, /clean it from log-like things/i, "no instruction on what a distill DROPS");
    assert.match(skill, /lessons, scars/i, "no instruction on what a distill KEEPS");
    // The core is per-CHAT. A lesson that generalises has to LEAVE for gold-practices before it is
    // pruned, or everything durable a task taught dies with the chat that learned it.
    assert.match(skill, /gold-practices\.md/, "no promotion path — pruned lessons would be lost");
    // Guard the terseness itself. Nothing else notices a skill growing four lines at a time, and
    // the failure is silent: it still reads fine, it just stops being read.
    const lines = skill.split("\n").length;
    assert.ok(lines <= 90, `task-core skill has grown to ${lines} lines; keep it skimmable (<=90)`);

    // And the nudge itself must say it, since that is the moment the choice gets made.
    const nudge = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/bearing-taskcore-nudge.mjs"),
      "utf8",
    );
    assert.match(nudge, /REWRITE it rather than appending/, "the nudge still just says 'refresh'");

    // The retired context-fullness trigger must not reappear in the wording anywhere (NS-19).
    const session = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/bearing-session.mjs"),
      "utf8",
    );
    assert.ok(
      !/when context fills/i.test(session),
      "the brief still names a trigger NS-19 retired as unmeasurable",
    );
  });


  it("no skill answers a stale index with a refresh that leaves it stale", () => {
    // `analyze` without --embeddings produces an index the contract counts as stale, exactly like a
    // commit behind — so the remedy reproduced the condition. Fixed once by exact string and missed
    // a "If step 2 says ..." variant, which a fresh install caught. Matched by intent now.
    // bearing-cli is exempt: documenting the raw CLI is what that skill is for.
    const dir = new URL("../bundle/skills/", import.meta.url);
    for (const name of fs.readdirSync(dir)) {
      if (name === "bearing-cli") continue;
      const f = new URL(`${name}/SKILL.md`, dir);
      if (!fs.existsSync(f)) continue;
      const skill = fs.readFileSync(f, "utf8");
      assert.ok(
        // Match the COMMAND, not the word. A first pass on /stale.*analyze/ flagged
        // bearing-guide, whose line correctly says `bearing:agent-refresh` and then "never ask
        // the user to analyze" — the word, not the call.
        !/[Ii]ndex is stale[^\n]*(?:run\.cjs|gitnexus)\s+analyze/.test(skill),
        `${name} answers staleness with a bare analyze, which leaves the index stale`,
      );
    }
  });

  it("no skill advertises a directory migration deletes", () => {
    // bearing-workspace listed "Area entry points -> .cursor/skills/generated/<area>/" while
    // migrate.mjs line ~391 calls dropSkillPath on exactly that directory. Generated area skills
    // land in .claude/skills/gitnexus-area-* and are mirrored to .agents/skills/ — verified across
    // three real installs, 20 dirs each, and no .cursor/skills/generated anywhere.
    //
    // Checked by name rather than derived: the removal calls in migrate.mjs pass a parent plus a
    // variable, so extracting "what gets deleted" from the source yields live directories too.
    // A guard built on that would fail on `.cursor/skills`, which every Cursor install has.
    // Walk EVERYTHING bearing ships, not just the skills. The first version of this test checked
    // bundle/skills/ only and passed while docs/GITNEXUS-TEAM-BUNDLE.md still named the directory —
    // caught by a fresh install, not by the test written to prevent it (GP-20).
    for (const f of shippedTextFiles()) {
      assert.ok(
        !fs.readFileSync(f, "utf8").includes(".cursor/skills/generated"),
        `${path.relative(BUNDLE_ROOT, f)} points at .cursor/skills/generated, which migration removes`,
      );
    }
  });

  it("skills name the api-profile at the path the writer actually writes", async () => {
    // The profile moved from .cursor/ to .bearing/. The constant moved, the writer moved, real
    // installs have it at .bearing/ — and two skills plus detect-api-router's own header comment
    // still sent readers to .cursor/. An agent that opens the documented path finds nothing,
    // concludes there is no profile, and goes back to guessing whether this repo has a framework
    // router — which is the question the profile exists to answer.
    //
    // Derived from the constant rather than hard-coded, so a future move updates this by itself.
    const { API_PROFILE_FILE } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/detect-api-router.mjs")).href
    );
    const stale = API_PROFILE_FILE.replace(/^\.[^/]+\//, ".cursor/");
    const dir = new URL("../bundle/skills/", import.meta.url);
    for (const name of fs.readdirSync(dir)) {
      const f = new URL(`${name}/SKILL.md`, dir);
      if (!fs.existsSync(f)) continue;
      const skill = fs.readFileSync(f, "utf8");
      if (!skill.includes("gitnexus-api-profile")) continue;
      assert.ok(skill.includes(API_PROFILE_FILE), `${name} does not name ${API_PROFILE_FILE}`);
      assert.ok(!skill.includes(stale), `${name} still sends readers to ${stale}`);
    }
  });

  /** Every text file bearing actually ships — skills, docs, templates, rules, hook sources. */
  function shippedTextFiles() {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(md|mdc|mjs)$/.test(e.name)) out.push(full);
      }
    };
    walk(BUNDLE_ROOT);
    return out;
  }

  it("resource URIs use the scheme the MCP server actually serves", () => {
    // Verified against the live server: `bearing://repo/bearing/schema` answers
    // "Error: Unknown resource URI"; `gitnexus://repo/bearing/schema` returns the schema. The
    // scheme belongs to GitNexus's MCP server — bearing does not run one, and an install wires up
    // exactly one server, `gitnexus`. Nothing translates between them.
    //
    // 92 occurrences shipped, almost certainly from the gn-kit -> bearing rename sweeping up a URI
    // scheme that was never bearing's to rename. Every `READ bearing://...` in every skill and in
    // the always-on contract was an instruction that cannot succeed.
    const files = [
      path.join(BUNDLE_ROOT, "../scripts/contract/enforcement-contract.md"),
      ...shippedTextFiles(),
    ];
    for (const f of files) {
      assert.ok(
        !fs.readFileSync(f, "utf8").includes("bearing://"),
        `${path.basename(f)} teaches bearing:// — the server serves gitnexus://`,
      );
    }
  });

  it("no skill teaches a rename tag the tool does not return", () => {
    // `rename` tags every edit `confidence: "graph"` or `confidence: "text_search"` — the MCP
    // schema says so in its own description. bearing-refactoring taught `ast_search` in four
    // places while its own opening section taught `text_search`, so the file contradicted itself.
    //
    // This is the dangerous direction. An agent told to review the `ast_search` edits searches the
    // response for a value that never appears, finds none, and concludes every edit was resolved
    // through the graph — which is how a regex find-and-replace gets accepted as safe. That is the
    // exact failure the section is there to prevent, produced by the section.
    const dir = new URL("../bundle/skills/", import.meta.url);
    for (const name of fs.readdirSync(dir)) {
      const f = new URL(`${name}/SKILL.md`, dir);
      if (!fs.existsSync(f)) continue;
      const skill = fs.readFileSync(f, "utf8");
      assert.ok(
        !skill.includes("ast_search"),
        `${name} teaches \`ast_search\`; rename returns \`text_search\``,
      );
    }
    const refactor = fs.readFileSync(new URL("bearing-refactoring/SKILL.md", dir), "utf8");
    assert.match(refactor, /text_search/, "the refactoring skill no longer names the regex tag");
    assert.match(refactor, /graph_edits/, "does not say to compare the two counts");
  });

  it("the hook-lib check only inspects files bearing installed", async () => {
    // Found within minutes of installing bearing into its own repo. The derived check walks
    // `scripts/` and flags any `.bearing/lib/x.mjs` reference that does not resolve — which caught
    // bearing's OWN maintainer script, `refresh-bundle-from-source.sh`, naming historical libs it
    // copies from a source repo. Five "missing" libs, exit 1, install aborted.
    //
    // The rule is right and the SCOPE was wrong: a repo may contain any number of scripts that
    // mention a path bearing does not install, and none of them are bearing's business. The
    // manifest already records exactly what bearing wrote.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-libscope-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    // A script the USER owns, naming a lib bearing never installs.
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "scripts/my-own-tool.sh"),
      "#!/usr/bin/env bash\n# copies .bearing/lib/region-infer.mjs from somewhere else\n",
    );

    const r = spawnSync("bash", ["scripts/sync-cursor-bearing-teaching.sh"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, GITNEXUS_RUNTIME: "claude" },
    });
    assert.equal(
      r.status,
      0,
      `a user's own script naming an uninstalled lib aborted the sync:\n${r.stdout}\n${r.stderr}`,
    );

    // But a lib that one of BEARING'S OWN files names, and which is missing, must still fail.
    fs.appendFileSync(
      path.join(tmp, ".bearing/lib/hook-helpers.mjs"),
      "\n// touches .bearing/lib/definitely-not-real.mjs\n",
    );
    const broken = spawnSync("bash", ["scripts/sync-cursor-bearing-teaching.sh"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, GITNEXUS_RUNTIME: "claude" },
    });
    assert.notEqual(broken.status, 0, "a genuinely dangling reference in bearing's own lib passed");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("every hook-config default can actually be set from a config file", () => {
    // `applyHookConfigFile` is an ALLOWLIST — it copies named keys and validates each type. Adding a
    // default without adding its merge case produces a setting the user can write, that documents
    // itself by existing, and that nothing reads. That is precisely the defect 1.1.2 fixed for keys
    // NS-19 had retired, arriving from the opposite direction: not a key that stopped working, but
    // one that never started. Caught on `consultNudge` the same hour it was added.
    const src = fs.readFileSync(path.join(BUNDLE_ROOT, ".bearing/lib/hook-helpers.mjs"), "utf8");
    const defaults = src.slice(src.indexOf("const cfg = {"), src.indexOf("applyHookConfigFile(cfg"));
    const keys = [...defaults.matchAll(/^ {4}([a-zA-Z]\w*):/gm)].map((m) => m[1]);
    assert.ok(keys.length > 5, "could not read the defaults block");

    const merge = src.slice(src.indexOf("function applyHookConfigFile"));
    const settable = new Set([...merge.matchAll(/file\.(\w+)/g)].map((m) => m[1]));
    // These are computed from sourceGlobs / sourceExts rather than set directly.
    const derived = new Set(["sourcePathRes", "broadGlobRes", "sourceExtRe"]);

    const unsettable = keys.filter((k) => !derived.has(k) && !settable.has(k));
    assert.deepEqual(
      unsettable,
      [],
      `these defaults have no merge case, so writing them in hooks.json does nothing: ${unsettable.join(", ")}`,
    );
  });


  it("uninstall takes back a package.json bearing created", () => {
    // A Python repo has no package.json, so a normal install creates one to hold the scripts.
    // Uninstall stripped the scripts and left `{"name":…,"scripts":{}}` behind — a Node manifest in
    // a Python project, planted by a tool that had just been removed, which makes npm, Dependabot
    // and CI treat the repo as a Node package. The same question was already asked about
    // `engines` one comment block away ("report whether WE added it so uninstall can take back
    // exactly what it gave") and never asked about the file holding it (NS-1, NS-22).
    const kit = new URL("./kit.mjs", import.meta.url).pathname;
    const mkPy = () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "gn-py-"));
      execSync("git init -q", { cwd: d });
      execSync("git config user.email t@t.t", { cwd: d });
      execSync("git config user.name t", { cwd: d });
      fs.writeFileSync(path.join(d, "pyproject.toml"), '[project]\nname="x"\n');
      fs.mkdirSync(path.join(d, "src"));
      fs.writeFileSync(path.join(d, "src/a.py"), "def f(): pass\n");
      execSync("git add -A && git commit -qm init", { cwd: d, shell: true });
      return d;
    };
    const run = (a) => execSync(`node ${JSON.stringify(kit)} ${a}`, { stdio: ["ignore", "pipe", "pipe"] });

    const a = mkPy();
    run(`install ${JSON.stringify(a)} --runtime zed --features all --no-setup --skip-verify`);
    assert.ok(fs.existsSync(path.join(a, "package.json")), "sanity: install created it");
    run(`uninstall ${JSON.stringify(a)}`);
    assert.ok(
      !fs.existsSync(path.join(a, "package.json")),
      "uninstall stranded a package.json bearing created in a repo that had none",
    );

    // ...and NEVER delete one the user adopted. Any key beyond our shell means it is theirs now.
    const b = mkPy();
    run(`install ${JSON.stringify(b)} --runtime zed --features all --no-setup --skip-verify`);
    const pkg = path.join(b, "package.json");
    const d = JSON.parse(fs.readFileSync(pkg, "utf8"));
    d.dependencies = { "left-pad": "^1.0.0" };
    fs.writeFileSync(pkg, JSON.stringify(d, null, 2));
    run(`uninstall ${JSON.stringify(b)}`);
    assert.ok(fs.existsSync(pkg), "uninstall deleted a package.json the user had adopted");
    assert.match(fs.readFileSync(pkg, "utf8"), /left-pad/, "their dependencies were dropped");
  });

  it("an update keeps the user's .gitnexusignore edits", () => {
    // Found in a real repo, twice. `.gitnexusignore` decides what enters the graph, so it is
    // per-REPO by nature — one project needed `!build/` and `!src/ui/pages/build/` because that
    // directory is real UI source and gitnexus drops anything named `build` as output. Update
    // re-copied the bundle version, five source files silently left the index, and every "how does
    // the build wizard work?" query came back empty in the way that reads as "this code does not
    // exist". The comment restoring them said "restored after a bearing install" — it had already
    // happened once before anyone wrote it down (NS-1).
    const kit = new URL("./kit.mjs", import.meta.url).pathname;
    const mkRepo = () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gni-"));
      execSync("git init -q", { cwd: d });
      execSync("git config user.email t@t.t", { cwd: d });
      execSync("git config user.name t", { cwd: d });
      fs.writeFileSync(path.join(d, "package.json"), '{"name":"t"}');
      execSync("git add -A && git commit -qm init", { cwd: d, shell: true });
      return d;
    };
    const run = (args) =>
      execSync(`node ${JSON.stringify(kit)} ${args}`, { stdio: ["ignore", "pipe", "pipe"] });

    const tmp = mkRepo();
    run(`install ${JSON.stringify(tmp)} --runtime claude --features all --no-setup --skip-verify`);
    const gni = path.join(tmp, ".gitnexusignore");
    fs.appendFileSync(gni, "\n# repo-specific\n!src/ui/pages/build/\n");
    run(`update ${JSON.stringify(tmp)} --no-setup --skip-verify`);
    assert.match(
      fs.readFileSync(gni, "utf8"),
      /!src\/ui\/pages\/build\//,
      "update overwrote a per-repo graph exclusion",
    );

    // ...AND bearing's own baseline still refreshes inside its markers. Seed-once alone would keep
    // the user's edits by never touching the file, which also means an improved baseline never
    // reaches an existing install. The managed block gives both: ours is replaced, theirs is not.
    const BEGIN = "# --- begin bearing (managed — edits here are replaced on update) ---";
    const END = "# --- end bearing ---";
    const cur = fs.readFileSync(gni, "utf8");
    fs.writeFileSync(
      gni,
      cur.slice(0, cur.indexOf(BEGIN)) + `${BEGIN}\nSTALE_ONLY\n` + cur.slice(cur.indexOf(END)),
    );
    run(`update ${JSON.stringify(tmp)} --no-setup --skip-verify`);
    const after = fs.readFileSync(gni, "utf8");
    assert.ok(!after.includes("STALE_ONLY"), "the managed block was not refreshed");
    assert.match(after, /!src\/ui\/pages\/build\//, "refreshing the block ate the user's region");

    // And seed-once must not smuggle a feature's file past the feature gate: the check used to run
    // BEFORE the runtime/feature axes, so declining gitnexus still wrote .gitnexusignore.
    const intel = mkRepo();
    run(
      `install ${JSON.stringify(intel)} --runtime claude ` +
        "--features northstars,taskcore,microscope --no-setup --skip-verify",
    );
    assert.ok(
      !fs.existsSync(path.join(intel, ".gitnexusignore")),
      "a repo that declined gitnexus got a gitnexus file",
    );
  });

  it("no counter can be written and never shown, in EITHER reader", () => {
    // Both readers rendered `Object.keys(labels).filter(...)` — a hand-kept label map on the READ
    // side of a counter, which is the same drift as a hand-kept list on the write side.
    //
    // The scorecard was fixed for this. `stats` was not, and this test could not see it: it sliced
    // the file from `cmd === "scorecard"` to `cmd === "stats"`, so the second reader was outside
    // its scope by construction (GP-20). stats kept its OWN label map, seven keys against the
    // scorecard's fourteen, and filtered by it — so half the counters were written on every session
    // and displayed to nobody. It also called `labelFor`, which was a local const in the scorecard,
    // and crashed with a ReferenceError mid-table on every run.
    //
    // One map and one humaniser at module scope now, and both readers derive their keys from what
    // was actually counted.
    const agent = fs.readFileSync(path.join(BUNDLE_ROOT, "scripts/bearing-agent.mjs"), "utf8");
    assert.equal(
      (agent.match(/const labels = \{/g) || []).length,
      1,
      "more than one label map — they have drifted apart before and will again",
    );
    assert.match(agent, /labels\[k\] \?\?/, "no fallback label for a counter nobody named");
    for (const [cmd, source] of [["scorecard", "counts"], ["stats", "s.totals"]]) {
      const block = agent.slice(agent.indexOf(`cmd === "${cmd}"`));
      const upTo = block.indexOf("cmd === ", 10);
      const body = upTo > 0 ? block.slice(0, upTo) : block;
      assert.ok(
        !/Object\.keys\(labels\)/.test(body),
        `${cmd} still filters by the label map, so an unlabelled counter stays invisible`,
      );
      assert.ok(
        body.includes(`Object.keys(${source})`),
        `${cmd} should render what was counted, not what someone remembered to name`,
      );
    }

    // And every counter that IS bumped anywhere should have a real label, not just survive on the
    // fallback — the fallback is a safety net, not the plan.
    const bumped = new Set();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".mjs")) {
          for (const m of fs.readFileSync(full, "utf8").matchAll(/bumpScore\([^,]+,\s*["'](\w+)["']/g)) {
            bumped.add(m[1]);
          }
        }
      }
    };
    walk(BUNDLE_ROOT);
    const labelled = new Set([...agent.matchAll(/^\s{2}(\w+): "/gm)].map((m) => m[1]));
    const unlabelled = [...bumped].filter((k) => !labelled.has(k));
    assert.deepEqual(unlabelled, [], `counters bumped with no label: ${unlabelled.join(", ")}`);
  });


  it("a hook whose libs are missing fails OPEN, it does not deny the tool call", () => {
    // Found by degrading a real install rather than by reading. With `.bearing/lib` absent, five
    // PreToolUse guards crashed on an unhandled ERR_MODULE_NOT_FOUND and exited 1 — and a non-zero
    // PreToolUse exit DENIES the call. Grep, Read, Edit, Bash and every MCP tool blocked at once,
    // explained by a raw Node stack trace, with no way for the agent to proceed.
    //
    // `.bearing/lib` going missing is not exotic: a partial uninstall, a failed update mid-copy, or
    // a `git clean -xdf` in a stealth repo where the kit is deliberately untracked. NS-5 is explicit
    // that a false deny is worse than a missed gate, and this is the maximal false deny.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-failopen-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    fs.rmSync(path.join(tmp, ".bearing/lib"), { recursive: true, force: true });

    const hooks = fs
      .readdirSync(path.join(tmp, ".claude/hooks"))
      .filter((f) => f.endsWith(".mjs"));
    assert.ok(hooks.length >= 10, "no hooks to check");

    const denied = [];
    for (const h of hooks) {
      const r = spawnSync(process.execPath, [path.join(tmp, ".claude/hooks", h)], {
        input: JSON.stringify({ tool_name: "Grep", cwd: tmp, tool_input: { pattern: "x" } }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      });
      if (r.status !== 0) denied.push(`${h} → exit ${r.status}`);
    }
    assert.deepEqual(
      denied,
      [],
      `hooks that block the tool call when their own libs are gone:\n  ${denied.join("\n  ")}`,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the diagnostic commands survive the damage they exist to diagnose", () => {
    // Something is wrong, so you run `bearing:doctor` to find out what — and every command crashed
    // with a raw ERR_MODULE_NOT_FOUND stack trace when `.bearing/lib` was missing. status, health,
    // verify, doctor, brief, scorecard, capabilities: all seven. The tools you reach for BECAUSE
    // the install is damaged were the ones that could not survive it.
    //
    // Unlike a hook, a diagnostic must fail LOUD — the user asked a question and deserves an
    // answer — but the answer has to be the diagnosis, not a stack trace (NS-6).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-diagfail-"));
    execSync("git init -q", { cwd: tmp });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
    fs.rmSync(path.join(tmp, ".bearing/lib"), { recursive: true, force: true });

    const crashed = [];
    for (const cmd of ["status", "health", "verify", "doctor", "brief", "scorecard", "capabilities"]) {
      const r = spawnSync(process.execPath, ["scripts/bearing-agent.mjs", cmd], {
        cwd: tmp,
        encoding: "utf8",
      });
      const out = `${r.stdout}${r.stderr}`;
      if (/node:internal|ERR_MODULE_NOT_FOUND|^\s*throw /m.test(out)) crashed.push(cmd);
      else {
        // It must NAME the problem and the fix, or it is a crash with better manners.
        assert.match(out, /\.bearing\/lib/, `${cmd} failed without naming what is missing`);
        assert.match(out, /update|install/i, `${cmd} failed without offering a way out`);
      }
    }
    assert.deepEqual(crashed, [], `commands that crash on a damaged install: ${crashed.join(", ")}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("an environmental condition does not make the install a failure", () => {
    // main's CI had been red for SIXTY-PLUS runs, with 30 tests failing there and passing locally.
    // One cause: `checkHttpServerReachable` fails when nothing answers on the shared MCP port, and
    // on CI nothing ever does. The check is right to notice — but it already marks itself
    // `environmental: true`, and that flag only changed the WORDING. The install still reported
    // "this install is not what it claims" and set exitCode 1.
    //
    // Which is false. The files are exactly what they claim; the machine is missing a service, and
    // the check says so and gives the command to start it. Failing an install for that is the same
    // false alarm NS-5 exists to prevent, and here it cost a permanently red pipeline that nobody
    // could read a real regression out of.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-envfail-"));
    execSync("git init -q", { cwd: tmp });
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "kit.mjs");
    // Point at a port nothing is listening on — CI's situation, made explicit.
    const r = spawnSync(
      process.execPath,
      [cli, "install", tmp, "--runtime", "claude", "--mcp", "39199", "--no-setup", "--skip-verify"],
      { encoding: "utf8" },
    );
    const out = `${r.stdout}${r.stderr}`;

    assert.equal(r.status, 0, `an unreachable MCP server failed the install:\n${out.slice(-600)}`);
    assert.ok(
      !/is not what it claims/.test(out),
      "an environmental condition was reported as a broken install",
    );
    // It must still SAY so, with the fix — silence would be the opposite mistake.
    assert.match(out, /nothing answering|39199/, "the unreachable server went unmentioned");
    assert.match(out, /gitnexus mcp --http|--mcp stdio/, "no way to resolve it was offered");
    fs.rmSync(tmp, { recursive: true, force: true });
  });


  it("counts file edits made through the shell, not just through the edit tools", async () => {
    // Caught by the user asking whether my own task-core had been updated. It had not — 67 hours
    // stale across three days of continuous work, and the nudge never fired.
    //
    // The counter watches Write|Edit|MultiEdit|NotebookEdit. In that session ~6 edits went through
    // those tools and ~90 went through Bash — python heredocs, `sed -i`, redirection. So it counted
    // 6 against a threshold of 25 and stayed silent forever. An agent that works through the shell
    // is invisible to it, which is not an exotic way to work.
    const { bashWritesFiles } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/hook-helpers.mjs")).href
    );

    // The shapes that actually did the editing in that session.
    for (const cmd of [
      "python3 - <<'PY'\nimport pathlib\npathlib.Path('x.mjs').write_text('y')\nPY",
      "sed -i '' 's/a/b/' lib/kit.mjs",
      "cat > docs/note.md <<'EOF'\nhi\nEOF",
      "echo 'x' >> .gitignore",
      "cp bundle/a.mjs repo/a.mjs",
      "mv old.mjs new.mjs",
      "npx prettier --write lib/",
    ]) {
      assert.equal(bashWritesFiles(cmd), true, `missed a write: ${cmd.split("\n")[0]}`);
    }

    // And must NOT count reading, inspecting or querying — a false count only makes the nudge
    // early, but a counter that fires on `ls` is measuring nothing.
    for (const cmd of [
      "ls -la .bearing/lib",
      "git status --porcelain",
      "grep -rn 'foo' lib/ | head -5",
      "node --test 2>&1 | grep -E '^# (pass|fail)'",
      "cat package.json",
      "curl -s http://127.0.0.1:39100/health",
      "git diff > /dev/null",
    ]) {
      assert.equal(bashWritesFiles(cmd), false, `counted a non-write: ${cmd}`);
    }
  });


  it("the drift gate can see every language the analyzer indexes", async () => {
    // GP-20 applied to bearing's own instruments: drift counts SOURCE files changed since the index,
    // and decides from that whether the graph is too stale to answer with. Its scope is an extension
    // list — so any language the analyzer indexes and that list omits is a file whose edits never
    // count. Not a wrong number: no number at all, and the gate simply never fires.
    //
    // Found by comparing the list against the analyzer's own language modules
    // (gitnexus/dist/core/ingestion/languages/*.js, each declaring `extensions: [...]`). `.vue` was
    // missing, and it is a whole framework: a Vue repo's graph goes stale on precisely the files
    // being edited while drift reads zero. `.cbl/.cob/.cpy` were missing too.
    //
    // Re-derive when the analyzer gains a language:
    //   ls $(npm root -g)/gitnexus/dist/core/ingestion/languages/*.js | xargs grep -h "extensions:"
    const { loadHookConfig } = await import(
      pathToFileURL(path.join(BUNDLE_ROOT, ".bearing/lib/hook-helpers.mjs")).href
    );
    const re = loadHookConfig(os.tmpdir()).sourceExtRe;

    // Every language the analyzer ships a module for, as of gitnexus 1.6.10-rc.211.
    const INDEXED = [
      "c.c", "h.h", "cpp.cpp", "cs.cs", "dart.dart", "go.go", "java.java", "js.js", "jsx.jsx",
      "kt.kt", "php.php", "py.py", "rb.rb", "rs.rs", "swift.swift", "ts.ts", "tsx.tsx",
      "component.vue", "program.cbl", "program.cob", "copybook.cpy",
    ];
    const blind = INDEXED.filter((f) => !re.test(f));
    assert.deepEqual(
      blind,
      [],
      `the analyzer indexes these and drift cannot see them: ${blind.join(", ")}`,
    );
  });


  it("every runtime the fallback message NAMES gets a command that installs it", () => {
    // Continuing the GP-20 sweep. `detectRuntimes` has no signal for codex at all — no env var, no
    // directory — so a codex user with no TTY lands on the `both` fallback, which is zed+claude.
    // They do get an AGENTS.md, because zed writes one too, so it looks covered. It is not the same
    // contract: codex ships 57 lines (it has no tool interception, so the gates are advisory and
    // omitted) and zed ships 487. They receive a document describing enforcement that cannot happen
    // for them, at roughly ten times the tokens.
    //
    // And the message that should rescue them did the opposite: it said "If you use Claude Code or
    // Codex" and then handed `--runtime claude`. Followed literally, a codex user installs for
    // Claude and codex's contract never lands (NS-6).
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "kit.mjs"), "utf8");
    const i = src.indexOf("No agent environment detected");
    assert.ok(i > 0, "the no-signal fallback message is gone");
    const msg = src.slice(i, i + 700);

    // Derived rather than hardcoded: whatever runtimes the prose OFFERS AS AN ALTERNATIVE must each
    // appear in a `--runtime <id>`. Scoped past the first line on purpose — the runtimes in
    // `(zed+claude)` there are what you are GETTING, not a case needing a command, and counting
    // them made this assertion fail on a message that was already correct. (GP-20, in the test.)
    const guidance = msg.slice(msg.indexOf("\n"));
    const named = ["claude", "codex", "cursor", "zed"].filter((r) =>
      new RegExp(r === "claude" ? "Claude" : r === "codex" ? "Codex" : r, "i").test(guidance),
    );
    const offered = new Set([...guidance.matchAll(/--runtime\s+([\w,]+)/g)].flatMap((m) => m[1].split(",")));
    const unserved = named.filter((r) => !offered.has(r));
    assert.deepEqual(
      unserved,
      [],
      `named in the message but not offered as a command: ${unserved.join(", ")}`,
    );
  });


  it("the deep-review counter falls back to git when a shell path is unreadable", () => {
    // Third GP-20 sweep target, and this instrument is mine from earlier today.
    // `bashWriteTargets` reads the path off the command line, which works for `sed -i FILE`,
    // redirection and `cp a b` — and yields NOTHING when a heredoc computes its target at runtime:
    //
    //     for rel in ["a.mjs", "b.mjs"]: pathlib.Path(rel).write_text(...)
    //
    // That is how most of a real session's edits were actually made, so the distinct-FILE count
    // stayed at zero for them and the nudge never approached its threshold. Guessing a path would
    // inflate the count with files nobody touched, so it must not guess — but git knows exactly
    // which files changed, whatever wrote them.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-gitfallback-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "seed.txt"), "x\n");
    execSync('git add -A && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: tmp });
    installKit(tmp, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });

    // A pre-existing dirty file must NOT count — it is not this session's work.
    fs.writeFileSync(path.join(tmp, "seed.txt"), "already dirty before we started\n");

    const fire = (command) =>
      spawnSync(process.execPath, [path.join(tmp, ".claude/hooks/bearing-microscope-nudge.mjs")], {
        input: JSON.stringify({
          tool_name: "Bash",
          cwd: tmp,
          transcript_path: "/x/chat.jsonl",
          tool_input: { command },
        }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      }).stdout;

    // Edits whose paths cannot be read off the command line.
    // SIX, not five: the first fallback event records the baseline, so the file it wrote is
    // absorbed into "already dirty". Bounded at one and only on the first unreadable shell write —
    // stated here rather than hidden, since a reader counting to five would think this off by one.
    let out = "";
    for (const n of ["a", "b", "c", "d", "e", "f"]) {
      fs.writeFileSync(path.join(tmp, `${n}.mjs`), "export const x = 1\n");
      out = fire("python3 - <<'PY'\nfor rel in FILES: pathlib.Path(rel).write_text('x')\nPY");
    }
    const seen = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(tmp, ".bearing/.bearing-microscope-chat.json"), "utf8"));
      } catch (e) {
        return { error: String(e) };
      }
    })();
    assert.match(
      out,
      /distinct files changed/,
      `shell-written files never reached the threshold; state=${JSON.stringify(seen).slice(0, 300)}`,
    );

    const state = JSON.parse(
      fs.readFileSync(path.join(tmp, ".bearing/.bearing-microscope-chat.json"), "utf8"),
    );
    assert.ok(
      !state.files.some((f) => f.includes("seed.txt")),
      "counted a file that was already dirty before the session started",
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── e2e module ────────────────────────────────────────────────────────────
  //
  // The harness writes a new TOP-LEVEL directory and declares a Playwright dependency, so every
  // test here is really the same question asked four ways: can a repo that did not ask for it end
  // up with it anyway (NS-1)? An unowned bundle path returns null from featureOf, null means core,
  // and core ships to everyone — so the leak is one missing line away at all times.

  it("a repo that did not choose e2e gets NO trace of it", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-noe2e-"));
    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"n"}\n');
    installKit(tmp, {
      runtime: "all",
      features: "northstars,taskcore,microscope,consult,minions,gitnexus",
      quick: true,
      runSetup: false,
      skipVerify: true,
    });
    assert.ok(!fs.existsSync(path.join(tmp, ".e2e")), ".e2e/ shipped to a repo that declined it");
    assert.ok(
      !fs.existsSync(path.join(tmp, ".bearing/skills/bearing-e2e")),
      "the bearing-e2e skill shipped to a repo that declined the module",
    );
    const gi = fs.readFileSync(path.join(tmp, ".gitignore"), "utf8");
    assert.ok(!gi.includes(".e2e/"), "gitignored .e2e/ paths in a repo with no harness");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("pressing Enter is not the same as asking for everything", () => {
    // `parseFeatures("all")` returns every id, and the wizard used to map a bare Enter onto it. The
    // moment an opt-out module existed that made Enter install a Playwright kit. Enter now means
    // the RECOMMENDED set, and the prompt says so — a default that quietly differs from the word
    // printed next to it is the NS-20 failure, not a nicety.
    assert.ok(FEATURE_IDS.includes("e2e"), "e2e must still be installable by name");
    assert.ok(!defaultFeatureIds().includes("e2e"), "e2e must not be in the default set");
    assert.deepEqual(
      defaultFeatureIds(),
      FEATURES.filter((f) => f.recommended).map((f) => f.id),
      "the default set must be derived from `recommended`, not hand-kept (GP-11)",
    );
    // If every feature is recommended again one day, this whole mechanism is dead weight and the
    // prompt wording is a lie in the other direction. Fail loudly rather than drift.
    assert.ok(
      FEATURES.some((f) => !f.recommended),
      "nothing is opt-in any more — either drop the recommended split or the prompt now overstates",
    );
  });

  it("a stealth install hides the whole harness, including what the agent writes later", () => {
    // Not just the shipped files: the verifiers an agent adds to .e2e/verify/ are as visible in
    // `git status` as the substrate under them, and stealth promises nothing shows.
    assert.ok(excludeLines(new Set(["e2e"])).includes(".e2e/"));
    assert.ok(!excludeLines(new Set(["northstars"])).includes(".e2e/"));
  });

  it("the harness refuses to call an all-skipped run green", () => {
    // THE scar the module exists to carry. A real kit stored skips as `pass: true` and counted
    // failures as `!pass`, so a verifier whose checks all skipped on "this tab is empty" — the
    // ordinary state of a fresh environment — printed `0/0 passed` and exited 0. Asserting the
    // happy path here would reproduce exactly the blindness that shipped it, so every case that
    // must FAIL is asserted (NS-12).
    const require = createRequire(import.meta.url);
    const { createReport } = require("../bundle/.e2e/core/report.js");
    const verdict = (build) => {
      const r = createReport("t");
      const logged = console.log;
      console.log = () => {};
      try {
        build(r);
        return r.finish({ exit: false });
      } finally {
        console.log = logged;
      }
    };
    assert.equal(verdict((r) => r.skip("a", "no data")), false, "an all-skip run read as green");
    assert.equal(verdict(() => {}), false, "an empty run read as green");
    assert.equal(verdict((r) => r.check("a", false)), false, "a failing run read as green");
    assert.equal(verdict((r) => r.check("a", true)), true, "a passing run was reported as failed");
    assert.equal(
      verdict((r) => {
        r.check("a", true);
        r.skip("b", "no session");
      }),
      true,
      "one real pass beside a skip must still be a pass",
    );
  });

  it("adding a module on update does not require retyping the others", () => {
    // The failure mode this prevents is silent: `--features` REPLACES, so a user adding e2e by
    // listing it alongside the modules they remembered would uninstall the ones they forgot. The
    // installer would report success, because it did exactly what was asked.
    const base = ["northstars", "taskcore", "minions"];
    assert.equal(applyFeatureDelta("+e2e", base), "northstars,taskcore,minions,e2e");
    assert.equal(applyFeatureDelta("-minions", base), "northstars,taskcore");
    assert.equal(applyFeatureDelta("+e2e,-minions", base), "northstars,taskcore,e2e");
    // A bare list must still REPLACE — install depends on it, and changing that would be worse.
    assert.equal(applyFeatureDelta("northstars,e2e", base), "northstars,e2e");
    // Nobody said: undefined, so updateKit falls through to the recorded set.
    assert.equal(applyFeatureDelta(undefined, base), undefined);
    assert.equal(applyFeatureDelta("", base), undefined);
    // Removing everything is an ANSWER. An empty string would read as "nobody said" to
    // parseFeatures and silently reinstate the whole default set — the opposite of the request.
    assert.equal(parseFeatures(applyFeatureDelta("-northstars,-taskcore,-minions", base)).size, 0);
    // A signed unknown must not be silently dropped from the set it was meant to join.
    assert.throws(() => applyFeatureDelta("+nope", base), /Unknown feature/);
    // Mixed signing is ambiguous, so it falls through to replacement and then fails loudly on the
    // "+e2e" token rather than guessing which of the two operations was meant.
    assert.throws(() => parseFeatures(applyFeatureDelta("northstars,+e2e", base)), /Unknown feature/);
  });

  it("a module introduced after your install is announced exactly once", () => {
    // `update` inherits the recorded feature set, so an opt-out module can never appear on its own
    // and nothing else in the run mentions it — announced-never is the default failure here. The
    // flip side is nagging, which is why this is keyed to the releases actually being crossed.
    const since = FEATURES.filter((f) => f.since);
    assert.ok(since.length, "no feature declares `since` — the announcement can never fire");
    for (const f of since) {
      assert.ok(
        releasableVersions(readPackagedChangelog() ?? "").some((e) => e.version === f.since),
        `feature "${f.id}" says since:${f.since}, which is not a released version in CHANGELOG.md`,
      );
      // Only opt-out modules need announcing; a recommended one arrives by itself.
      assert.equal(
        f.recommended,
        false,
        `"${f.id}" is recommended, so it arrives on its own and needs no announcement`,
      );
    }
  });

  it("an installed e2e harness knows whether it can actually run", () => {
    // Shipping ten files is not shipping a working harness: without node_modules the first command
    // a user types dies on a missing module, which reads as "bearing installed something broken".
    // This check decides whether to offer the fix, so it must be right in BOTH directions — a false
    // "ready" is a user hitting that error, a false "not ready" is bearing offering a 150MB
    // download to someone who already has it (NS-3).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-e2edeps-"));
    assert.equal(e2eNeedsDeps(tmp), false, "a repo with no harness must not be offered a setup");

    fs.mkdirSync(path.join(tmp, ".e2e"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".e2e/package.json"), "{}\n");
    assert.equal(e2eNeedsDeps(tmp), true, "an un-bootstrapped harness must be offered a setup");

    // The marker is playwright specifically, not the presence of node_modules: npm creates that
    // directory for any dependency, so an empty or partial one would read as ready and send the
    // user straight into the error this exists to prevent.
    fs.mkdirSync(path.join(tmp, ".e2e/node_modules"), { recursive: true });
    assert.equal(e2eNeedsDeps(tmp), true, "an empty node_modules must not count as ready");

    fs.mkdirSync(path.join(tmp, ".e2e/node_modules/playwright"), { recursive: true });
    assert.equal(e2eNeedsDeps(tmp), false, "a bootstrapped harness must not be offered again");

    // Never runs npm in a repo that has no harness — that would install into the USER's project.
    const r = bootstrapE2e(os.tmpdir());
    assert.equal(r.ok, false);
    assert.match(r.why, /not installed here/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a repo's own gold practices survive the update that splits the file", () => {
    // The migration case, which only ever runs ONCE per repo and therefore gets no second chance.
    // Before this existed the file was copied wholesale, so everything a project had written was
    // deleted with no message — the worst shape of loss, because the update reported success.
    const shipped = fs.readFileSync(
      new URL("../bundle/.bearing/gold-practices.md", import.meta.url),
      "utf8",
    );

    // An UNMARKED file: an older bearing's rules, plus rules the project added after them.
    const old = shipped
      .replace(GP_BEGIN, "")
      .replace(GP_END, "")
      .trimStart()
      .concat(
        "\n- **GP-98** — **A mock that never fires looks like one that fired.** *Scar: ours.*\n" +
          "\n- **GP-99** — **Ours too.** *Scar: also ours.*\n",
      );
    const { content, adopted } = mergeGoldPractices(old, shipped);
    assert.deepEqual(adopted, ["GP-98", "GP-99"], "the project's rules were not recognised");
    assert.match(content, /PP-1\*\* — \*\*A mock that never fires/, "carried over without renumbering");
    assert.match(content, /PP-2\*\* — \*\*Ours too/);
    // Renumbered, because the numbers are what collided: a repo wrote its own GP-24 while bearing
    // shipped a different GP-24, and a citation that still resolves but now means something else is
    // worse than one that dangles.
    assert.doesNotMatch(content, /GP-98/, "a project rule kept a GP number bearing may later claim");

    // bearing's own rules must NOT be adopted as the project's — including after a reword. GP-8
    // grew a clause and turned its full stop into a comma, which defeated both equality and a
    // string prefix, so the repo's older copy came back as a duplicate under a PP number.
    const reworded = shipped.replace(
      /- \*\*GP-8\*\* — \*\*[^*]+\*\*/,
      "- **GP-8** — **Every line you print is a claim.**",
    );
    assert.deepEqual(
      localRules(reworded, shipped).map((r) => r.id),
      [],
      "an older wording of one of bearing's own rules was adopted as the project's",
    );

    // The heuristic is only safe while bearing's own rules stay separable under it.
    const keys = headlineKeys(shipped);
    assert.equal(new Set(keys).size, keys.length, "two bearing rules share a leading-word key");
  });

  it("the harness does not tell you to run a file it does not ship", () => {
    // Shipped in 1.1.6: session.js said "Create one with: node .e2e/tools/export-storage.js" for a
    // file that was not in the bundle — and the real thing is a console snippet, so even shipping
    // it would have left the instruction wrong. Every path a shipped file NAMES is a claim (NS-20).
    const e2e = path.join(BUNDLE_ROOT, ".e2e");
    const files = [];
    (function walk(d, p = "") {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const rel = p ? `${p}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(path.join(d, ent.name), rel);
        else files.push(rel);
      }
    })(e2e);

    for (const rel of files) {
      if (!/\.(js|md)$/.test(rel)) continue;
      const src = fs.readFileSync(path.join(e2e, rel), "utf8");
      for (const ref of src.match(/(?:\.e2e\/|(?<![\w./])(?:core|tools|verify|interact)\/)[\w./-]+\.js\b/g) ?? []) {
        const target = ref.replace(/^\.e2e\//, "");
        // interact/ is the project's to write; the scaffold names it as a place, not a file.
        if (target.startsWith("interact/")) continue;
        assert.ok(
          files.includes(target),
          `.e2e/${rel} points at .e2e/${target}, which the bundle does not ship`,
        );
      }
    }
  });

  it("an unconfigured environment guard neither blocks nor claims to protect you", () => {
    // Two ways this goes wrong and they pull opposite ways. Hard-blocking every run until someone
    // writes a classifier is the false deny that costs more trust than the gate saves (NS-5).
    // Returning a bare ok:true is worse: the harness then reports safe on a run it never checked,
    // which is protection claimed and not delivered (GP-8). It has to pass AND say it is inert.
    const require_ = createRequire(import.meta.url);
    const { guardEnv, watchApiEnv } = require_("../bundle/.e2e/core/env.js");

    const page = { on: () => {} };
    const unconfigured = watchApiEnv(page, null);
    assert.equal(unconfigured.classify, false);
    return guardEnv(unconfigured, { timeout: 1 }).then((r) => {
      assert.equal(r.ok, true, "an unwritten classifier blocked the run");
      assert.match(r.reason, /INERT/, "an unprotected run did not say it was unprotected");
    });
  });

  it("every installable module has a row in the runtime parity table", async () => {
    // The table is how someone decides whether bearing does anything for THEIR editor, so a module
    // missing from it is invisible to exactly the person deciding. e2e shipped in 1.1.6 declaring
    // all four runtimes and had no row at all — the metadata test above passed, because it only
    // asks whether the id appears SOMEWHERE in the README, and a prose section satisfied that.
    const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const table = readme.slice(readme.indexOf("| | Claude Code |"));
    const rows = table.slice(0, table.indexOf("\n\n"));
    for (const f of FEATURES) {
      // Match on the module's own title word rather than the id — the rows are written for humans
      // ("North-stars — loaded as authority"), and one module may legitimately have several.
      const word = f.title.split(/[\s—]/)[0].replace(/-/g, "-?");
      assert.match(
        rows,
        new RegExp(`^\\|\\s*${word}`, "im"),
        `module "${f.id}" has no row in the runtime parity table`,
      );
    }
    // And the columns must be the runtimes that EXIST — derived, not listed here. The hand-written
    // list kept a Cursor column through the release that removed Cursor, and this table is the first
    // thing a reader uses to decide whether bearing does anything for their editor (NS-16, NS-20).
    const { VALID_RUNTIMES } = await import(new URL("./constants.mjs", import.meta.url).href);
    const DISPLAY = { claude: "Claude Code", zed: "Zed", codex: "Codex" };
    const concrete = VALID_RUNTIMES.filter((r) => !["both", "all"].includes(r));
    const header = rows.split("\n")[0].split("|").map((c) => c.trim()).filter(Boolean);
    assert.deepEqual(
      [...header].sort(),
      concrete.map((r) => DISPLAY[r] ?? r).sort(),
      "the parity table's columns are not the runtimes that exist",
    );
  });

  it("a resolved command name is never dropped into a string that cannot interpolate", () => {
    // Two shipped strings called howToRun() from inside DOUBLE QUOTES, so the user was shown the
    // literal text `${howToRun('bearing:agent-refresh')}`. One was the stale-index branch of the
    // session brief — the exact moment a runnable command is the whole point (NS-6).
    //
    // The check is delimiter ORDER, scoped to lines that call the resolver. Two looser rules were
    // tried and BOTH failed silently, which is the same defect class in the test itself: "has a
    // quote and no backtick" missed both, because the broken strings used backticks inside
    // themselves as markdown; "any double-quoted literal containing ${" flagged 33 innocent
    // template literals. Validated by running all three against the pre-fix files (GP-7).
    const firstDelimiterIsNotBacktick = (line) => {
      const i = line.indexOf("${");
      if (i < 0) return false;
      const m = line.match(/["'`]/);
      return Boolean(m) && m[0] !== "`" && m.index < i;
    };
    const bad = [];
    let calls = 0;
    (function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== "node_modules") walk(p);
          continue;
        }
        if (!/\.(mjs|js)$/.test(ent.name)) continue;
        fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          if (!line.includes("howToRun(")) return;
          calls++;
          if (firstDelimiterIsNotBacktick(line)) bad.push(`${p}:${i + 1} ${line.trim()}`);
        });
      }
    })(BUNDLE_ROOT);
    assert.ok(calls > 0, "found no howToRun call sites — the scan is looking in the wrong place");
    assert.deepEqual(bad, [], `howToRun() inside a non-interpolating string:\n${bad.join("\n")}`);
  });

  it("the escape hatch the gates print is itself pre-approved", async () => {
    // The maintenance allowlist went stale at the bearing-* rename and kept naming
    // `scripts/gitnexus-agent.mjs`, so `node scripts/bearing-agent.mjs fallback "<why>"` — the exit
    // the gates THEMSELVES print — stopped counting as maintenance and got the graph-first redirect
    // instead. A block whose documented exit is itself gated is the trap NS-6 exists to prevent.
    // Fixed once in the Cursor allowlist; this sibling in the Claude path was missed (GP-24).
    //
    // Asserted on BEHAVIOUR, not on the source text. A first attempt scanned for the current script
    // name anywhere in the file and passed against the reverted code, because the COMMENT explaining
    // the fix contains that name — a test that cannot fail (GP-2, caught by reverting it).
    // Dynamic import, not createRequire: classify.mjs is ESM and require() of it throws, which
    // made the first version of this test fail identically with AND without the fix.
    const { classifyShell } = await import(
      new URL("../bundle/.bearing/lib/classify.mjs", import.meta.url).href
    );
    // The maintenance branch returns before anything reads ctx.config, but the fall-through path
    // does — so the negative case needs one or it throws instead of deciding.
    const ctx = { phase: "fresh", repo: "bearing", config: { sourceExtRe: /\.(m?js|ts|tsx|py|go)$/ } };
    // Both halves matter: a REDIRECT also carries an agentMessage, so testing only for a message
    // reported an ordinary grep as "pre-approved" and the assertion failed for the wrong reason.
    const approved = (command) => {
      const v = classifyShell({ command }, ctx);
      return v.decision !== "deny" && Boolean(v.agentMessage);
    };

    assert.ok(approved('node scripts/bearing-agent.mjs fallback "why"'), "the CURRENT fallback command is not pre-approved");
    assert.ok(approved("npm run bearing:agent-refresh"), "the refresh command is not pre-approved");
    // Pre-rename names stay as aliases (NS-15) — user git hooks invoke them by name.
    assert.ok(approved('node scripts/gitnexus-agent.mjs fallback "why"'), "the legacy alias stopped working");
    // Cursor's allowlist also named `bash scripts/bearing-setup.sh` and this is where that case
    // went. It does NOT reach the maintenance branch, and that is correct rather than a gap: Cursor
    // could grant permission, Claude's adapter cannot — allow means "exit 0 and let the normal
    // permission flow run" (claude-emit.mjs). So the only thing to hold is that bearing's own setup
    // is never DENIED by bearing's own gate.
    assert.notEqual(
      classifyShell({ command: "bash scripts/bearing-setup.sh" }, ctx).decision,
      "deny",
      "the gate denies bearing's own setup script",
    );
    // And the gate must not simply approve everything.
    assert.ok(!approved("grep -rn handlePayment src/"), "the allowlist approves an ordinary grep");
  });

});
