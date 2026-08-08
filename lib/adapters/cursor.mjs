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
import { filterContractByFeatures, contractIsEmpty } from "../contract-filter.mjs";
import path from "node:path";
import { readJsonSafe, writeJson } from "./json-util.mjs";
import { BUNDLE_ROOT, substitutePlaceholders } from "../kit-shared.mjs";

import { mcpEntry, STDIO_TRANSPORT } from "../mcp-config.mjs";

/** Per-session runtime files Cursor hooks scribble into .cursor/ — removed on uninstall. */
// Cursor-only artifacts to unlink on uninstall. Shared session state lives under
// .bearing/ and is removed wholesale by the core uninstall (rmRf .bearing).
const CURSOR_RUNTIME_FILES = [".cursor/bearing-teaching-bundle.json"];

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* absent */
  }
}

function restoreBackup(absTarget, bakRel, destRel) {
  // No backup recorded is the NORMAL case — it means the repo had no file of its own at this path
  // when we installed. path.join(root, undefined) throws, and this runs in the FIRST adapter of
  // uninstall's unwire loop, so the throw aborted the whole uninstall: the remaining adapters
  // never ran, leaving hooks registered, the MCP server configured and the manifest in place.
  if (!bakRel) return false;
  const bak = path.join(absTarget, bakRel);
  const dest = path.join(absTarget, destRel);
  if (!fs.existsSync(bak)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(bak, dest);
  fs.unlinkSync(bak);
  return true;
}

/**
 * Write .cursor/rules/00-bearing-enforcement.mdc filtered to the installed modules, preserving the
 * frontmatter Cursor needs (`alwaysApply: true`) and describing only what is actually installed.
 * @param {string} absTarget @param {Set<string>|null|undefined} features
 * @returns {string[]} bundle-relative paths written, for the install manifest
 */
/**
 * Remove just our server from .cursor/mcp.json (and the file if it becomes empty). The user may
 * have their own servers configured there.
 * @param {string} absTarget
 */
function stripCursorMcpServer(absTarget) {
  const mcpPath = path.join(absTarget, ".cursor/mcp.json");
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

function writeCursorContract(absTarget, features, repoName, persona) {
  const rel = ".cursor/rules/00-bearing-enforcement.mdc";
  const src = path.join(BUNDLE_ROOT, rel);
  if (!fs.existsSync(src)) return [];
  // Substitute. This function read the template and wrote it verbatim, so Cursor's always-on rule
  // shipped with three literal `__GITNEXUS_REPO__` placeholders — every Cursor user has been
  // reading a contract with template syntax in it. The bundle COPY path substitutes; this
  // hand-rolled writer bypassed it and nothing compared the two.
  const raw = substitutePlaceholders(fs.readFileSync(src, "utf8"), { repoName, persona });
  const fm = raw.match(/^---\n[\s\S]*?\n---\n/);
  const body = fm ? raw.slice(fm[0].length) : raw;
  const filtered = filterContractByFeatures(body, features ?? null);
  if (contractIsEmpty(filtered)) return [];
  const graph = !features || features.has("gitnexus");
  const description = graph
    ? "North-star contract — graph + embeddings + cypher on every task when fresh, autonomous refresh when stale, classical fallback when GN fails."
    : "bearing contract — the project's north-stars outrank every other doc; keep the task-core current across compaction.";
  const out = `---\ndescription: ${description}\nalwaysApply: true\n---\n\n${filtered}\n`;
  const dest = path.join(absTarget, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  return [rel];
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
    ".cursor/bearing-teaching-bundle.json",
    ".cursor/gn-kit-manifest.json",
  ],
  backups: [
    { rel: ".cursor/hooks.json", bak: ".cursor/hooks.json.bearing.bak" },
    { rel: ".cursor/mcp.json", bak: ".cursor/mcp.json.bearing.bak" },
  ],

  wire(absTarget, { features, mcpTransport = STDIO_TRANSPORT, gitnexusCmd, repoName, persona } = {}) {
    // Cursor's always-on instruction lives in .cursor/rules/, and every rule in the bundle is
    // graph plumbing — so filtering them out left an intel-only Cursor install with the skills
    // installed but nothing telling the agent when to reach for them. Every other runtime gets a
    // feature-filtered contract; write Cursor's the same way. With gitnexus on, the bundle already
    // copied this file and we rewrite it with identical content.
    const wrote = writeCursorContract(absTarget, features, repoName, persona);

    // Registering the gitnexus MCP server in a repo that declined the module makes Cursor launch
    // `npx gitnexus@latest mcp` for a graph nobody asked for.
    if (features && !features.has("gitnexus")) {
      stripCursorMcpServer(absTarget);
      return wrote;
    }
    const mcpPath = path.join(absTarget, ".cursor/mcp.json");
    const cfg = readJsonSafe(mcpPath, { mcpServers: {} });
    cfg.mcpServers ??= {};
    cfg.mcpServers.gitnexus = mcpEntry(mcpTransport, gitnexusCmd);
    writeJson(mcpPath, cfg);
    return wrote;
  },

  unwire(absTarget, manifest = {}) {
    // hooks.json: restore pre-install backup if we made one, else remove ours.
    if (restoreBackup(absTarget, manifest.backups?.["hooks.json"], ".cursor/hooks.json")) {
      // A manifest written before the backup fix can point at a backup of OUR OWN file, taken on a
      // reinstall. Restoring that re-registers hooks whose scripts this uninstall just deleted, so
      // Cursor fails a spawn on every session start, prompt and tool call — forever, in a repo the
      // user believes is clean. The file names the scripts, so the evidence is in the file itself.
      const hooksPath = path.join(absTarget, ".cursor/hooks.json");
      try {
        if (/[.]cursor\/hooks\/bearing-/.test(fs.readFileSync(hooksPath, "utf8"))) {
          unlinkQuiet(hooksPath);
        }
      } catch {
        /* unreadable or already gone */
      }
    } else {
      unlinkQuiet(path.join(absTarget, ".cursor/hooks.json"));
    }
    // mcp.json: restore the backup, THEN strip our server from whatever is now there — both, not
    // either/or, so uninstall converges on "no gitnexus server of ours" even when the restored
    // backup is one of ours.
    if (manifest.mcpManaged ?? true) {
      restoreBackup(absTarget, manifest.backups?.["mcp.json"], ".cursor/mcp.json");
      const mcpPath = path.join(absTarget, ".cursor/mcp.json");
      const cfg = readJsonSafe(mcpPath, null);
      if (cfg?.mcpServers?.gitnexus) {
        // Only if the entry is the one WE write. A user who ran their own gitnexus server before
        // installing bearing gets it back from the backup, and it must survive our cleanup.
        const ours = JSON.stringify(mcpEntry(manifest.mcpTransport, manifest.gitnexusCmd));
        if (JSON.stringify(cfg.mcpServers.gitnexus) === ours) {
          delete cfg.mcpServers.gitnexus;
          if (Object.keys(cfg.mcpServers).length === 0 && Object.keys(cfg).length === 1) {
            unlinkQuiet(mcpPath);
          } else {
            writeJson(mcpPath, cfg);
          }
        }
      }
    }
    for (const rel of CURSOR_RUNTIME_FILES) unlinkQuiet(path.join(absTarget, rel));
    // Install creates .cursor/ in repos that never had one; leaving the empty shell behind means
    // uninstall did not restore what it found. rmdir refuses a non-empty directory, so anything of
    // the user's still in there keeps it — deepest first, since .cursor/ can only go once
    // .cursor/rules/ has.
    for (const rel of [".cursor/rules", ".cursor/hooks", ".cursor"]) {
      try {
        fs.rmdirSync(path.join(absTarget, rel));
      } catch {
        /* holds their files, or is already gone */
      }
    }
  },

  nextSteps({ features } = {}) {
    const gn = !features || features.has("gitnexus");
    return {
      pre: [
        gn
          ? "Restart Cursor on this project (MCP + hooks load on restart)"
          : "Restart Cursor on this project (skills load on restart)",
      ],
      post: ["Open a new Agent chat"],
    };
  },

  manifestFlags: () => ({ mcpManaged: true }),
};
