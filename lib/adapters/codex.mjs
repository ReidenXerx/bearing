/**
 * Codex adapter — OpenAI Codex CLI.
 *
 * SCOPE, stated honestly: Codex reads `AGENTS.md`, which this kit already generates from the same
 * canonical contract every other runtime uses. That is the integration, and it is a real one — the
 * contract carries the north-stars directive, the graph-first rules and the gate discipline.
 *
 * What Codex does NOT get, and why:
 *   - No enforcement GATES. Those are implemented as tool-interception hooks (Claude Code's
 *     PreToolUse). Without an equivalent, a grep cannot be redirected — only discouraged in prose.
 *   - No north-stars RE-ANCHOR and no task-core pressure nudge. Both need a post-tool hook plus
 *     transcript access; the recurring re-injection is what stops the anchor decaying over a long
 *     session, so on Codex the north-stars are read once rather than continuously reinforced.
 *
 * Deliberately NOT wired: MCP. Codex's documented MCP configuration is user-global
 * (~/.codex/config.toml), and this kit never writes outside the target repository — the same reason
 * it leaves ~/.cursor/mcp.json alone. If/when project-scoped MCP config is confirmed, wire it here.
 *
 * This is the same tier as the Zed adapter: contract-level, not gate-level.
 */
import { mergeAgentsMd, removeAgentsMdBlock } from "./zed.mjs";

/** @type {import('./cursor.mjs').Adapter} */
export const codexAdapter = {
  id: "codex",
  wants: (runtime) => /(^|,)(codex|all)(,|$)/.test(String(runtime)),
  choice: {
    key: "4",
    value: "codex",
    label: "Codex — AGENTS.md contract (no tool gates; soft enforcement)",
  },
  // Codex has no skills directory this kit can verify, so nothing is symlinked. Skills still live
  // in .bearing/skills/ and remain readable; they are simply not auto-surfaced.
  skillLinkDir: null,
  gitignoreLines: [],
  backups: [],

  wire(absTarget, { repoName, features }) {
    mergeAgentsMd(absTarget, repoName, features);
  },

  unwire(absTarget) {
    removeAgentsMdBlock(absTarget);
  },

  nextSteps({ features } = {}) {
    return {
      pre: ["Restart Codex in this repo so it re-reads AGENTS.md"],
      post: [
        ...(!features || features.has("gitnexus")
          ? ["Codex gets the CONTRACT, not the gates — no tool interception, so graph-first is advisory here"]
          : []),
        ...(!features || features.has("northstars")
          ? ["North-stars are read at session start but NOT re-anchored mid-session (needs a post-tool hook)"]
          : []),
      ],
    };
  },

  manifestFlags: () => ({ codexManaged: true }),
};
