/**
 * Codex adapter — OpenAI Codex CLI.
 *
 * SCOPE, stated honestly: Codex reads `AGENTS.md`, which this kit already generates from the same
 * canonical contract every other runtime uses. That is the integration, and it is a real one — the
 * contract carries the north-stars directive and every installed module's rules.
 *
 * What Codex does NOT get, and why:
 *   - No north-stars RE-ANCHOR and no task-core pressure nudge. Both need a post-tool hook plus
 *     transcript access; the recurring re-injection is what stops the anchor decaying over a long
 *     session, so on Codex the north-stars are read once rather than continuously reinforced.
 *
 * Deliberately NOT wired: MCP. Codex's documented MCP configuration is user-global
 * (~/.codex/config.toml), and this kit never writes outside the target repository.
 * If/when project-scoped MCP config is confirmed, wire it here.
 *
 * This is the same tier as the Zed adapter: content only — no hooks.
 */
import { mergeAgentsMd, removeAgentsMdBlock } from "./zed.mjs";

/** @type {import('./contract.mjs').Adapter} */
export const codexAdapter = {
  id: "codex",
  choice: {
    key: "4",
    value: "codex",
    label: "Codex — AGENTS.md contract (no hooks: the rules are there, nothing fires by itself)",
  },
  // Codex has no skills directory this kit can verify, so nothing is symlinked. Skills still live
  // in .bearing/skills/ and remain readable; they are simply not auto-surfaced.
  skillLinkDir: null,
  gitignoreLines: [],
  backups: [],

  wire(absTarget, { repoName, features, persona, personaNote }) {
    // Codex shares zed.mjs's AGENTS.md writer, so it must pass the persona too. It did not, and
    // because `--runtime all` runs codex AFTER zed, it overwrote zed's correct block with one
    // carrying the neutral fallback — the last writer silently won.
    mergeAgentsMd(absTarget, repoName, features, persona, personaNote);
  },

  unwire(absTarget) {
    removeAgentsMdBlock(absTarget);
  },

  nextSteps({ features } = {}) {
    return {
      pre: ["Restart Codex in this repo so it re-reads AGENTS.md"],
      post: [
        ...(!features || features.has("gitnexus")
          ? ["GitNexus is not wired for Codex: its MCP config is user-global, so add the gitnexus server there yourself to use the graph"]
          : []),
        ...(!features || features.has("northstars")
          ? ["North-stars are read at session start but NOT re-anchored mid-session (needs a post-tool hook)"]
          : []),
      ],
    };
  },

  manifestFlags: () => ({ codexManaged: true }),
};
