import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
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
} from "./kit.mjs";
import { shouldCopyBundleFile } from "./kit-shared.mjs";
import { listSkillNames } from "./skills.mjs";
import {
  ZED_PROFILE_KEY,
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
  AGENTS_MARKER_BEGIN,
} from "./constants.mjs";
import { migrateLegacyInstall } from "./migrate.mjs";

/**
 * Copy hook files into a tmp repo, routing `lib/*` to the neutral .bearing/lib and
 * `.sh` entry hooks to .cursor/hooks (matching the installed layout).
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
      continue; // not a lib we ship — the caller's list also names .cursor/hooks entries
    }
    for (const m of src.matchAll(/from\s+['"]\.\/([\w.-]+\.mjs)['"]/g)) queue.push(m[1]);
    for (const m of src.matchAll(/import\(\s*['"]\.\/([\w.-]+\.mjs)['"]/g)) queue.push(m[1]);
  }
  return [...seen];
}

function copyHookFiles(tmp, entries) {
  fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".cursor/hooks"), { recursive: true });
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
        path.join(BUNDLE_ROOT, ".cursor/hooks", rel),
        path.join(tmp, ".cursor/hooks", rel),
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

  copyHookFiles(tmp, [
    "bearing-edit-guard.sh",
    "bearing-commit-guard.sh",
    "lib/first-nudge.mjs",
    "lib/load-staleness.mjs",
    "lib/check-staleness.mjs",
    "lib/hook-helpers.mjs",
    "lib/cypher-helpers.mjs",
    "lib/rename-helpers.mjs",
    "lib/stale-policy.mjs",
    "lib/session-primer.mjs",
    "lib/classify.mjs",
    "lib/cursor-emit.mjs",
  ]);
  fs.chmodSync(path.join(tmp, ".cursor/hooks/bearing-edit-guard.sh"), 0o755);
  fs.chmodSync(path.join(tmp, ".cursor/hooks/bearing-commit-guard.sh"), 0o755);
  return tmp;
}

function runHook(tmp, script, input) {
  const r = spawnSync("bash", [path.join(tmp, ".cursor/hooks", script)], {
    cwd: tmp,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  return JSON.parse((r.stdout || "{}").trim() || "{}");
}

describe("bearing", () => {
  it("bundle contains flat canonical skills", () => {
    const names = listSkillNames(path.join(BUNDLE_ROOT, "skills"));
    assert.ok(names.includes("bearing-enforcement"));
    assert.ok(names.includes("bearing-workspace"));
    assert.ok(names.includes("bearing-local"));
    assert.ok(names.length >= 12);
  });

  it("runtime filter skips cursor paths for zed-only", () => {
    assert.equal(shouldCopyBundleFile(".cursor/hooks.json", "zed"), false);
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
    assert.equal(shouldCopyBundleFile(".cursor/hooks.json", "cursor"), true);
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
    const skillLink = path.join(tmp, ".cursor/skills/bearing-workspace");
    assert.ok(fs.lstatSync(skillLink).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(tmp, MANIFEST_PATH)));
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
    assert.ok(
      !fs.existsSync(path.join(tmp, ".cursor/hooks.json")),
      "zed-only install should not enable Cursor hooks",
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
    assert.ok(
      !fs.existsSync(path.join(tmp, ".cursor/hooks.json")),
      "claude-only install must not enable Cursor hooks",
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
    assert.ok(fs.existsSync(path.join(tmp, ".cursor/hooks.json")));
    assert.ok(fs.existsSync(path.join(tmp, ".cursor/mcp.json")));
    assert.ok(fs.existsSync(path.join(tmp, ".zed/settings.json")));
    assert.ok(
      fs.existsSync(
        path.join(tmp, ".agents/skills/bearing-workspace/SKILL.md"),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(tmp, ".cursor/skills/bearing-workspace/SKILL.md"),
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

  it("bundle contains enforcement rule and hooks", () => {
    const files = listBundleFiles();
    assert.ok(
      files.some((f) => f.endsWith("00-bearing-enforcement.mdc")),
      `expected enforcement rule in bundle, got: ${files.filter((f) => f.includes("enforcement")).join(", ")}`,
    );
    assert.ok(files.includes(".cursor/hooks.json"));
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

  it("enforcement rule uses placeholder not hardcoded repo", () => {
    const bundleFiles = listBundleFiles();
    const rulePath = bundleFiles.find((f) =>
      f.endsWith("00-bearing-enforcement.mdc"),
    );
    const rule = fs.readFileSync(path.join(BUNDLE_ROOT, rulePath), "utf8");
    assert.ok(rule.includes(PLACEHOLDER));
    assert.ok(!rule.includes("private production repo"));
  });

  it("bundle includes docs required by gitnexus-setup.sh", () => {
    const files = listBundleFiles();
    assert.ok(files.includes("docs/GITNEXUS-TEAM-BUNDLE.md"));
    assert.ok(files.includes("docs/GITNEXUS-CURSOR-GUIDE.md"));
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
    assert.ok(files.includes(".cursor/hooks/bearing-session-health.sh"));
    assert.ok(files.includes(".cursor/hooks/bearing-session-health-user.sh"));
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
    assert.ok(/\n\.claude\/skills\/\n/.test(gi) || !gi.includes(".claude/skills/"),
      "the last managed rule must remain a clean line");
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
      path.join(BUNDLE_ROOT, ".cursor/rules/00-bearing-enforcement.mdc"),
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
    const { spawnSync, execSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-shell-guard-"));
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
        lastCommit: "deadbeef",
        stats: { nodes: 10, embeddings: 10 },
      }),
    );
    copyHookFiles(tmp, [
      "bearing-shell-staleness-guard.sh",
      "lib/hook-helpers.mjs",
      "lib/stale-policy.mjs",
      "lib/session-primer.mjs",
      "lib/load-staleness.mjs",
      "lib/check-staleness.mjs",
      "lib/cypher-helpers.mjs",
      "lib/rename-helpers.mjs",
      "lib/classify.mjs",
      "lib/cursor-emit.mjs",
    ]);
    fs.chmodSync(
      path.join(tmp, ".cursor/hooks/bearing-shell-staleness-guard.sh"),
      0o755,
    );
    const r = spawnSync(
      "bash",
      [path.join(tmp, ".cursor/hooks/bearing-shell-staleness-guard.sh")],
      {
        cwd: tmp,
        input: JSON.stringify({ command: "grep -r handleOrder src/" }),
        encoding: "utf8",
      },
    );
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.permission, "deny");
    assert.ok(out.user_message);
    assert.ok(out.agent_message.includes("agent-refresh"));

    // REVERSED (this used to assert `pnpm test` is denied while stale). Blanket-denying every
    // shell command on a stale index bricked the terminal over ONE commit of drift — reported
    // from real use: the agent could not `ls`, tail a log, or run tests until a full reindex
    // finished. Index freshness has nothing to say about any of those. The gate now covers only
    // what a stale GRAPH would have answered — a code search (NS-5).
    const allowed = spawnSync(
      "bash",
      [path.join(tmp, ".cursor/hooks/bearing-shell-staleness-guard.sh")],
      { cwd: tmp, input: JSON.stringify({ command: "pnpm test" }), encoding: "utf8" },
    );
    const okOut = JSON.parse(allowed.stdout.trim() || "{}");
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
    assert.ok(out.detail.includes("Hooks block"));
    assert.ok(!out.detail.includes("Classical tools OK"));
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
    for (const i of [1, 2, 3]) fs.writeFileSync(path.join(tmp, `f${i}.js`), "export const v = 1;\n");
    execSync("git add -A && git commit -q -m v1", { cwd: tmp, shell: true });
    const old = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    for (const i of [1, 2, 3]) fs.writeFileSync(path.join(tmp, `f${i}.js`), "export const v = 2;\n");
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
    assert.ok(out.detail.includes("Hooks block"));
    assert.ok(!/Classical tools OK/i.test(out.detail));
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
    assert.ok(r.stdout.includes("GitNexus Cursor Kit"));
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
    assert.ok(q.includes("f.kind"));
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

    const denied = runHook(tmp, "bearing-edit-guard.sh", {
      tool_name: "StrReplace",
      tool_input: { path: "src/foo.js", old_string: "a()", new_string: "b()" },
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/IMPACT GATE/.test(denied.agent_message));

    session.setMcpToolUsed(tmp, "gitnexus_impact");
    assert.ok(session.isImpactUsed(tmp));
    const allowed = runHook(tmp, "bearing-edit-guard.sh", {
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

    const denied = runHook(tmp, "bearing-commit-guard.sh", {
      command: "git commit -m wip",
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/COMMIT GATE/.test(denied.agent_message));

    // --help is never gated.
    const help = runHook(tmp, "bearing-commit-guard.sh", {
      command: "git commit --help",
    });
    assert.equal(help.permission, "allow");

    session.setMcpToolUsed(tmp, "gitnexus_detect_changes");
    assert.ok(session.isDetectUsed(tmp));
    const allowed = runHook(tmp, "bearing-commit-guard.sh", {
      command: "git commit -m wip",
    });
    assert.equal(allowed.permission, "allow");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("edit-guard blocks source edits when stale (unified, no grace shortcut)", async () => {
    const tmp = setupKitRepo({ fresh: false });
    const denied = runHook(tmp, "bearing-edit-guard.sh", {
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
    const cfg = { driftRefreshThreshold: 3 };
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
    assert.ok(msg.includes("GitNexus kit"));
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

  it("intel-only install: no GitNexus root artifacts or Cursor rules ship (NS-13)", async () => {
    const { featureOf } = await import(new URL("./features.mjs", import.meta.url).href);
    // Each of these is inert-to-broken without the module. .githooks/pre-commit is the sharp one:
    // it calls `npm run bearing:full-pdg`, a script only the gitnexus module installs, so a wired
    // hook in an intel-only repo fails every single commit.
    for (const rel of [
      ".gitnexusignore",
      ".github/workflows/gitnexus-ci.yml",
      ".githooks/pre-commit",
      ".cursor/rules/bearing.mdc",
      ".cursor/rules/bearing-first.mdc",
      ".cursor/rules/00-bearing-enforcement.mdc",
      ".cursor/hooks.json",
    ]) {
      assert.equal(featureOf(rel), "gitnexus", `${rel} must be gitnexus-owned`);
    }
    // Guard the classification end-to-end: an intel-only install must not place them on disk.
    const { shouldCopyBundleFile } = await import(
      new URL("./kit-shared.mjs", import.meta.url).href
    );
    const intel = new Set(["northstars", "taskcore", "microscope"]);
    for (const rel of [".gitnexusignore", ".githooks/pre-commit", ".cursor/rules/bearing.mdc"]) {
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
      // `mode` is an enum, not a free value.
      const override =
        key === "mode"
          ? value === "guide"
            ? "enforce"
            : "guide"
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

  it("the shared spawn harness is identical in every skill that embeds it", async () => {
    // Microscope and minions both spawn anchored subagents, and the mechanics are the same: one
    // pinned persona, the north-star subset, parallel-if-supported, and the duty to report what
    // went unchecked. Two hand-maintained copies are two copies that drift.
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

    // bearing OWNS this file: an update must replace local edits, or a stale copy outlives its fix.
    fs.writeFileSync(gp, "clobbered\n");
    updateKit(tmp, { runSetup: false, skipVerify: true });
    assert.notEqual(fs.readFileSync(gp, "utf8"), "clobbered\n", "gold practices did not refresh");

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
        !/[ -]/.test(rel),
        `bundle path contains a control character: ${JSON.stringify(rel)}`,
      );
      assert.ok(!/^\s|\s$/.test(path.basename(rel)), `bundle path has stray whitespace: ${JSON.stringify(rel)}`);
      // Windows rejects these outright, so a repo on one would fail the install rather than the file.
      assert.ok(!/[<>:"|?*]/.test(rel), `bundle path is not portable: ${JSON.stringify(rel)}`);
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
    for (const i of [1, 2, 3, 4, 5]) {
      fs.writeFileSync(path.join(root, "src", `f${i}.js`), `export const f${i} = () => ${i};\n`);
    }
    fs.writeFileSync(path.join(root, "README.md"), "# r\n");
    sh("git add -A && git commit -qm init");
    installKit(root, { runtime: "claude", features: "all", runSetup: false, skipVerify: true });
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

    // Under the threshold: distrust the graph, keep the rest of the toolbox.
    for (const i of [1, 2]) fs.appendFileSync(path.join(root, "src", `f${i}.js`), "//a\n");
    sh("git add -A && git commit -qm two");
    anchor("HEAD~1");
    s = stale();
    assert.equal(s.behindFiles, 2);
    assert.equal(s.reason, "behind_small");
    assert.equal(query(), "deny", "a 2-file-old graph answered as if current");
    assert.equal(read(), "allow", "a 2-file gap took away Read — that is the over-reach being fixed");

    // Over it: the hard block is unchanged.
    for (const i of [1, 2, 3, 4, 5]) fs.appendFileSync(path.join(root, "src", `f${i}.js`), "//b\n");
    sh("git add -A && git commit -qm five");
    anchor("HEAD~1");
    s = stale();
    assert.equal(s.behindFiles, 5);
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
    for (const doc of ["CLAUDE.md", ".cursor/rules/00-bearing-enforcement.mdc"]) {
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

    // EVERY runtime must agree. Two bugs lived here: the Cursor rule is written by a hand-rolled
    // function that bypassed substitution entirely (it had been shipping three literal
    // __GITNEXUS_REPO__ placeholders), and codex shares zed's AGENTS.md writer but did not forward
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
    const personas = ["CLAUDE.md", "AGENTS.md", ".cursor/rules/00-bearing-enforcement.mdc"].map(
      (f) => (fs.readFileSync(path.join(multi, f), "utf8").match(/You are working as \*\*(.+?)\*\*/) ?? [])[1],
    );
    assert.equal(new Set(personas).size, 1, `runtimes disagree on the persona: ${personas.join(" | ")}`);
    assert.match(personas[0], /quantitative trader/);
    for (const f of ["CLAUDE.md", "AGENTS.md", ".cursor/rules/00-bearing-enforcement.mdc"]) {
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

    for (const f of ["CLAUDE.md", "AGENTS.md", ".cursor/rules/00-bearing-enforcement.mdc"]) {
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
    for (const f of ["CLAUDE.md", "AGENTS.md", ".cursor/rules/00-bearing-enforcement.mdc"]) {
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
    fs.symlinkSync(path.dirname(new URL(import.meta.url).pathname), link);
    const r = spawnSync(process.execPath, [path.join(link, "kit.mjs"), "--help"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /install/, "CLI produced no output through a symlinked path");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
