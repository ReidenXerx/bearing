/**
 * Cursor adapter — IDE-specific wiring for the vendor-agnostic install core.
 *
 * The core (lib/kit.mjs) knows nothing about Cursor; it loops over the active
 * adapters and calls this contract. To add a new IDE, add a sibling module with
 * the same shape and register it in ./index.mjs — no core edits required.
 *
 * @typedef {Object} Adapter
 * @property {string} id
 * @property {(runtime: import('../constants.mjs').Runtime) => boolean} wants
 * @property {{ key: string, value: string, label: string }} choice  Interactive picker entry.
 * @property {string|null} skillLinkDir  Repo-relative dir to symlink the skill store into.
 * @property {string[]} gitignoreLines   IDE-specific .gitignore entries.
 * @property {{ rel: string, bak: string }[]} backups  Files to back up before bundle copy.
 * @property {(absTarget: string, ctx: { repoName: string }) => void} wire
 * @property {(absTarget: string, manifest: Record<string, any>) => void} unwire
 * @property {(ctx: { repoName: string }) => { pre: string[], post: string[] }} nextSteps
 * @property {(manifest: Record<string, any>) => Record<string, any>} manifestFlags
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonSafe, writeJson } from "./json-util.mjs";

const MCP_ENTRY = { command: "npx", args: ["-y", "gitnexus@latest", "mcp"] };

/** Per-session runtime files Cursor hooks scribble into .cursor/ — removed on uninstall. */
// Cursor-only artifacts to unlink on uninstall. Shared session state lives under
// .bearing/ and is removed wholesale by the core uninstall (rmRf .bearing).
const CURSOR_RUNTIME_FILES = [".cursor/gitnexus-teaching-bundle.json"];

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* absent */
  }
}

function restoreBackup(absTarget, bakRel, destRel) {
  const bak = path.join(absTarget, bakRel);
  const dest = path.join(absTarget, destRel);
  if (!fs.existsSync(bak)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(bak, dest);
  fs.unlinkSync(bak);
  return true;
}

/** @type {Adapter} */
export const cursorAdapter = {
  id: "cursor",
  wants: (runtime) => runtime === "cursor" || runtime === "both",
  choice: {
    key: "1",
    value: "cursor",
    label: "Cursor — hooks + MCP + skills (hard enforcement)",
  },
  skillLinkDir: ".cursor/skills",
  // Shared .bearing/ session state is ignored by the core base snippet; these are
  // the Cursor-specific paths only.
  gitignoreLines: [
    ".cursor/skills/",
    ".cursor/gitnexus-teaching-bundle.json",
    ".cursor/gn-kit-manifest.json",
  ],
  backups: [
    { rel: ".cursor/hooks.json", bak: ".cursor/hooks.json.gn-kit.bak" },
    { rel: ".cursor/mcp.json", bak: ".cursor/mcp.json.gn-kit.bak" },
  ],

  wire(absTarget) {
    const mcpPath = path.join(absTarget, ".cursor/mcp.json");
    const cfg = readJsonSafe(mcpPath, { mcpServers: {} });
    cfg.mcpServers ??= {};
    cfg.mcpServers.gitnexus = MCP_ENTRY;
    writeJson(mcpPath, cfg);
  },

  unwire(absTarget, manifest = {}) {
    // hooks.json: restore pre-install backup if we made one, else remove ours.
    if (!restoreBackup(absTarget, manifest.backups?.["hooks.json"], ".cursor/hooks.json")) {
      unlinkQuiet(path.join(absTarget, ".cursor/hooks.json"));
    }
    // mcp.json: restore backup, else strip just the gitnexus server.
    if (manifest.mcpManaged ?? true) {
      const mcpBak = manifest.backups?.["mcp.json"];
      if (!restoreBackup(absTarget, mcpBak, ".cursor/mcp.json")) {
        const mcpPath = path.join(absTarget, ".cursor/mcp.json");
        const cfg = readJsonSafe(mcpPath, null);
        if (cfg?.mcpServers?.gitnexus) {
          delete cfg.mcpServers.gitnexus;
          if (Object.keys(cfg.mcpServers).length === 0) unlinkQuiet(mcpPath);
          else writeJson(mcpPath, cfg);
        }
      }
    }
    for (const rel of CURSOR_RUNTIME_FILES) unlinkQuiet(path.join(absTarget, rel));
  },

  nextSteps() {
    return {
      pre: ["Restart Cursor on this project (MCP + hooks load on restart)"],
      post: ["Open a new Agent chat"],
    };
  },

  manifestFlags: () => ({ mcpManaged: true }),
};
