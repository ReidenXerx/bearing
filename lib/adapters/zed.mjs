/**
 * Zed adapter — Zed + Ollama wiring for the vendor-agnostic install core.
 * Same Adapter contract as ./cursor.mjs. See that file for the typedef.
 */
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ROOT, substituteRepoName } from "../kit-shared.mjs";
import {
  AGENTS_MARKER_BEGIN,
  AGENTS_MARKER_END,
  ZED_PROFILE_KEY,
  ZED_PROFILE_NAME,
} from "../constants.mjs";
import { readJsonSafe, writeJson, deepMerge } from "./json-util.mjs";

/** Model names this adapter seeds into language_models.ollama — removed on uninstall. */
const SEEDED_OLLAMA_MODELS = ["qwen2.5-coder:14b", "deepseek-r1:14b"];

// Portable MCP entry. MUST NOT bake a machine-specific absolute path (e.g.
// /Users/<someone>/.nvm/.../bin/gitnexus) into the COMMITTED .zed/settings.json:
// Zed project settings win over user settings, so a hardcoded path breaks the MCP
// server for every teammate whose node/gitnexus lives elsewhere. Matches Cursor + Claude.
const MCP_ENTRY = { command: "npx", args: ["-y", "gitnexus@latest", "mcp"] };

function zedGitnexusFragment() {
  return {
    context_servers: {
      gitnexus: { command: MCP_ENTRY.command, args: MCP_ENTRY.args, env: {} },
    },
    agent: {
      profiles: {
        [ZED_PROFILE_KEY]: {
          name: ZED_PROFILE_NAME,
          tools: { grep: false, fetch: false },
          enable_all_context_servers: false,
          context_servers: { gitnexus: { tools: { "*": true } } },
        },
      },
    },
    language_models: {
      ollama: {
        available_models: SEEDED_OLLAMA_MODELS.map((name) => ({
          name,
          display_name:
            name === "qwen2.5-coder:14b"
              ? "Qwen 2.5 Coder 14B (tools)"
              : "DeepSeek R1 14B (tools)",
          supports_tools: true,
        })),
      },
    },
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeZedSettings(absTarget) {
  const settingsPath = path.join(absTarget, ".zed/settings.json");
  const cfg = readJsonSafe(settingsPath, {});
  const merged = deepMerge(cfg, zedGitnexusFragment());
  // Drop legacy profile key (was misleadingly named "GitNexus" only).
  if (merged.agent?.profiles?.gitnexus) delete merged.agent.profiles.gitnexus;
  writeJson(settingsPath, merged);
}

export function mergeAgentsMd(absTarget, repoName) {
  const fragmentPath = path.join(BUNDLE_ROOT, "templates/AGENTS.gitnexus.md");
  const agentsPath = path.join(absTarget, "AGENTS.md");
  const fragment = substituteRepoName(
    fs.readFileSync(fragmentPath, "utf8"),
    repoName,
  );
  const block = `${AGENTS_MARKER_BEGIN}\n${fragment.trim()}\n${AGENTS_MARKER_END}`;
  const existing = fs.existsSync(agentsPath)
    ? fs.readFileSync(agentsPath, "utf8")
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
  fs.writeFileSync(agentsPath, next);
}

export function removeAgentsMdBlock(absTarget) {
  const agentsPath = path.join(absTarget, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) return;
  const re = new RegExp(
    `\n?${escapeRe(AGENTS_MARKER_BEGIN)}[\\s\\S]*?${escapeRe(AGENTS_MARKER_END)}\\n?`,
    "m",
  );
  const next = fs.readFileSync(agentsPath, "utf8").replace(re, "\n").trimEnd();
  if (next) fs.writeFileSync(agentsPath, `${next}\n`);
  else fs.unlinkSync(agentsPath);
}

export function removeZedSettings(absTarget) {
  const settingsPath = path.join(absTarget, ".zed/settings.json");
  const cfg = readJsonSafe(settingsPath, null);
  if (!cfg) return;
  if (cfg.context_servers?.gitnexus) delete cfg.context_servers.gitnexus;
  if (cfg.agent?.profiles?.gitnexus) delete cfg.agent.profiles.gitnexus;
  if (cfg.agent?.profiles?.[ZED_PROFILE_KEY])
    delete cfg.agent.profiles[ZED_PROFILE_KEY];
  // Remove only the models we seeded; leave the user's own Ollama models intact.
  const models = cfg.language_models?.ollama?.available_models;
  if (Array.isArray(models)) {
    cfg.language_models.ollama.available_models = models.filter(
      (m) => !SEEDED_OLLAMA_MODELS.includes(m?.name),
    );
    if (cfg.language_models.ollama.available_models.length === 0)
      delete cfg.language_models.ollama;
  }
  writeJson(settingsPath, cfg);
}

/** @type {import('./cursor.mjs').Adapter} */
export const zedAdapter = {
  id: "zed",
  wants: (runtime) => runtime === "zed" || runtime === "both",
  choice: {
    key: "2",
    value: "zed",
    label: "Zed — MCP + skills + agent profile (Ollama/local friendly)",
  },
  skillLinkDir: ".agents/skills",
  gitignoreLines: [".agents/skills/"],
  backups: [],

  wire(absTarget, { repoName }) {
    mergeZedSettings(absTarget);
    mergeAgentsMd(absTarget, repoName);
  },

  unwire(absTarget) {
    removeZedSettings(absTarget);
    removeAgentsMdBlock(absTarget);
  },

  nextSteps() {
    return {
      pre: ["Restart Zed / reopen project (trust worktree for .agents/skills/)"],
      post: [
        `Agent panel → select profile **${ZED_PROFILE_NAME}**`,
        "For Ollama: pick a model with supports_tools in .zed/settings.json",
      ],
    };
  },

  manifestFlags: () => ({ zedManaged: true }),
};
