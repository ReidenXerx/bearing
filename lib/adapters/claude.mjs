/**
 * Claude Code adapter — wires the kit into Claude Code (claude.ai/code CLI/IDE).
 * Same Adapter contract as ./cursor.mjs.
 *
 *   - MCP    → .mcp.json (project-scoped MCP servers Claude Code auto-loads)
 *   - Hooks  → .claude/settings.json `hooks` (PreToolUse guards + SessionStart brief)
 *   - Skills → .claude/skills/ (symlinked store)
 *   - Always-on contract → CLAUDE.md (generated from the canonical contract)
 */
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ROOT, substituteRepoName } from "../kit-shared.mjs";
import { filterContractByFeatures } from "../contract-filter.mjs";
import { AGENTS_MARKER_BEGIN, AGENTS_MARKER_END } from "../constants.mjs";
import { readJsonSafe, writeJson } from "./json-util.mjs";

const MCP_ENTRY = { command: "npx", args: ["-y", "gitnexus@latest", "mcp"] };

/** PreToolUse/SessionStart hook commands → Claude project-relative hook scripts. */
const HOOK_CMD = (script) =>
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${script}"`;

/** The hook groups this adapter installs, keyed by Claude Code hook event. */
const CLAUDE_HOOKS = {
  PreToolUse: [
    ["Grep|Glob", "bearing-grep-guard.mjs"],
    ["Read", "bearing-read-guard.mjs"],
    ["Edit|Write|MultiEdit", "bearing-edit-guard.mjs"],
    ["Bash", "bearing-bash-guard.mjs"],
    ["mcp__gitnexus__.*", "bearing-mcp-guard.mjs"],
  ],
  SessionStart: [[null, "bearing-session.mjs"]],
  PreCompact: [[null, "bearing-precompact.mjs"]],
  // Estimate context fullness after each tool; near auto-compaction, nudge a TASK-CORE refresh.
  // Then re-anchor on the project's NORTH-STARS so long sessions can't drift off the fundamentals.
  PostToolUse: [
    [null, "bearing-context-pressure.mjs"],
    [null, "bearing-northstar-anchor.mjs"],
  ],
};

/** A hook group is "ours" if any of its commands runs a gitnexus-* hook script. */
function isOurHookGroup(group) {
  return (group?.hooks ?? []).some((h) =>
    // Match the legacy `gitnexus-` prefix too: an unrecognised group is not filtered out, so a
    // renamed install would keep the OLD entries pointing at deleted files AND add the new ones.
    /\.claude\/hooks\/(bearing|gitnexus)-/.test(h?.command ?? ""),
  );
}

function mergeClaudeSettings(absTarget) {
  // Only register a hook whose FILE is actually present. The feature filter applies to files, so
  // registering the full set on a filtered install points Claude at missing modules — every Grep,
  // Read, Edit, Bash and MCP call then spawns a node process that dies with ERR_MODULE_NOT_FOUND.
  const installed = (script) =>
    fs.existsSync(path.join(absTarget, ".claude/hooks", script));
  const settingsPath = path.join(absTarget, ".claude/settings.json");
  const cfg = readJsonSafe(settingsPath, {});
  cfg.hooks ??= {};
  for (const [event, groups] of Object.entries(CLAUDE_HOOKS)) {
    const existing = (cfg.hooks[event] ?? []).filter((g) => !isOurHookGroup(g));
    const ours = groups
      .filter(([, script]) => installed(script))
      .map(([matcher, script]) => ({
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: "command", command: HOOK_CMD(script) }],
      }));
    cfg.hooks[event] = [...existing, ...ours];
    if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
  }
  writeJson(settingsPath, cfg);
}

function removeClaudeSettings(absTarget) {
  const settingsPath = path.join(absTarget, ".claude/settings.json");
  const cfg = readJsonSafe(settingsPath, null);
  if (!cfg?.hooks) return;
  for (const event of Object.keys(CLAUDE_HOOKS)) {
    if (!Array.isArray(cfg.hooks[event])) continue;
    cfg.hooks[event] = cfg.hooks[event].filter((g) => !isOurHookGroup(g));
    if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
  }
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  writeJson(settingsPath, cfg);
}

