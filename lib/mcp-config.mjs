/**
 * WHICH MCP TRANSPORT this repo uses, and the config entry for it.
 *
 * GitNexus's MCP server speaks two transports:
 *
 *   stdio — the client spawns `gitnexus mcp` and talks over the pipe. Zero configuration, works
 *           everywhere, and is why it is the default. But stdio is one CHILD PROCESS PER CLIENT by
 *           protocol design, so every editor window and every agent session gets its own server.
 *           Seven were observed on one machine, all watching one index and all auto-refreshing on
 *           staleness — they queued behind a single index lock (600s timeout) and blocked work.
 *
 *   http  — one long-running `gitnexus mcp --http --port N`, every client connects to it. The
 *           server resolves repos per request (`list_repos` / `resolveRepo`), so ONE process
 *           serves every repository on the machine and there is nobody left to contend with.
 *
 * The choice is RECORDED in the install manifest and re-applied on every update. bearing stays
 * authoritative over the entry — it always writes it, which keeps behaviour predictable — but it
 * writes what the user CHOSE rather than a hardcoded default. Before this, a repo deliberately
 * switched to http had that reverted to stdio by the next `bearing update`, silently undoing a
 * whole daemon setup and recreating the pile-up it was installed to fix.
 */

/**
 * Not 3000: that is the CLI's own default and collides with the dev server of roughly every
 * JS project, which is exactly what happened the first time this was set up by hand.
 */
export const DEFAULT_HTTP_PORT = 39100;

/** @typedef {{ mode: 'stdio' } | { mode: 'http', url: string }} McpTransport */

/** The zero-config default: no daemon, no port, works on a fresh machine. */
export const STDIO_TRANSPORT = /** @type {McpTransport} */ ({ mode: "stdio" });

/** @param {number} [port] @param {string} [host] */
export function httpUrl(port = DEFAULT_HTTP_PORT, host = "127.0.0.1") {
  return `http://${host}:${port}/mcp`;
}

/**
 * Normalise whatever we were given — CLI flag, manifest, or nothing — into a transport.
 * Unknown or malformed values fall back to stdio rather than throwing: a malformed manifest must not
 * break an install, and stdio always works (NS-8).
 * @param {unknown} value `'http'`, `'stdio'`, a url, or a stored transport object
 * @returns {McpTransport}
 */
export function parseMcpTransport(value) {
  if (!value) return STDIO_TRANSPORT;
  if (typeof value === "object") {
    const mode = /** @type {any} */ (value).mode;
    const url = /** @type {any} */ (value).url;
    return mode === "http" && url ? { mode: "http", url } : STDIO_TRANSPORT;
  }
  const v = String(value).trim();
  if (!v || v === "stdio") return STDIO_TRANSPORT;
  if (v === "http") return { mode: "http", url: httpUrl() };
  if (/^https?:\/\//.test(v)) return { mode: "http", url: v };
  // A bare port number is the shape people actually type.
  if (/^\d{2,5}$/.test(v)) return { mode: "http", url: httpUrl(Number(v)) };
  return STDIO_TRANSPORT;
}

/**
 * The `mcpServers.gitnexus` entry to write, for either transport.
 *
 * The stdio shape stays `npx -y gitnexus@latest` rather than a resolved binary path: bearing
 * cannot know where gitnexus lives on someone else's machine, and npx works without a global
 * install. Users who want their own build point the entry at it — and because the choice is
 * recorded, that survives updates now.
 * @param {McpTransport} transport
 */
export function mcpEntry(transport = STDIO_TRANSPORT) {
  return transport.mode === "http"
    ? { type: "http", url: transport.url }
    : { command: "npx", args: ["-y", "gitnexus@latest", "mcp"] };
}

/**
 * Is a server actually answering there? Writing an http entry that points at nothing is worse
 * than stdio — every graph call fails instead of being slow — so callers health-check before
 * committing to it and fall back with a reason.
 * @param {string} url @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function httpServerReachable(url, timeoutMs = 1500) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    // An MCP endpoint rejects a bare GET, which is fine: any HTTP response at all proves
    // something is listening and speaking HTTP. Only a connection failure means "not there".
    const res = await fetch(url, { method: "GET", signal: ac.signal }).catch(() => null);
    clearTimeout(t);
    return res !== null;
  } catch {
    return false;
  }
}
