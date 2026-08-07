/**
 * Zed adapter — Zed + Ollama wiring for the vendor-agnostic install core.
 * Same Adapter contract as ./cursor.mjs. See that file for the typedef.
 */
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ROOT, substituteRepoName, substitutePlaceholders } from "../kit-shared.mjs";
import { filterContractByFeatures } from "../contract-filter.mjs";
import { mcpEntry, STDIO_TRANSPORT } from "../mcp-config.mjs";
import {
  AGENTS_MARKER_BEGIN,
  AGENTS_MARKER_END,
  ZED_PROFILE_KEY,
  ZED_PROFILE_NAME,
  agentsBlockSource,
} from "../constants.mjs";
import { readJsonSafe, writeJson, deepMerge } from "./json-util.mjs";

/** Model names this adapter seeds into language_models.ollama — removed on uninstall. */
const SEEDED_OLLAMA_MODELS = ["qwen2.5-coder:14b", "deepseek-r1:14b"];

/**
 * Zed's MCP entry.
 *
 * It must stay PORTABLE — Zed project settings win over user settings, so baking a
 * machine-specific absolute path into a COMMITTED .zed/settings.json breaks the server for every
 * teammate whose node lives elsewhere. That is why this is a bare command, not a resolved path.
 *
 * But it was also a hardcoded `npx -y gitnexus@latest`, which ignored the transport and the binary
 * the operator chose — the only adapter of the three that did. Because project settings override
 * user settings, that entry SUPERSEDED a correctly configured global one and made Zed spawn its
 * own npx-cached copy of the published analyzer. Observed on a real machine: Zed running
 * `analyze` out of ~/Library/Application Support/Zed/node/cache/_npx against the same index a
 * bearing refresh was writing.
 *
 * `gitnexusCmd` is a bare name (`gitnexus`) rather than a path, so honouring it keeps the entry
 * portable and stops the npx-cache spawn.
 * @param {import('../mcp-config.mjs').McpTransport} transport
 * @param {string} [gitnexusCmd]
 */
function zedMcpEntry(transport, gitnexusCmd) {
  // Zed's `context_servers` values are an UNTAGGED enum — the variant is chosen by which fields
  // are present, so there is no `source`/`type` discriminator to set. Confirmed against Zed 1.14:
  // the settings struct carries a remote variant keyed on `url` (alongside `headers`/`oauth`),
  // and `url` cannot be mistaken for the local variant because that one requires `command`.
  //
  // This matters beyond tidiness: Zed project settings WIN over user settings, so the entry
  // written here decides what Zed actually runs. Leaving it on stdio meant Zed kept spawning its
  // own analyzer against the same index the shared server was already serving.
  if (transport?.mode === "http" && transport.url) return { url: transport.url };
  const entry = mcpEntry(STDIO_TRANSPORT, gitnexusCmd);
  return { command: entry.command, args: entry.args, env: {} };
}

function zedGitnexusFragment(transport = STDIO_TRANSPORT, gitnexusCmd) {
  return {
    context_servers: {
      gitnexus: zedMcpEntry(transport, gitnexusCmd),
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

function mergeZedSettings(absTarget, transport, gitnexusCmd) {
  const settingsPath = path.join(absTarget, ".zed/settings.json");
  const cfg = readJsonSafe(settingsPath, {});
  // deepMerge would UNION the old and new arg arrays, leaving a hybrid command line. The entry is
  // ours and bearing is authoritative for it, so replace it outright.
  if (cfg.context_servers?.gitnexus) delete cfg.context_servers.gitnexus;
  const merged = deepMerge(cfg, zedGitnexusFragment(transport, gitnexusCmd));
  // Drop legacy profile key (was misleadingly named "GitNexus" only).
  if (merged.agent?.profiles?.gitnexus) delete merged.agent.profiles.gitnexus;
  writeJson(settingsPath, merged);
}

export function mergeAgentsMd(absTarget, repoName, features = null, persona) {
  const fragmentPath = path.join(BUNDLE_ROOT, "templates/AGENTS.gitnexus.md");
  const agentsPath = path.join(absTarget, "AGENTS.md");
  // Drop the sections whose module was not installed — otherwise the always-on contract tells the
  // agent to run graph tools and npm scripts this repo does not have (NS-13).
  const fragment = filterContractByFeatures(
    substitutePlaceholders(fs.readFileSync(fragmentPath, "utf8"), { repoName, persona }),
    features,
  );
  const block = `${AGENTS_MARKER_BEGIN}\n${fragment.trim()}\n${AGENTS_MARKER_END}`;
  const existing = fs.existsSync(agentsPath)
    ? fs.readFileSync(agentsPath, "utf8")
    : "";
  const next = replaceManagedBlock(existing, block);
  fs.writeFileSync(agentsPath, next);
}

/**
 * Swap the kit's managed block for `block`, in place, whichever marker wrote it.
 *
 * Replacing the FIRST match keeps the block where the user's file already had it; dropping any
 * further matches is what makes a repeat install converge (NS-3) instead of accumulating one block
 * per rename.
 * @param {string} existing @param {string} block
 */
export function replaceManagedBlock(existing, block) {
  const re = new RegExp(agentsBlockSource(), "gm");
  if (!re.test(existing)) {
    return existing.trim() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }
  re.lastIndex = 0;
  let first = true;
  return existing.replace(re, () => {
    if (!first) return "";
    first = false;
    return `${block}\n`;
  });
}

export function removeAgentsMdBlock(absTarget) {
  const agentsPath = path.join(absTarget, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) return;
  // Global: an uninstall must not leave a block written under an older marker behind.
  const re = new RegExp(agentsBlockSource("\\n?"), "gm");
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

  wire(absTarget, { repoName, features, mcpTransport = STDIO_TRANSPORT, gitnexusCmd, persona }) {
    // The Zed profile exists to disable grep and enable the gitnexus MCP server; without that
    // module it would disable grep and offer nothing in its place.
    if (!features || features.has("gitnexus")) {
      mergeZedSettings(absTarget, mcpTransport, gitnexusCmd);
    }
    mergeAgentsMd(absTarget, repoName, features, persona);
  },

  unwire(absTarget) {
    removeZedSettings(absTarget);
    removeAgentsMdBlock(absTarget);
  },

  nextSteps({ features, mcpTransport } = {}) {
    const gn = !features || features.has("gitnexus");
    const mcpHttp = mcpTransport?.mode === "http";
    return {
      pre: ["Restart Zed / reopen project (trust worktree for .agents/skills/)"],
      // The profile is only written with the gitnexus module, so naming it otherwise sends the
      // user hunting through the Agent panel for something that was never created.
      post: gn
        ? [
            `Agent panel → select profile **${ZED_PROFILE_NAME}**`,
            "For Ollama: pick a model with supports_tools in .zed/settings.json",
            ...(mcpHttp
              ? ["Zed connects to the shared MCP server over http — it no longer spawns its own"]
              : []),
          ]
        : [],
    };
  },

  manifestFlags: () => ({ zedManaged: true }),
};
