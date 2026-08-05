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
 * Copy hook files into a tmp repo, routing `lib/*` to the neutral .gnkit/lib and
 * `.sh` entry hooks to .cursor/hooks (matching the installed layout).
 */
function copyHookFiles(tmp, entries) {
  fs.mkdirSync(path.join(tmp, ".gnkit/lib"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".cursor/hooks"), { recursive: true });
  for (const rel of entries) {
    if (rel.startsWith("lib/")) {
      const name = rel.slice(4);
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, ".gnkit/lib", name),
        path.join(tmp, ".gnkit/lib", name),
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
    "gitnexus-edit-guard.sh",
    "gitnexus-commit-guard.sh",
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
  fs.chmodSync(path.join(tmp, ".cursor/hooks/gitnexus-edit-guard.sh"), 0o755);
  fs.chmodSync(path.join(tmp, ".cursor/hooks/gitnexus-commit-guard.sh"), 0o755);
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
    assert.ok(names.includes("gitnexus-enforcement"));
    assert.ok(names.includes("gitnexus-workspace"));
    assert.ok(names.includes("gitnexus-local"));
    assert.ok(names.length >= 12);
  });

  it("runtime filter skips cursor paths for zed-only", () => {
    assert.equal(shouldCopyBundleFile(".cursor/hooks.json", "zed"), false);
    assert.equal(
      shouldCopyBundleFile(".gnkit/lib/agent-health.mjs", "zed"),
      true,
    );
    assert.equal(
      shouldCopyBundleFile(".gnkit/gitnexus-hooks.json", "zed"),
      true,
    );
    assert.equal(
      shouldCopyBundleFile("scripts/gitnexus-agent.mjs", "zed"),
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
    fs.mkdirSync(path.join(tmp, ".cursor/skills/gitnexus-workspace"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmp, ".cursor/skills/gitnexus-workspace/SKILL.md"),
      "legacy copy",
    );
    fs.mkdirSync(path.join(tmp, ".claude/skills/gitnexus-workspace"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmp, ".claude/skills/gitnexus-workspace/SKILL.md"),
      "claude copy",
    );
    fs.mkdirSync(path.join(tmp, ".gitnexus"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, MANIFEST_PATH_LEGACY),
      JSON.stringify({
        version: 1,
        files: [".claude/skills/gitnexus-workspace/SKILL.md"],
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
      !fs.existsSync(path.join(tmp, ".cursor/skills/gitnexus-workspace")),
    );
    assert.ok(
      !fs.existsSync(path.join(tmp, ".claude/skills/gitnexus-workspace")),
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
    const skillLink = path.join(tmp, ".cursor/skills/gitnexus-workspace");
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
      fs.existsSync(path.join(tmp, ".gnkit/lib/agent-health.mjs")),
      "zed-only installs shared health helpers used by scripts/gitnexus-agent.mjs",
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
        path.join(tmp, ".agents/skills/gitnexus-workspace/SKILL.md"),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(
          tmp,
          ".gnkit/skills/gitnexus-workspace/SKILL.md",
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
      pre.some((g) => /gitnexus-grep-guard/.test(g.hooks?.[0]?.command ?? "")),
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
      fs.existsSync(path.join(tmp, ".claude/skills/gitnexus-workspace/SKILL.md")),
    );
    assert.ok(
      fs.existsSync(path.join(tmp, ".claude/hooks/gitnexus-grep-guard.mjs")),
    );
    assert.ok(
      fs.existsSync(path.join(tmp, ".gnkit/lib/classify.mjs")),
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
    fs.mkdirSync(path.join(tmp, ".gnkit/lib"), { recursive: true });
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
        path.join(BUNDLE_ROOT, ".gnkit/lib", f),
        path.join(tmp, ".gnkit/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/gitnexus-grep-guard.mjs"),
      path.join(tmp, ".claude/hooks/gitnexus-grep-guard.mjs"),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(tmp, ".claude/hooks/gitnexus-grep-guard.mjs")],
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
        path.join(tmp, ".agents/skills/gitnexus-workspace/SKILL.md"),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(tmp, ".cursor/skills/gitnexus-workspace/SKILL.md"),
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
      files.some((f) => f.endsWith("00-gitnexus-enforcement.mdc")),
      `expected enforcement rule in bundle, got: ${files.filter((f) => f.includes("enforcement")).join(", ")}`,
    );
    assert.ok(files.includes(".cursor/hooks.json"));
    assert.ok(files.includes(".gnkit/lib/load-staleness.mjs"));
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
    assert.equal(pkg.version, "1.2.0");
  });

  it("substituteRepoName replaces placeholder", () => {
    const out = substituteRepoName(`repo: "${PLACEHOLDER}"`, "my-app");
    assert.equal(out, 'repo: "my-app"');
    assert.ok(!out.includes(PLACEHOLDER));
  });

  it("enforcement rule uses placeholder not hardcoded repo", () => {
    const bundleFiles = listBundleFiles();
    const rulePath = bundleFiles.find((f) =>
      f.endsWith("00-gitnexus-enforcement.mdc"),
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
      files.includes("scripts/gitnexus-teaching/merge-package-scripts.mjs"),
    );
    assert.ok(!files.includes(".claude/skills/agent-region/SKILL.md"));
    assert.ok(
      !files.includes("scripts/gitnexus-teaching/generate-regions.mjs"),
    );
  });

  it("bundle includes agent reasoning shortcuts", () => {
    const files = listBundleFiles();
    assert.ok(files.includes(".gnkit/lib/hook-helpers.mjs"));
    assert.ok(files.includes(".gnkit/lib/cypher-helpers.mjs"));
    assert.ok(files.includes(".gnkit/lib/rename-helpers.mjs"));
    assert.ok(files.includes(".gnkit/lib/detect-api-router.mjs"));
    assert.ok(files.includes(".gnkit/lib/graph-smoke.mjs"));
    assert.ok(files.includes(".gnkit/lib/agent-brief.mjs"));
    assert.ok(files.includes(".gnkit/lib/agent-health.mjs"));
    assert.ok(files.includes(".gnkit/lib/persistence-health.mjs"));
    assert.ok(files.includes(".gnkit/lib/session-health-audit.mjs"));
    assert.ok(files.includes(".cursor/hooks/gitnexus-session-health.sh"));
    assert.ok(files.includes(".cursor/hooks/gitnexus-session-health-user.sh"));
    assert.ok(files.includes(".gnkit/gitnexus-hooks.json"));
    assert.ok(files.includes("skills/gitnexus-security-review/SKILL.md"));
    const brief = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".gnkit/lib/agent-brief.mjs"),
      "utf8",
    );
    assert.ok(brief.includes("Skill routing:"));
    assert.ok(brief.includes("gitnexus-security-review"));
  });

  it("hook-helpers builds copy-paste MCP calls", async () => {
    const helpers = await import(
      new URL("../bundle/.gnkit/lib/hook-helpers.mjs", import.meta.url)
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
      new URL("../bundle/.gnkit/lib/cypher-helpers.mjs", import.meta.url)
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
      new URL("../bundle/.gnkit/lib/rename-helpers.mjs", import.meta.url)
        .href
    );
    const cypher = await import(
      new URL("../bundle/.gnkit/lib/cypher-helpers.mjs", import.meta.url)
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
          "../bundle/.gnkit/lib/detect-api-router.mjs",
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

  it("gitignore marker matches snippet header", () => {
    assert.ok(GITIGNORE_MARKER.includes("GitNexus + gitnexus-agent-kit"));
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
      path.join(BUNDLE_ROOT, ".cursor/rules/00-gitnexus-enforcement.mdc"),
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
      new URL("../bundle/.gnkit/lib/stale-policy.mjs", import.meta.url)
        .href
    );
    const session = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url)
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
      "gitnexus-shell-staleness-guard.sh",
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
      path.join(tmp, ".cursor/hooks/gitnexus-shell-staleness-guard.sh"),
      0o755,
    );
    const r = spawnSync(
      "bash",
      [path.join(tmp, ".cursor/hooks/gitnexus-shell-staleness-guard.sh")],
      {
        cwd: tmp,
        input: JSON.stringify({ command: "pnpm test" }),
        encoding: "utf8",
      },
    );
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.permission, "deny");
    assert.ok(out.user_message);
    assert.ok(out.agent_message.includes("agent-refresh"));
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
      ".gnkit/lib/check-staleness.mjs",
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
      ".gnkit/lib/check-staleness.mjs",
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
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:agent-refresh"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:health"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:pdg"]);
    assert.match(GITNEXUS_NPM_SCRIPTS["gitnexus:pdg"], /--pdg/);
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:full-pdg"]);
    assert.match(GITNEXUS_NPM_SCRIPTS["gitnexus:full-pdg"], /--force .*--pdg/);
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:graph-smoke"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:detect-api"]);
    assert.ok(GITNEXUS_NPM_SCRIPTS["gitnexus:verify"]);
  });

  it("script-gates injects gate comment entries for package.json", async () => {
    const {
      buildGatedScripts,
      allManagedScriptKeys,
      gateCommentKey,
      GITNEXUS_SCRIPT_GATES,
    } = await import("../bundle/scripts/gitnexus-teaching/script-gates.mjs");
    const gated = buildGatedScripts();
    assert.ok(gated["gitnexus.__gate.1.session"]);
    assert.ok(gated["gitnexus:verify"]);
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
    assert.ok(files.includes("scripts/gitnexus-teaching/script-gates.mjs"));
    assert.ok(files.includes("scripts/gitnexus-gate-hint.mjs"));
    assert.ok(files.includes("scripts/lib/setup-ui.mjs"));
    assert.ok(files.includes(".gnkit/lib/verify-kit.mjs"));
    const preCommit = fs.readFileSync(
      path.join(BUNDLE_ROOT, ".githooks/pre-commit"),
      "utf8",
    );
    assert.ok(preCommit.includes("npm run gitnexus:full-pdg"));
    assert.ok(!preCommit.includes("npm run gitnexus:refresh"));
  });

  it("verify-kit reports missing files on empty repo", async () => {
    const { verifyKitInstall } = await import(
      new URL("../bundle/.gnkit/lib/verify-kit.mjs", import.meta.url)
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
    fs.mkdirSync(path.join(tmp, ".gnkit/lib"), { recursive: true });
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
        path.join(BUNDLE_ROOT, ".gnkit/lib", f),
        path.join(tmp, ".gnkit/lib", f),
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
    const health = path.join(tmp, ".gnkit/lib/agent-health.mjs");
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
      new URL("../bundle/.gnkit/lib/hook-helpers.mjs", import.meta.url)
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
    fs.mkdirSync(path.join(tmp, ".gnkit"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".gnkit/gitnexus-hooks.json"),
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
      new URL("../bundle/.gnkit/lib/hook-helpers.mjs", import.meta.url).href
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
      fs.mkdirSync(path.join(repo, ".gnkit"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, ".gnkit/gitnexus-hooks.json"),
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
      new URL("../bundle/.gnkit/lib/hook-helpers.mjs", import.meta.url).href
    );
    const prev = process.env.GITNEXUS_CONTEXT_WINDOW;
    try {
      delete process.env.GITNEXUS_CONTEXT_WINDOW;
      const r = fs.mkdtempSync(path.join(os.tmpdir(), "gn-local-"));
      fs.mkdirSync(path.join(r, ".gnkit"), { recursive: true });
      const shared = path.join(r, ".gnkit/gitnexus-hooks.json");
      const local = path.join(r, ".gnkit/gitnexus-hooks.local.json");

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
      new URL("../bundle/.gnkit/lib/cypher-helpers.mjs", import.meta.url)
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
    const load = path.join(tmp, ".gnkit/lib/load-staleness.mjs");
    const first = spawnSync(process.execPath, [load, tmp], {
      encoding: "utf8",
    });
    assert.equal(JSON.parse(first.stdout.trim()).fresh, true);
    const cacheFile = path.join(tmp, ".gnkit/.gitnexus-staleness-cache.json");
    assert.ok(fs.existsSync(cacheFile), "cache file written after first load");
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.equal(cached.data.fresh, true);
    assert.ok(typeof cached.at === "number");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("edit-guard enforces impact-before-edit when fresh", async () => {
    const tmp = setupKitRepo({ fresh: true });
    const session = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url)
        .href
    );

    const denied = runHook(tmp, "gitnexus-edit-guard.sh", {
      tool_name: "StrReplace",
      tool_input: { path: "src/foo.js", old_string: "a()", new_string: "b()" },
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/IMPACT GATE/.test(denied.agent_message));

    session.setMcpToolUsed(tmp, "gitnexus_impact");
    assert.ok(session.isImpactUsed(tmp));
    const allowed = runHook(tmp, "gitnexus-edit-guard.sh", {
      tool_name: "StrReplace",
      tool_input: { path: "src/foo.js", old_string: "a()", new_string: "b()" },
    });
    assert.equal(allowed.permission, "allow");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("commit-guard requires detect_changes before commit when fresh", async () => {
    const tmp = setupKitRepo({ fresh: true });
    const session = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url)
        .href
    );

    const denied = runHook(tmp, "gitnexus-commit-guard.sh", {
      command: "git commit -m wip",
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/COMMIT GATE/.test(denied.agent_message));

    // --help is never gated.
    const help = runHook(tmp, "gitnexus-commit-guard.sh", {
      command: "git commit --help",
    });
    assert.equal(help.permission, "allow");

    session.setMcpToolUsed(tmp, "gitnexus_detect_changes");
    assert.ok(session.isDetectUsed(tmp));
    const allowed = runHook(tmp, "gitnexus-commit-guard.sh", {
      command: "git commit -m wip",
    });
    assert.equal(allowed.permission, "allow");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("edit-guard blocks source edits when stale (unified, no grace shortcut)", async () => {
    const tmp = setupKitRepo({ fresh: false });
    const denied = runHook(tmp, "gitnexus-edit-guard.sh", {
      tool_name: "Write",
      tool_input: { path: "src/foo.js", file_path: "src/foo.js" },
    });
    assert.equal(denied.permission, "deny");
    assert.ok(/STALENESS GATE/.test(denied.agent_message));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("compaction middleware: source-aware clear + durable memory helpers", async () => {
    const session = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
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
    fs.mkdirSync(path.join(tmp, ".gnkit/lib"), { recursive: true });
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
        path.join(BUNDLE_ROOT, ".gnkit/lib", f),
        path.join(tmp, ".gnkit/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/gitnexus-session.mjs"),
      path.join(tmp, ".claude/hooks/gitnexus-session.mjs"),
    );
    const session = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
    );
    const runSession = (source) =>
      spawnSync(process.execPath, [path.join(tmp, ".claude/hooks/gitnexus-session.mjs")], {
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
    fs.mkdirSync(path.join(tmp, ".gnkit/lib"), { recursive: true });
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
        path.join(BUNDLE_ROOT, ".gnkit/lib", f),
        path.join(tmp, ".gnkit/lib", f),
      );
    }
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, ".claude/hooks/gitnexus-precompact.mjs"),
      path.join(tmp, ".claude/hooks/gitnexus-precompact.mjs"),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(tmp, ".claude/hooks/gitnexus-precompact.mjs")],
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
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
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
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-telemetry-"));

    // Session 1: two grep redirects + a graph call, then session start clears it.
    session.bumpScore(tmp, "grepRedirects");
    session.bumpScore(tmp, "grepRedirects");
    session.bumpScore(tmp, "graphCalls");
    session.clearSessionState(tmp); // flushes then wipes the scorecard
    assert.ok(
      !fs.existsSync(path.join(tmp, ".gnkit/.gitnexus-scorecard.json")),
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
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url)
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
      await import("../bundle/scripts/gitnexus-teaching/script-gates.mjs");
    const s = flatGitnexusScripts();
    assert.ok(s["gitnexus:doctor"]);
    assert.ok(s["gitnexus:scorecard"]);
    assert.ok(s["gitnexus:agent-review"]);
    assert.ok(s["gitnexus:branch-status"]);
    assert.ok(s["gitnexus:pr-impact"]);
    assert.ok(s["gitnexus:map"]);
    assert.ok(s["gitnexus:commit-msg"]);
    assert.ok(s["gitnexus:ci"]);
    assert.ok(s["gitnexus:pdg"]);
    assert.ok(s["gitnexus:full-pdg"]);
  });

  it("persistence-health classifies database failures", async () => {
    const { classifyPersistenceOutput, inspectPersistence } = await import(
      new URL(
        "../bundle/.gnkit/lib/persistence-health.mjs",
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
      new URL("../bundle/.gnkit/lib/cypher-cli.mjs", import.meta.url)
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
      new URL("../bundle/.gnkit/lib/commit-message.mjs", import.meta.url)
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
        "../bundle/.gnkit/lib/generate-arch-doc.mjs",
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
        "../bundle/.gnkit/lib/generate-arch-doc.mjs",
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
        "../bundle/.gnkit/lib/stabilize-agent-docs.mjs",
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
      new URL("../bundle/.gnkit/lib/classify.mjs", import.meta.url).href
    );
    const helpers = await import(
      new URL("../bundle/.gnkit/lib/hook-helpers.mjs", import.meta.url)
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

    // ONE-MCP-UNLOCK CLOSED: scoped source grep stays denied even after graph use.
    v = grep("calculateExposure", { path: "src/risk.js" }, { graphUsed: true });
    assert.equal(v.decision, "deny");

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
      new URL("../bundle/.gnkit/lib/classify.mjs", import.meta.url).href
    );
    const helpers = await import(
      new URL("../bundle/.gnkit/lib/hook-helpers.mjs", import.meta.url).href
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
    let v = grep("signedRequest\\|createBinanceFuturesTransport", { path: "src/a.js" });
    assert.equal(v.decision, "deny");
    assert.ok(v.agentMessage.includes("gitnexus_context"));
    // decl / assignment branches are caught too
    assert.equal(grep("isScaleIn =|const oppStop", { path: "src/a.js" }).decision, "deny");
    // but a real literal alternation over a non-source file is still fine
    assert.equal(grep("error|warning", { path: "logs/app.log" }).decision, "allow");

    // SHELL ESCAPE HATCH CLOSED: bash grep/rg/git-grep over source is gated like the tool.
    assert.equal(shell("grep -n 'computeDryRunPnl' src/future/server/sync.js | head").decision, "deny");
    assert.equal(shell("grep -n 'signedRequest\\|createBinanceFuturesTransport' src/a.js").decision, "deny");
    assert.equal(shell("rg computeDryRunPnl src/").decision, "deny");
    assert.equal(shell("rg computeDryRunPnl").decision, "deny");
    assert.equal(shell("git grep signedRequest").decision, "deny");
    assert.equal(shell("grep -rn createBinanceFuturesTransport src").decision, "deny");

    // LEGIT SHELL STAYS ALLOWED: piped filters, non-source, maintenance, read-only git.
    assert.equal(shell("ps aux | grep node").decision, "allow");
    assert.equal(shell("npm ls | grep gitnexus").decision, "allow");
    assert.equal(shell("cat package.json | grep name").decision, "allow");
    assert.equal(shell("grep -n TODO README.md").decision, "allow");
    assert.equal(shell("npm run gitnexus:agent-refresh").decision, "allow");
    assert.equal(shell("git status").decision, "allow");

    // Shell redirect message names the tool and points at the graph.
    v = shell("rg createBinanceFuturesTransport src/");
    assert.ok(/bypasses the graph/.test(v.agentMessage));
    assert.ok(/gitnexus_(context|cypher)/.test(v.agentMessage));

    // Phase behaviour: stale denies (refresh first); classical_fallback lets it through.
    assert.equal(shell("grep foo src/a.js", { phase: "must_refresh" }).decision, "deny");
    assert.equal(shell("grep bar src/a.js", { phase: "classical_fallback" }).decision, "allow");
  });

  it("classical-fallback escape hatch grants classical tools on a FRESH index", async () => {
    const sp = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
    );
    const { evaluateStalePolicy } = await import(
      new URL("../bundle/.gnkit/lib/stale-policy.mjs", import.meta.url).href
    );
    const { classifyShell } = await import(
      new URL("../bundle/.gnkit/lib/classify.mjs", import.meta.url).href
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
      new URL("../bundle/.gnkit/lib/classify.mjs", import.meta.url).href
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
    assert.match(v.agentMessage, /gitnexus:refresh/);
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
    const CS = new URL("../bundle/.gnkit/lib/check-staleness.mjs", import.meta.url).pathname;
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
      new URL("../bundle/.gnkit/lib/context-pressure.mjs", import.meta.url).href
    );
    const sp = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
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
    fs.mkdirSync(path.join(tmp, ".gnkit"), { recursive: true });
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
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gn-ns-"));
    fs.mkdirSync(path.join(tmp, ".gnkit"), { recursive: true });

    assert.equal(sp.northStarsExists(tmp), false, "inert until the repo opts in");
    assert.deepEqual(sp.northStarsDigest(tmp), []);

    // The filename must NOT be dot-prefixed: the managed .gitignore covers `.gnkit/.gitnexus-*`,
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
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".gitnexus/\n.gnkit/\n");
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

  it("fallback reports persist the reason + graph state for upstream review", async () => {
    const sp = await import(
      new URL("../bundle/.gnkit/lib/session-primer.mjs", import.meta.url).href
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
        "../bundle/.gnkit/lib/session-health-audit.mjs",
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
});
