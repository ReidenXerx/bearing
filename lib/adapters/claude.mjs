/**
 * Claude Code adapter — wires the kit into Claude Code (claude.ai/code CLI/IDE).
 * Same Adapter contract as the others; the typedef is in ./contract.mjs.
 *
 *   - MCP    → .mcp.json (project-scoped MCP servers Claude Code auto-loads)
 *   - Hooks  → .claude/settings.json `hooks` (SessionStart brief + PostToolUse intel nudges)
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
import { loadHookConfig } from "../../bundle/.bearing/lib/hook-helpers.mjs";
import { isTracked, STEALTH_CONTRACT_PATH } from "../stealth.mjs";

import { mcpEntry, STDIO_TRANSPORT } from "../mcp-config.mjs";

/** PreToolUse/SessionStart hook commands → Claude project-relative hook scripts. */
/**
 * NO SHELL VARIABLE. Claude Code runs a hook command through whichever shell it finds — Git Bash
 * when present, PowerShell otherwise — and `$CLAUDE_PROJECT_DIR` only expands under a POSIX one. On
 * Windows this failed BOTH ways and there is no single spelling that works in both: under
 * PowerShell `$CLAUDE_PROJECT_DIR` is an undefined PowerShell variable and expands to empty, giving
 * `node "/.claude/hooks/x.mjs"` → `C:\.claude\hooks\x.mjs`; the obvious Windows fix
 * (`$env:CLAUDE_PROJECT_DIR`) then breaks under bash, which expands `$env` and leaves a literal
 * `:CLAUDE_PROJECT_DIR`. Which shell gets picked can change under the user — installing git via
 * scoop flipped one machine between the two on consecutive days.
 *
 * All 13 hooks silently failed to launch there. Hook errors are non-blocking, so the session looked
 * healthy: with `"mode": "enforce"` the guards were absent while appearing installed, which is the
 * worst shape this failure can take.
 *
 * The command line does not need to COMPUTE the root — every hook script already does that itself
 * (`process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()`). It only needs to LOCATE the
 * entry file. 1.2.0 did that with a bare relative path on the reasoning that "Claude Code runs
 * hooks with cwd at the project root", and THAT PREMISE IS FALSE: the hook process is not
 * guaranteed that cwd, and when it differs node cannot resolve the entry and prints a raw
 * `MODULE_NOT_FOUND` loader trace on every single tool call. Measured on a real repo: identical
 * command, exit 0 from the root and exit 1 from a subdirectory. It fixed Windows by trading it for
 * a failure everywhere else — and because hook errors are non-blocking, it degraded exactly as
 * silently as the bug it replaced.
 *
 * So resolve in NODE, not in the shell. `node -e` receives one double-quoted argument containing
 * only single quotes and no `$`, which is the intersection that survives bash, PowerShell and cmd
 * alike — nothing in it is a variable any of them will expand, so #18 stays fixed. Node then reads
 * the environment itself, where `CLAUDE_PROJECT_DIR` is a real value rather than a string a shell
 * has to interpolate, and falls back to cwd when it is absent. pathToFileURL is required, not
 * decorative: a dynamic `import()` of a bare Windows path (`C:\\…`) throws, and a path containing
 * a space breaks without it.
 *
 * Verified from the project root, from a subdirectory, with the variable unset, and with a space in
 * the path. Reported and diagnosed in #18; the regression is #18's own fix.
 */
const HOOK_CMD = (script) =>
  `node -e "import(require('url').pathToFileURL((process.env.CLAUDE_PROJECT_DIR||process.cwd())+'/.claude/hooks/${script}').href)"`;

/** The hook groups this adapter installs, keyed by Claude Code hook event. */
const CLAUDE_HOOKS = {
  // EMPTY ON PURPOSE, and it must stay listed. bearing ships no PreToolUse hook since the GitNexus
  // gates were retired (NS-25, NS-28), but mergeClaudeSettings only visits the events named here —
  // drop the key and an update never strips the five old guard registrations, leaving every Grep,
  // Read, Edit, Bash and MCP call pointed at a script the same update deleted. Listed-and-empty
  // removes bearing's own groups and keeps the user's.
  PreToolUse: [],
  SessionStart: [[null, "bearing-session.mjs"]],
  PreCompact: [[null, "bearing-precompact.mjs"]],
  // Count EDITS since the task-core was last written and nudge a rewrite once they pile up.
  // (It used to estimate context fullness — retired by NS-19, the window is not measurable.)
  // Then re-anchor on the project's NORTH-STARS so long sessions can't drift off the fundamentals.
  PostToolUse: [
    [null, "bearing-taskcore-nudge.mjs"],
    // The minion and microscope nudges are retired: both modules are USER-INVOKED. The hard round
    // of the judgment-layer eval (eval/intel/REPORT-HARD.md) never once saw an agent need a fan-out
    // or a panel at 200 files, and the user is who decides when a change has earned either. Update
    // strips their registrations because PostToolUse stays listed here.
    // Consult shipped as contract text alone, so it fired only when the agent happened to recall
    // it — reported from use as "he doesn't remember it during his usual routines". Same fix the
    // fan-out trigger already got: pose the question at the tool call, not in a doc read an hour ago.
    [null, "bearing-consult-nudge.mjs"],
    [null, "bearing-northstar-anchor.mjs"],
    // `impact` is the pre-edit safety gate, and its known failure mode is a confident LOW derived
    // from callers it could not resolve. Audit the verdict while the result is still on screen.
    ["mcp__gitnexus__impact", "bearing-impact-audit.mjs"],
  ],
};

