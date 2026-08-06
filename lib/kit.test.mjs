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
  findInstalledRepos,
} from "./kit.mjs";
import { shouldCopyBundleFile } from "./kit-shared.mjs";
import { listSkillNames } from "./skills.mjs";
import {
  ZED_PROFILE_KEY,
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
} from "./constants.mjs";
import { migrateLegacyInstall } from "./migrate.mjs";

/**
 * Copy hook files into a tmp repo, routing `lib/*` to the neutral .bearing/lib and
 * `.sh` entry hooks to .cursor/hooks (matching the installed layout).
 */
function copyHookFiles(tmp, entries) {
  fs.mkdirSync(path.join(tmp, ".bearing/lib"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".cursor/hooks"), { recursive: true });
  for (const rel of entries) {
    if (rel.startsWith("lib/")) {
      const name = rel.slice(4);
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".bearing/lib", name),
        path.join(tmp, ".bearing/lib", name),
      );
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

describe("gitnexus-agent-kit", () => {
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

  it("installKit zed runtime wires Zed + skill symlinks", () => {
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
    assert.equal(zed.context_servers.gitnexus.command, "npx");
    assert.ok(
      !/(^|["/])(Users|home)\//.test(JSON.stringify(zed.context_servers.gitnexus)),
      "no hardcoded absolute path in zed context_servers",
    );
    assert.ok(zed.agent?.profiles?.[ZED_PROFILE_KEY]);
    assert.equal(zed.agent.profiles[ZED_PROFILE_KEY].name, "Zed + GitNexus");
    assert.ok(
      fs
        .readFileSync(path.join(tmp, "AGENTS.md"), "utf8")
        .includes("gitnexus-agent-kit"),
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
    for (const f of [
      "classify.mjs",
      "claude-emit.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "session-primer.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ]) {
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
    fs.mkdirSync(path.join(repo, ".gitnexus"), { recursive: true });
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
    fs.writeFileSync(path.join(tmp, "f.txt"), "v1");
    execSync("git add f.txt && git commit -q -m v1", { cwd: tmp, shell: true });
    const old = execSync("git rev-parse HEAD", {
      cwd: tmp,
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(path.join(tmp, "f.txt"), "v2");
    execSync("git add f.txt && git commit -q -m v2", { cwd: tmp, shell: true });
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
    assert.ok(preCommit.includes("npm run bearing:full-pdg"));
    assert.ok(!preCommit.includes("npm run bearing:refresh"));
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
    for (const f of [
      "check-staleness.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "hook-helpers.mjs",
      "session-health-audit.mjs",
      "agent-health.mjs",
      "persistence-health.mjs",
    ]) {
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

  it("GITNEXUS_CONTEXT_WINDOW env overrides the shared config file (per-machine window)", async () => {
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const prev = process.env.GITNEXUS_CONTEXT_WINDOW;
    try {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gn-win-"));

      // No file + no env → default window.
      delete process.env.GITNEXUS_CONTEXT_WINDOW;
      assert.equal(helpers.loadHookConfig(empty).contextWindowTokens, 200000);

      // No file + env → env applies (guards against the no-config early-return path).
      process.env.GITNEXUS_CONTEXT_WINDOW = "1000000";
      assert.equal(helpers.loadHookConfig(empty).contextWindowTokens, 1000000);

      // File says 200k, env says 1M → env wins (model-specific, not committed to a shared repo).
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gn-win2-"));
      fs.mkdirSync(path.join(repo, ".bearing"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, ".bearing/hooks.json"),
        JSON.stringify({ contextWindowTokens: 200000 }),
      );
      assert.equal(helpers.loadHookConfig(repo).contextWindowTokens, 1000000);

      // No env → the file value stands.
      delete process.env.GITNEXUS_CONTEXT_WINDOW;
      assert.equal(helpers.loadHookConfig(repo).contextWindowTokens, 200000);

      // Garbage env is ignored (no NaN/0 window).
      process.env.GITNEXUS_CONTEXT_WINDOW = "banana";
      assert.equal(helpers.loadHookConfig(repo).contextWindowTokens, 200000);

      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    } finally {
      if (prev === undefined) delete process.env.GITNEXUS_CONTEXT_WINDOW;
      else process.env.GITNEXUS_CONTEXT_WINDOW = prev;
    }
  });

  it("gitnexus-hooks.local.json overrides the shared file per-machine (defaults < shared < local < env)", async () => {
    const helpers = await import(
      new URL("../bundle/.bearing/lib/hook-helpers.mjs", import.meta.url).href
    );
    const prev = process.env.GITNEXUS_CONTEXT_WINDOW;
    try {
      delete process.env.GITNEXUS_CONTEXT_WINDOW;
      const r = fs.mkdtempSync(path.join(os.tmpdir(), "gn-local-"));
      fs.mkdirSync(path.join(r, ".bearing"), { recursive: true });
      const shared = path.join(r, ".bearing/hooks.json");
      const local = path.join(r, ".bearing/hooks.local.json");

      // Shared team config sets three keys.
      fs.writeFileSync(
        shared,
        JSON.stringify({ mode: "guide", contextWindowTokens: 200000, driftRefreshThreshold: 5 }),
      );
      // Local override touches two of them; the untouched one falls through to shared.
      fs.writeFileSync(
        local,
        JSON.stringify({ contextWindowTokens: 1000000, driftRefreshThreshold: 9 }),
      );
      let c = helpers.loadHookConfig(r);
      assert.equal(c.contextWindowTokens, 1000000, "local wins over shared");
      assert.equal(c.driftRefreshThreshold, 9, "local wins over shared");
      assert.equal(c.mode, "guide", "shared value stands where local is silent");

      // Env still beats the local file.
      process.env.GITNEXUS_CONTEXT_WINDOW = "500000";
      assert.equal(helpers.loadHookConfig(r).contextWindowTokens, 500000, "env beats local");
      delete process.env.GITNEXUS_CONTEXT_WINDOW;

      // Local-only (no shared file) still layers over the built-in defaults.
      fs.rmSync(shared);
      c = helpers.loadHookConfig(r);
      assert.equal(c.contextWindowTokens, 1000000);
      assert.equal(c.mode, "enforce", "default mode when no shared file");

      // Invalid local JSON is ignored (shared/default stands) — never throws.
      fs.writeFileSync(shared, JSON.stringify({ contextWindowTokens: 200000 }));
      fs.writeFileSync(local, "{ not valid json");
      assert.equal(helpers.loadHookConfig(r).contextWindowTokens, 200000, "invalid local ignored");

      fs.rmSync(r, { recursive: true, force: true });
    } finally {
      if (prev === undefined) delete process.env.GITNEXUS_CONTEXT_WINDOW;
      else process.env.GITNEXUS_CONTEXT_WINDOW = prev;
    }
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
    for (const f of [
      "claude-emit.mjs",
      "session-primer.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ]) {
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
    for (const f of [
      "claude-emit.mjs",
      "session-primer.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ]) {
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

  it("context-pressure estimates window fullness; task-core survives session clear", async () => {
    const cp = await import(
      new URL("../bundle/.bearing/lib/context-pressure.mjs", import.meta.url).href
    );
    const sp = await import(
      new URL("../bundle/.bearing/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-pressure-"));
    const transcript = path.join(tmp, "t.jsonl");

    // Estimate = the last assistant message's input + cache usage (the real prompt size).
    fs.writeFileSync(
      transcript,
      '{"type":"user","message":{"role":"user","content":"hi"}}\n' +
        '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":5000,"cache_read_input_tokens":175000,"cache_creation_input_tokens":2000,"output_tokens":100}}}\n',
    );
    assert.equal(cp.estimateContextTokens(transcript), 182000);
    assert.equal(
      cp.contextPressure(transcript, { contextWindowTokens: 200000, contextPressureThreshold: 0.9 }).over,
      true,
    );
    // Same fill but a 1M-token window → NOT near (window is per-model configurable).
    assert.equal(
      cp.contextPressure(transcript, { contextWindowTokens: 1000000, contextPressureThreshold: 0.9 }).over,
      false,
    );
    // No usage record anywhere → 0, NOT a byte-count of the file. The transcript is an unbounded
    // append-only log (keeps already-compacted turns), so size ≠ window occupancy; a byte guess
    // reads as "always full" and would fire the compaction nudge spuriously.
    fs.writeFileSync(transcript, "x".repeat(35000));
    assert.equal(cp.estimateContextTokens(transcript), 0);
    assert.equal(cp.estimateContextTokens(path.join(tmp, "nope")), 0);

    // A huge trailing tool-result line (a big read/grep/dump) sits at the tail at PostToolUse time
    // and pushes the preceding usage past the base 128 KB read — the estimator must WIDEN to find
    // it, not fall back to the file's byte size (~857k here).
    const bigUsage =
      '{"type":"assistant","message":{"usage":{"input_tokens":50000,"cache_read_input_tokens":300000,"cache_creation_input_tokens":10000}}}\n';
    fs.writeFileSync(
      transcript,
      bigUsage + JSON.stringify({ type: "user", message: { content: "z".repeat(3_000_000) } }) + "\n",
    );
    assert.equal(
      cp.estimateContextTokens(transcript),
      360000,
      "widen past a 3MB trailing line to the real usage record",
    );

    // Task-core survives clearSessionState (a task can span sessions); the nudge flag re-arms.
    fs.mkdirSync(path.join(tmp, ".bearing"), { recursive: true });
    fs.writeFileSync(sp.taskCorePath(tmp), "# TASK-CORE\nGOAL: x\n");
    sp.setPressureNudged(tmp, true);
    assert.equal(sp.taskCoreExists(tmp), true);
    assert.equal(sp.isPressureNudged(tmp), true);
    sp.clearSessionState(tmp);
    assert.equal(sp.isPressureNudged(tmp), false, "new session re-arms the nudge");
    assert.equal(sp.taskCoreExists(tmp), true, "task-core survives a session clear");
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
    // taskcore owns its lib; it must not ship when taskcore is off.
    assert.equal(
      shouldCopyBundleFile(".bearing/lib/context-pressure.mjs", "claude", parseFeatures("northstars")),
      false,
    );
    assert.equal(shouldCopyBundleFile(".bearing/lib/context-pressure.mjs", "claude", intel), true);

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
      ["bearing-microscope", "bearing-northstars", "bearing-taskcore"],
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
    const md = fs.readFileSync(
      path.join(BUNDLE_ROOT, "templates/CLAUDE.gitnexus.md"),
      "utf8",
    );
    const ALL = new Set(["northstars", "taskcore", "microscope", "gitnexus"]);

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

  it("an unparseable transport falls back to stdio instead of breaking the install", async () => {
    // A malformed manifest must not brick an install: stdio always works (NS-8).
    const { parseMcpTransport, mcpEntry } = await import(
      new URL("./mcp-config.mjs", import.meta.url).href
    );
    for (const junk of [null, undefined, "", "nonsense", 0, {}, { mode: "http" }, []]) {
      assert.equal(parseMcpTransport(junk).mode, "stdio", `${JSON.stringify(junk)} should be stdio`);
      assert.equal(mcpEntry(parseMcpTransport(junk)).command, "npx");
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
        stock: ours.filter(([, v]) => /npx gitnexus@latest/.test(v)).length,
        local: ours.filter(([, v]) => !/npx/.test(v) && /gitnexus/.test(v)).length,
      };
    };

    execSync("git init -q", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"g","version":"1.0.0"}');
    fs.writeFileSync(path.join(tmp, "f.js"), "x");
    execSync("git add -A && git commit -qm init", { cwd: tmp, shell: "/bin/bash" });

    run("install");
    assert.ok(counts().stock > 0, "default must stay npx — no global install required");
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
    assert.equal(entry().command, "npx", "default install must stay stdio");
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
    assert.equal(entry().command, "npx");
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
    const nm = path.join(searchRoot, "full/node_modules/pkg/.gitnexus");
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "agent-kit-manifest.json"), "{}");

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
        fs.readFileSync(
          path.join(searchRoot, name, ".gitnexus/agent-kit-manifest.json"),
          "utf8",
        ),
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
    for (const f of [
      "claude-emit.mjs",
      "session-primer.mjs",
      "hook-helpers.mjs",
      "cypher-helpers.mjs",
      "rename-helpers.mjs",
      "stale-policy.mjs",
      "load-staleness.mjs",
      "check-staleness.mjs",
    ]) {
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
});
