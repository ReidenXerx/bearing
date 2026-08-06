/**
 * Run the shared GitNexus MCP server as a background service.
 *
 * This is the one place bearing touches something OUTSIDE the target repository, so it is opt-in,
 * asked for explicitly in the installer, and reversible with a command we print (NS-1). It is a
 * systemd USER unit — no root, no system-wide state, nothing that survives the user's account.
 *
 * Linux only, deliberately. macOS launchd and Windows scheduled tasks are separate mechanisms with
 * separate failure modes, and shipping two untested ones would be worse than shipping none: the
 * config is still written there and the exact command to run is printed, which is honest about
 * what happened. Adding them later is additive.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SERVICE_NAME = "gitnexus-mcp";

/**
 * Absolute path to the gitnexus binary.
 *
 * REQUIRED, not cosmetic: a systemd user service does not inherit your shell's PATH, so a bare
 * `ExecStart=gitnexus` fails to start whenever the binary lives somewhere PATH-dependent — which
 * for Node tooling it usually does (nvm, volta, fnm all install under the user's home). Resolving
 * it at install time is what makes the unit actually run.
 * @returns {string} absolute path, or the bare name if it cannot be resolved
 */
export function resolveGitnexusBin() {
  // `which`, not `command -v` through a shell: passing args with shell:true concatenates them
  // unescaped, which Node now warns about, and we gain nothing from a shell here.
  const r = spawnSync("which", ["gitnexus"], { encoding: "utf8" });
  const out = (r.stdout || "").trim().split("\n")[0];
  return r.status === 0 && out.startsWith("/") ? out : "gitnexus";
}

/** @returns {boolean} can we actually supervise a process on this machine? */
export function canInstallService() {
  if (process.platform !== "linux") return false;
  const r = spawnSync("systemctl", ["--user", "--version"], { encoding: "utf8" });
  return r.status === 0;
}

/** Where the unit file goes. */
export function unitPath() {
  return path.join(os.homedir(), ".config/systemd/user", `${SERVICE_NAME}.service`);
}

/**
 * The unit. Loopback-only by default — an MCP server with no auth must not be reachable from the
 * network, and `--host 127.0.0.1` is what keeps this a local IPC channel rather than an open port.
 * @param {{ port: number, host?: string, bin?: string }} opts
 */
export function renderUnit({ port, host = "127.0.0.1", bin = resolveGitnexusBin() }) {
  return `[Unit]
Description=GitNexus MCP server (shared, installed by bearing)
Documentation=https://github.com/ReidenXerx/bearing
After=network.target

[Service]
Type=simple
# One server for every repository on this machine: it resolves repos per request, so editors and
# agent sessions connect instead of each spawning their own and contending on the index lock.
ExecStart=${bin} mcp --http --port ${port} --host ${host}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

/**
 * Install + start the unit. Returns a result rather than throwing: a failed service install must
 * not fail the whole kit install — the repo is already configured and the user can start the
 * server by hand (NS-8).
 * @param {{ port: number, host?: string }} opts
 * @returns {{ ok: boolean, detail: string, stopHint: string }}
 */
export function installService({ port, host = "127.0.0.1" }) {
  const stopHint = `systemctl --user disable --now ${SERVICE_NAME}`;
  if (!canInstallService()) {
    return {
      ok: false,
      detail:
        process.platform === "linux"
          ? "systemctl --user is unavailable here"
          : `${process.platform} needs launchd/Task Scheduler, which bearing does not write`,
      stopHint,
    };
  }
  try {
    const unit = unitPath();
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    // Never clobber a unit the user wrote or tuned. Theirs may point at a different build or port,
    // and silently rewriting it is the same class of bug as overwriting their MCP entry.
    if (fs.existsSync(unit) && !fs.readFileSync(unit, "utf8").includes("installed by bearing")) {
      return { ok: false, detail: `${unit} exists and is not ours — left alone`, stopHint };
    }
    fs.writeFileSync(unit, renderUnit({ port, host }));
    const run = (args) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
    run(["daemon-reload"]);
    const enabled = run(["enable", "--now", SERVICE_NAME]);
    if (enabled.status !== 0) {
      return {
        ok: false,
        detail: (enabled.stderr || "systemctl enable failed").trim().split("\n")[0],
        stopHint,
      };
    }
    return { ok: true, detail: `listening on ${host}:${port}`, stopHint };
  } catch (e) {
    return { ok: false, detail: e.message || String(e), stopHint };
  }
}

/** The command to run the server by hand, for platforms we do not supervise. */
export function manualCommand({ port, host = "127.0.0.1" }) {
  return `gitnexus mcp --http --port ${port} --host ${host}`;
}
