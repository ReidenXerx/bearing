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
import { BUNDLE_ROOT, substitutePlaceholders } from "../kit-shared.mjs";
import { filterContractByFeatures } from "../contract-filter.mjs";
import {
  AGENTS_MARKER_BEGIN,
  AGENTS_MARKER_END,
  agentsBlockSource,
} from "../constants.mjs";
import { replaceManagedBlock } from "./zed.mjs";
import { readJsonSafe, writeJson } from "./json-util.mjs";
import { isTracked, STEALTH_CONTRACT_PATH } from "../stealth.mjs";

import { mcpEntry, STDIO_TRANSPORT } from "../mcp-config.mjs";

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
    // Serial grinding is the moment the fan-out trigger is actionable; a contract read an hour
    // ago is not. Nudges once per session, never blocks (NS-5).
    [null, "bearing-minion-nudge.mjs"],
    [null, "bearing-northstar-anchor.mjs"],
    // `impact` is the pre-edit safety gate, and its known failure mode is a confident LOW derived
    // from callers it could not resolve. Audit the verdict while the result is still on screen.
    ["mcp__gitnexus__impact", "bearing-impact-audit.mjs"],
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

function mergeClaudeSettings(absTarget, stealth = false) {
  // Claude Code's per-user settings file. Untracked by convention (it already exists, untracked,
  // in most repos), so hook registration lands somewhere teammates never see.
  const rel = stealth ? ".claude/settings.local.json" : ".claude/settings.json";
  // Only register a hook whose FILE is actually present. The feature filter applies to files, so
  // registering the full set on a filtered install points Claude at missing modules — every Grep,
  // Read, Edit, Bash and MCP call then spawns a node process that dies with ERR_MODULE_NOT_FOUND.
  const installed = (script) =>
    fs.existsSync(path.join(absTarget, ".claude/hooks", script));
  const settingsPath = path.join(absTarget, rel);
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

/**
 * @param {string} absTarget
 * @param {string} [rel] which settings file — defaults to the shared one.
 */
function removeClaudeSettings(absTarget, rel = ".claude/settings.json") {
  const settingsPath = path.join(absTarget, rel);
  const cfg = readJsonSafe(settingsPath, null);
  if (!cfg?.hooks) return;
  for (const event of Object.keys(CLAUDE_HOOKS)) {
    if (!Array.isArray(cfg.hooks[event])) continue;
    cfg.hooks[event] = cfg.hooks[event].filter((g) => !isOurHookGroup(g));
    if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
  }
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  // Same rule as removeMcpJson below: if our hooks were the only thing in there, the file is ours
  // and an empty `{}` is litter. Anything else in it is the user's, so the file stays.
  if (Object.keys(cfg).length === 0) {
    try {
      fs.unlinkSync(settingsPath);
    } catch {
      /* best effort — never fail an uninstall on a leftover */
    }
    return;
  }
  writeJson(settingsPath, cfg);
}

function mergeMcpJson(absTarget, transport = STDIO_TRANSPORT, gitnexusCmd, stealth = false) {
  const mcpPath = path.join(absTarget, ".mcp.json");
  // A tracked .mcp.json cannot be edited in stealth mode — that edit IS the leak. Creating a new
  // one is fine: it is untracked, and the exclude rules hide it.
  if (stealth && isTracked(absTarget, ".mcp.json")) return { skipped: true };
  const cfg = readJsonSafe(mcpPath, { mcpServers: {} });
  cfg.mcpServers ??= {};
  cfg.mcpServers.gitnexus = mcpEntry(transport, gitnexusCmd);
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

/**
 * Remove just our server from .mcp.json, and the file itself if that leaves it empty — a user may
 * have their own servers in there, so never delete it wholesale.
 * @param {string} absTarget
 */
function stripMcpServer(absTarget) {
  const mcpPath = path.join(absTarget, ".mcp.json");
  if (!fs.existsSync(mcpPath)) return;
  const cfg = readJsonSafe(mcpPath, null);
  if (!cfg?.mcpServers?.gitnexus) return;
  delete cfg.mcpServers.gitnexus;
  if (Object.keys(cfg.mcpServers).length === 0 && Object.keys(cfg).length === 1) {
    fs.unlinkSync(mcpPath);
  } else {
    writeJson(mcpPath, cfg);
  }
}

function mergeClaudeMd(absTarget, repoName, features = null, persona, personaNote, stealth = false) {
  const fragmentPath = path.join(BUNDLE_ROOT, "templates/CLAUDE.gitnexus.md");
  const claudePath = path.join(absTarget, "CLAUDE.md");
  // Drop the sections whose module was not installed — otherwise the always-on contract tells the
  // agent to run graph tools and npm scripts this repo does not have (NS-13).
  const fragment = filterContractByFeatures(
    substitutePlaceholders(fs.readFileSync(fragmentPath, "utf8"), { repoName, persona, personaNote }),
    features,
  );
  // STEALTH: CLAUDE.md is tracked, so the contract goes to a file the SessionStart hook reads and
  // injects instead. Same text, delivered per session rather than committed.
  if (stealth) {
    const dest = path.join(absTarget, STEALTH_CONTRACT_PATH);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${fragment.trim()}\n`);
    // RETURNED so the caller can record it. A file we create and do not record is a file uninstall
    // cannot take back — 21KB of generated contract survived every stealth uninstall for exactly
    // this reason (NS-22: record what you create, at the moment you create it).
    return [STEALTH_CONTRACT_PATH];
  }
  const block = `${AGENTS_MARKER_BEGIN}\n${fragment.trim()}\n${AGENTS_MARKER_END}`;
  const existing = fs.existsSync(claudePath)
    ? fs.readFileSync(claudePath, "utf8")
    : "";
  // Shared with the Zed adapter: both write this block, so both must recognise a block written
  // under an older marker and replace it rather than append a second one beside it.
  const next = replaceManagedBlock(existing, block);
  fs.writeFileSync(claudePath, next);
}

function removeClaudeMdBlock(absTarget) {
  const claudePath = path.join(absTarget, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) return;
  // Global: an uninstall must not leave a block written under an older marker behind.
  const re = new RegExp(agentsBlockSource("\\n?"), "gm");
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

  wire(absTarget, { repoName, features, mcpTransport, gitnexusCmd, persona, personaNote, stealth = false }) {
    // The GitNexus MCP server is the gitnexus module's; wiring it for an intel-only install offers
    // tools the user explicitly declined.
    // Deselecting the module must also UNconfigure the server; wire() only ever added it, so a
    // downgrade left Claude Code launching a graph the user had just turned off.
    if (!features || features.has("gitnexus")) mergeMcpJson(absTarget, mcpTransport, gitnexusCmd, stealth);
    else stripMcpServer(absTarget);
    mergeClaudeSettings(absTarget, stealth);
    return mergeClaudeMd(absTarget, repoName, features, persona, personaNote, stealth) ?? [];
  },

  unwire(absTarget) {
    removeMcpJson(absTarget);
    // BOTH files, and not gated on the manifest's stealth flag. mergeClaudeSettings writes to
    // settings.local.json under stealth and settings.json otherwise, so a repo that was installed
    // one way and re-installed the other carries our hooks in both. Reading the flag would clean
    // only the last mode and leave the other registering guards whose scripts this uninstall has
    // just deleted — a failed spawn on every session start, prompt and tool call, in a repo the
    // user believes is clean. Only OUR hook groups are stripped, so cleaning both is safe and
    // idempotent whichever way it was installed.
    removeClaudeSettings(absTarget, ".claude/settings.json");
    removeClaudeSettings(absTarget, ".claude/settings.local.json");
    removeClaudeMdBlock(absTarget);
  },

  nextSteps({ features, hasScripts = true } = {}) {
    const gn = !features || features.has("gitnexus");
    return {
      pre: [
        gn
          ? "Restart Claude Code / run `claude` in this repo (MCP + hooks load on start)"
          : "Restart Claude Code / run `claude` in this repo (hooks load on start)",
      ],
      post: gn
        ? [
            hasScripts
              ? "Confirm enforcement is live: `npm run bearing:agent-status`"
              : "Confirm enforcement is live: `node scripts/bearing-agent.mjs status`",
            "Approve the gitnexus MCP server when Claude Code prompts on first run",
          ]
        : [],
    };
  },

  manifestFlags: () => ({ claudeManaged: true }),
};