/**
 * A status line is "ours" if it runs the script we install.
 *
 * Still needed here even though installs no longer WRITE one: an earlier build wired it into the
 * project settings, so uninstall has to be able to take that back out again.
 */
function isOurStatusLine(sl) {
  return /statusline\.sh/.test(sl?.command ?? "");
}

/** A hook group is "ours" if any of its commands runs a gitnexus-* hook script. */
function isOurHookGroup(group) {
  return (group?.hooks ?? []).some((h) =>
    // Match the legacy `gitnexus-` prefix too: an unrecognised group is not filtered out, so a
    // renamed install would keep the OLD entries pointing at deleted files AND add the new ones.
    /\.claude\/hooks\/(bearing|gitnexus)-/.test(h?.command ?? ""),
  );
}

/**
 * Hooks that are registered only while their knob is on. An unregistered hook costs nothing; a
 * registered one that reads its config and exits still spawns node on EVERY tool call (NS-7). So a
 * moment that is off by default is off at the registration, and turning it on takes a `bearing
 * update` — which `bearing status` says next to the knob. The hook still reads the knob itself, so
 * turning one OFF works at once.
 */
export const OPT_IN_HOOKS = { "bearing-consult-nudge.mjs": "consultNudge" };

/**
 * The knob as the hook will read it — the same loader, so registration and hook cannot disagree on
 * a default. It is the package's copy, which is the one this update is about to install.
 */
export function hookKnobOn(absTarget, key) {
  return loadHookConfig(absTarget)[key] === true;
}

function mergeClaudeSettings(absTarget, stealth = false) {
  // Claude Code's per-user settings file. Untracked by convention (it already exists, untracked,
  // in most repos), so hook registration lands somewhere teammates never see.
  const rel = stealth ? ".claude/settings.local.json" : ".claude/settings.json";
  // Only register a hook whose FILE is actually present. The feature filter applies to files, so
  // registering the full set on a filtered install points Claude at missing modules — every Grep,
  // Read, Edit, Bash and MCP call then spawns a node process that dies with ERR_MODULE_NOT_FOUND.
  const installed = (script) =>
    fs.existsSync(path.join(absTarget, ".claude/hooks", script)) &&
    (!(script in OPT_IN_HOOKS) || hookKnobOn(absTarget, OPT_IN_HOOKS[script]));
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
  // NO STATUS LINE HERE. A status line is a SYSTEM-WIDE affordance — one bar, at the bottom of
  // every session, in every project — so a per-repo install has no business writing one. Wiring it
  // in the project settings was wrong twice over: project settings sit above user settings in the
  // precedence chain, so installing bearing in one repo would silently replace whatever the user
  // had configured for themselves; and the guard meant to prevent that read `cfg.statusLine` from
  // the PROJECT file, which cannot see a user-level one, so it would never have fired.
  //
  // It is offered as an explicit, one-time, user-level opt-in instead: `bearing statusline`. The
  // script reads the project dir out of the session payload Claude Code hands it, so ONE copy at
  // `~/.claude/` covers every repo — including repos with no bearing in them, where the index
  // field simply prints nothing.
  writeJson(settingsPath, cfg);
}

/**
 * @param {string} absTarget
 * @param {string} [rel] which settings file — defaults to the shared one.
 */