function mergeMcpJson(absTarget) {
  const mcpPath = path.join(absTarget, ".mcp.json");
  const cfg = readJsonSafe(mcpPath, { mcpServers: {} });
  cfg.mcpServers ??= {};
  cfg.mcpServers.gitnexus = MCP_ENTRY;
  writeJson(mcpPath, cfg);
}

function removeMcpJson(absTarget) {
  const mcpPath = path.join(absTarget, ".mcp.json");
  const cfg = readJsonSafe(mcpPath, null);
  if (!cfg?.mcpServers?.gitnexus) return;
  delete cfg.mcpServers.gitnexus;
  if (Object.keys(cfg.mcpServers).length === 0) {
    try {
      fs.unlinkSync(mcpPath);
    } catch {
      /* ignore */
    }
  } else {
    writeJson(mcpPath, cfg);
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeClaudeMd(absTarget, repoName, features = null) {
  const fragmentPath = path.join(BUNDLE_ROOT, "templates/CLAUDE.gitnexus.md");
  const claudePath = path.join(absTarget, "CLAUDE.md");
  // Drop the sections whose module was not installed — otherwise the always-on contract tells the
  // agent to run graph tools and npm scripts this repo does not have (NS-13).
  const fragment = filterContractByFeatures(
    substituteRepoName(fs.readFileSync(fragmentPath, "utf8"), repoName),
    features,
  );
  const block = `${AGENTS_MARKER_BEGIN}\n${fragment.trim()}\n${AGENTS_MARKER_END}`;
  const existing = fs.existsSync(claudePath)
    ? fs.readFileSync(claudePath, "utf8")
    : "";
  const re = new RegExp(
    `${escapeRe(AGENTS_MARKER_BEGIN)}[\\s\\S]*?${escapeRe(AGENTS_MARKER_END)}\\n?`,
    "m",
  );
  const next = existing.match(re)
    ? existing.replace(re, `${block}\n`)
    : existing.trim()
      ? `${existing.trimEnd()}\n\n${block}\n`
      : `${block}\n`;
  fs.writeFileSync(claudePath, next);
}

function removeClaudeMdBlock(absTarget) {
  const claudePath = path.join(absTarget, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) return;
  const re = new RegExp(
    `\n?${escapeRe(AGENTS_MARKER_BEGIN)}[\\s\\S]*?${escapeRe(AGENTS_MARKER_END)}\\n?`,
    "m",
  );
  const next = fs.readFileSync(claudePath, "utf8").replace(re, "\n").trimEnd();
  if (next) fs.writeFileSync(claudePath, `${next}\n`);
  else fs.unlinkSync(claudePath);
}

/** @type {import('./cursor.mjs').Adapter} */
export const claudeAdapter = {
  id: "claude",
  wants: (runtime) => /(^|,)(claude|all)(,|$)/.test(String(runtime)),
  choice: {
    key: "3",
    value: "claude",
    label: "Claude Code — hooks + MCP + skills + CLAUDE.md (hard enforcement)",
  },
  skillLinkDir: ".claude/skills",
  gitignoreLines: [".claude/skills/"],
  backups: [],

  wire(absTarget, { repoName, features }) {
    // The GitNexus MCP server is the gitnexus module's; wiring it for an intel-only install offers
    // tools the user explicitly declined.
    if (!features || features.has("gitnexus")) mergeMcpJson(absTarget);
    mergeClaudeSettings(absTarget);
    mergeClaudeMd(absTarget, repoName, features);
  },

  unwire(absTarget) {
    removeMcpJson(absTarget);
    removeClaudeSettings(absTarget);
    removeClaudeMdBlock(absTarget);
  },

  nextSteps({ features } = {}) {
    const gn = !features || features.has("gitnexus");
    return {
      pre: [
        gn
          ? "Restart Claude Code / run `claude` in this repo (MCP + hooks load on start)"
          : "Restart Claude Code / run `claude` in this repo (hooks load on start)",
      ],
      post: gn
        ? [
            "Confirm enforcement is live: `npm run bearing:agent-status`",
            "Approve the gitnexus MCP server when Claude Code prompts on first run",
          ]
        : [],
    };
  },

  manifestFlags: () => ({ claudeManaged: true }),
};