function removeClaudeSettings(absTarget, rel = ".claude/settings.json") {
  const settingsPath = path.join(absTarget, rel);
  const cfg = readJsonSafe(settingsPath, null);
  if (!cfg) return;
  // Track whether we actually removed anything: a settings file we have nothing to do
  // with must come back out of an uninstall byte-identical, not silently reformatted by
  // a rewrite that changed no content.
  let touched = false;
  // Only our own status line goes. One the user wrote survives an uninstall, exactly as
  // it survives an install.
  if (isOurStatusLine(cfg.statusLine)) {
    delete cfg.statusLine;
    touched = true;
  }
  if (cfg.hooks) {
    // `touched` must mean WE REMOVED SOMETHING, not "a hooks key exists". Set on the mere presence
    // of the key, a settings file made entirely of the user's own hooks was still rewritten — and
    // therefore reformatted — by an uninstall that changed nothing in it, which is exactly what the
    // flag was added to prevent.
    for (const event of Object.keys(CLAUDE_HOOKS)) {
      if (!Array.isArray(cfg.hooks[event])) continue;
      const before = cfg.hooks[event].length;
      cfg.hooks[event] = cfg.hooks[event].filter((g) => !isOurHookGroup(g));
      if (cfg.hooks[event].length !== before) touched = true;
      if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
    }
    if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  }
  if (!touched) return;
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

function mergeMcpJson(absTarget, transport = STDIO_TRANSPORT, gitnexusCmd, stealth = false, gitnexusCmdExplicit = false) {
  const mcpPath = path.join(absTarget, ".mcp.json");
  // A tracked .mcp.json cannot be edited in stealth mode — that edit IS the leak. Creating a new
  // one is fine: it is untracked, and the exclude rules hide it.
  if (stealth && isTracked(absTarget, ".mcp.json")) return { skipped: true };
  const cfg = readJsonSafe(mcpPath, { mcpServers: {} });
  cfg.mcpServers ??= {};
  // The COMMAND follows the same precedence as the transport: a flag on this run, then the
  // committed file, then this machine. `gitnexusCmd` is otherwise resolved from this machine
  // (manifest, or a PATH probe), so a developer without gitnexus on PATH rewrote a team's
  // committed `"command": "gitnexus"` to `npx -y gitnexus@latest` on every update (NS-1).
  const prev = cfg.mcpServers.gitnexus;
  const keepCommitted =
    transport.mode === "stdio" && !gitnexusCmdExplicit && typeof prev?.command === "string";
  if (!keepCommitted) cfg.mcpServers.gitnexus = mcpEntry(transport, gitnexusCmd);
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

/** @type {import('./contract.mjs').Adapter} */
export const claudeAdapter = {
  id: "claude",
  choice: {
    key: "3",
    value: "claude",
    label: "Claude Code — hooks + MCP + skills + CLAUDE.md (nudges fire by themselves)",
  },
  skillLinkDir: ".claude/skills",
  // `.claude/skills/*`, NOT `.claude/skills/` — git cannot re-include anything inside an excluded
  // DIRECTORY, so the trailing-slash form makes the negation below silently do nothing. Verified:
  // with `.claude/skills/` the exception is ignored and the files stay hidden.
  //
  // What is ignored here is OUR symlink farm, which is regenerated per machine and points into the
  // tracked `.bearing/skills/`. GitNexus writes REAL generated area-skills into the same directory
  // and has no tracked home of its own, so ignoring the whole folder meant they reached nobody: a
  // teammate without bearing got no skills at all, and the ones already committed under the old
  // layout showed up as deletions they did not make.
  //
  // `.claude/worktrees/` is where Claude Code puts a subagent spawned with `isolation: "worktree"` —
  // which is how invasive minions work. Unignored, `git status` showed `?? .claude/` mid-fan-out and a
  // `git add -A` would commit each minion's worktree as an embedded repository. Found by running two.
  gitignoreLines: [".claude/skills/*", "!.claude/skills/gitnexus-area-*/", ".claude/worktrees/"],
  backups: [],

  wire(absTarget, { repoName, features, mcpTransport, gitnexusCmd, gitnexusCmdExplicit, persona, personaNote, stealth = false }) {
    // The GitNexus MCP server is the gitnexus module's; wiring it for an intel-only install offers
    // tools the user explicitly declined.
    // Deselecting the module must also UNconfigure the server; wire() only ever added it, so a
    // downgrade left Claude Code launching a graph the user had just turned off.
    if (!features || features.has("gitnexus")) mergeMcpJson(absTarget, mcpTransport, gitnexusCmd, stealth, gitnexusCmdExplicit);
    else stripMcpServer(absTarget);
    mergeClaudeSettings(absTarget, stealth);
    // A repo installed in stealth mode once and shared later kept the stealth registrations in
    // settings.local.json forever: wire() only ever wrote the CURRENT file, while unwire() already
    // knew to clean both. Claude Code merges the two, so every bearing hook ran TWICE — the
    // north-star re-anchor doubled on every doc write — and the retired guards and nudges stayed
    // registered against files the update had deleted, failing on every tool call. Found on this
    // repo, from a September stealth install. A shared install therefore takes back OUR groups from
    // the local file (the user's own hooks stay, and the file goes only if nothing else is in it).
    // The other direction is left alone on purpose: a stealth install must not edit the shared
    // settings.json, which may be the team's.
    if (!stealth) removeClaudeSettings(absTarget, ".claude/settings.local.json");
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
            "Approve the gitnexus MCP server when Claude Code prompts on first run",
            // There is no enforcement to confirm any more (NS-25); say how the graph is reached.
            "GitNexus is opt-in at use, too: ask for it in a prompt (\"use gitnexus to …\") and the bearing-gitnexus skill loads",
          ]
        : [],
    };
  },

  manifestFlags: () => ({ claudeManaged: true }),
};
