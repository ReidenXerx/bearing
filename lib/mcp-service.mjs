/**
 * Run the shared GitNexus MCP server as a background service.
 *
 * This is the one place bearing touches something OUTSIDE the target repository, so it is opt-in,
 * asked for explicitly in the installer, reversible with a command we print, and it never touches
 * a service definition it did not write (NS-1). Nothing here needs root: a systemd USER unit, a
 * per-user LaunchAgent, a per-user scheduled task.
 *
 * ── Verification status, stated plainly ──────────────────────────────────────────────────────
 * The systemd and launchd paths are both EXERCISED. The Task Scheduler path is written from its
 * documented behaviour and is UNVERIFIED — there was no Windows machine to run it on, and this
 * project's whole method is that reading code proves nothing (NS-10).
 *
 * The warning that used to stand here was right. When the launchd path was finally run on a Mac
 * it failed exactly as predicted, in the predicted place: an absolute `ProgramArguments` path was
 * not sufficient, because gitnexus is an "env node" shebang script and launchd starts with a
 * minimal PATH that has no version-manager bin dir. `env` could not find `node`, so the agent
 * exited 127 and KeepAlive restarted it forever. `servicePathEnv` is the fix and systemd needed
 * the same treatment. Assume the same class of mistake is still possible on Windows.
 *
 * A second, worse bug came out of the same run: `installService` reported `ok: true, "listening
 * on 127.0.0.1:39100"` for that crash-looping agent, because it only checked that launchctl had
 * LOADED the definition. The caller's whole fallback-to-stdio path was therefore dead code. It
 * now confirms something is actually answering on the port before claiming success — loading a
 * service definition and running a server are not the same event.
 *
 * That is why every platform degrades the same way: if the service cannot be installed or started,
 * `installService` RETURNS a failure rather than throwing, the caller falls back to stdio, and the
 * exact command to run the server by hand is printed. A broken service install must never leave
 * the user worse off than not having tried (NS-8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SERVICE_NAME = "gitnexus-mcp";
/** Reverse-DNS label for launchd, and the scheduled-task name on Windows. */
export const SERVICE_LABEL = "dev.bearing.gitnexus-mcp";
/** Written into every service definition so we can tell ours from the user's. */
export const OWNER_MARKER = "installed by bearing";

/**
 * Absolute path to the gitnexus binary.
 *
 * REQUIRED on every platform, not cosmetic: none of these supervisors inherit your interactive
 * shell's PATH. systemd user services, launchd agents and scheduled tasks all start with a minimal
 * environment, so a bare `gitnexus` fails to launch whenever the binary lives somewhere
 * PATH-dependent — which for Node tooling it usually does (nvm, volta, fnm, nodenv all install
 * under the user's home). Resolving it at install time is what makes the service actually run.
 * @returns {string} absolute path, or the bare name if it cannot be resolved
 */
export function resolveGitnexusBin() {
  // `where` on Windows, `which` elsewhere. No shell: passing args with shell:true concatenates
  // them unescaped, and we gain nothing from a shell here.
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, ["gitnexus"], { encoding: "utf8" });
  const out = (r.stdout || "").trim().split(/\r?\n/)[0];
  if (r.status !== 0 || !out) return "gitnexus";
  // `where` can return several matches; take the first, and accept a drive-letter path too.
  return out.startsWith("/") || /^[A-Za-z]:\\/.test(out) ? out : "gitnexus";
}

/**
 * PATH the supervised process needs, given where the gitnexus binary lives.
 *
 * Resolving the binary to an absolute path is NOT enough, and this is the failure it took a real
 * macOS run to see. Node CLIs are `#!/usr/bin/env node` scripts — gitnexus included — so starting
 * one requires `node` to be findable. systemd units and LaunchAgents both start with a minimal
 * environment that does not include a version manager's bin directory, so `env` could not resolve
 * `node` and launchd logged `env: node: No such file or directory` with `last exit code = 127`,
 * restarting forever.
 *
 * The binary's own directory is exactly where its sibling `node` lives under nvm, volta, fnm and
 * nodenv alike, so putting it first fixes every one of them.
 * @param {string} bin absolute path to the gitnexus binary
 */
export function servicePathEnv(bin) {
  const dirs = [
    path.dirname(bin),
    "/opt/homebrew/bin", // Apple silicon Homebrew
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(dirs.filter((d) => d && d !== "."))].join(":");
}

/**
 * Is something answering on the port? Synchronous on purpose: installService is sync and every
 * caller treats its result as final, so the check has to happen before it returns.
 *
 * Runs the probe in a child because there is no synchronous socket API — cheap next to spawning a
 * service, and it keeps the public signature unchanged.
 * @param {{ port: number, host?: string, timeoutMs?: number }} opts
 */
export function serverListening({ port, host = "127.0.0.1", timeoutMs = 8000 }) {
  const probe = `
    const net = require('node:net');
    const deadline = Date.now() + ${Number(timeoutMs)};
    (function attempt() {
      const s = net.connect({ port: ${Number(port)}, host: ${JSON.stringify(host)} });
      s.on('connect', () => { s.destroy(); process.exit(0); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() >= deadline) process.exit(1);
        setTimeout(attempt, 250);
      });
    })();
  `;
  const r = spawnSync(process.execPath, ["-e", probe], {
    encoding: "utf8",
    timeout: Number(timeoutMs) + 4000,
  });
  return r.status === 0;
}

/** @returns {boolean} can we supervise a process on this machine? */
export function canInstallService() {
  if (process.platform === "linux") {
    return spawnSync("systemctl", ["--user", "--version"], { encoding: "utf8" }).status === 0;
  }
  if (process.platform === "darwin") {
    return spawnSync("launchctl", ["version"], { encoding: "utf8" }).status === 0;
  }
  if (process.platform === "win32") {
    return spawnSync("schtasks", ["/query", "/?"], { encoding: "utf8" }).status === 0;
  }
  return false;
}

/** Where a failed start leaves its evidence — named in the failure message so it is findable. */
function logHint() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Logs", `${SERVICE_NAME}.err.log`);
  }
  if (process.platform === "win32") return "Task Scheduler history";
  return `journalctl --user -u ${SERVICE_NAME}`;
}

/** Where the service definition lives, per platform. */
export function servicePath() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/LaunchAgents", `${SERVICE_LABEL}.plist`);
  }
  if (process.platform === "win32") {
    // Task Scheduler stores tasks itself; this is the launcher script the task invokes, which is
    // also where our ownership marker lives.
    return path.join(home, ".bearing", `${SERVICE_NAME}.cmd`);
  }
  return path.join(home, ".config/systemd/user", `${SERVICE_NAME}.service`);
}

/**
 * systemd user unit. Loopback-only by default — an MCP server with no auth must not be reachable
 * from the network, and `--host 127.0.0.1` is what keeps this a local IPC channel.
 * @param {{ port: number, host?: string, bin?: string }} opts
 */
export function renderUnit({ port, host = "127.0.0.1", bin = resolveGitnexusBin() }) {
  return `[Unit]
Description=GitNexus MCP server (shared, ${OWNER_MARKER})
Documentation=https://github.com/ReidenXerx/bearing
After=network.target

[Service]
Type=simple
# gitnexus is an "env node" shebang script, and a systemd unit gets a minimal PATH that omits
# every version manager's bin dir — so without this the exec fails with 127 (see servicePathEnv).
Environment=PATH=${servicePathEnv(bin)}
# One server for every repository on this machine: it resolves repos per request, so editors and
# agent sessions connect instead of each spawning their own and contending on the index lock.
ExecStart=${bin} mcp --http --port ${port} --host ${host}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

/** XML text escaping for the plist. A path with `&` would otherwise produce an invalid plist. */
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * macOS LaunchAgent. Exercised on macOS 27 — see the file header for what that run turned up.
 *
 * `RunAtLoad` starts it immediately and at login; `KeepAlive.SuccessfulExit=false` is launchd's
 * equivalent of systemd's `Restart=on-failure` (restart unless it exited cleanly). Logs go to the
 * user's own directory because a LaunchAgent's stdout is otherwise discarded, and a server you
 * cannot get logs out of is very hard to debug remotely.
 * @param {{ port: number, host?: string, bin?: string }} opts
 */
export function renderPlist({ port, host = "127.0.0.1", bin = resolveGitnexusBin() }) {
  const logDir = path.join(os.homedir(), "Library/Logs");
  const args = [bin, "mcp", "--http", "--port", String(port), "--host", host];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${OWNER_MARKER} -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xmlEscape(servicePathEnv(bin))}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xmlEscape(path.join(logDir, `${SERVICE_NAME}.log`))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(path.join(logDir, `${SERVICE_NAME}.err.log`))}</string>
</dict>
</plist>
`;
}

/**
 * Windows launcher script the scheduled task runs. UNVERIFIED — see the file header.
 *
 * A .cmd shim rather than putting the command straight in the task: it gives the ownership marker
 * somewhere to live, keeps the quoting in one place instead of nested inside `schtasks /tr`, and
 * makes the whole thing readable when someone later wonders what this task is.
 * @param {{ port: number, host?: string, bin?: string }} opts
 */
export function renderCmdShim({ port, host = "127.0.0.1", bin = resolveGitnexusBin() }) {
  return `@echo off
REM GitNexus MCP server (shared, ${OWNER_MARKER})
REM One server for every repository on this machine.
"${bin}" mcp --http --port ${port} --host ${host}
`;
}

/** Does a service definition already exist that we did NOT write? */
function foreignDefinitionAt(file) {
  if (!fs.existsSync(file)) return false;
  try {
    return !fs.readFileSync(file, "utf8").includes(OWNER_MARKER);
  } catch {
    return true; // unreadable → treat as someone else's and leave it alone
  }
}

/**
 * Install + start the service. Returns a result rather than throwing: a failed service install
 * must not fail the whole kit install — the repo is already configured, and the caller falls back
 * to stdio and prints the manual command (NS-8).
 * @param {{ port: number, host?: string }} opts
 * @returns {{ ok: boolean, detail: string, stopHint: string, verified: boolean }}
 */
export function installService({ port, host = "127.0.0.1" }) {
  const plat = process.platform;
  const stopHint = stopCommand();
  // systemd and launchd have both now been run on real machines; Task Scheduler has not.
  const verified = plat === "linux" || plat === "darwin";
  /** Loading a definition is not the same as the server running. Only claim ok if it answers. */
  const confirm = (label) =>
    serverListening({ port, host })
      ? { ok: true, verified, detail: `listening on ${host}:${port}`, stopHint }
      : {
          ok: false,
          verified,
          detail: `${label} loaded but nothing is listening on ${host}:${port} — check ${logHint()}`,
          stopHint,
        };
  if (!canInstallService()) {
    return {
      ok: false,
      verified,
      detail:
        plat === "linux"
          ? "systemctl --user is unavailable here"
          : plat === "darwin"
            ? "launchctl is unavailable here"
            : plat === "win32"
              ? "schtasks is unavailable here"
              : `${plat} has no supervisor bearing knows how to use`,
      stopHint,
    };
  }

  const file = servicePath();
  if (foreignDefinitionAt(file)) {
    return { ok: false, verified, detail: `${file} exists and is not ours — left alone`, stopHint };
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    if (plat === "linux") {
      fs.writeFileSync(file, renderUnit({ port, host }));
      const run = (args) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
      run(["daemon-reload"]);
      const enabled = run(["enable", "--now", SERVICE_NAME]);
      if (enabled.status !== 0) {
        return {
          ok: false,
          verified,
          detail: (enabled.stderr || "systemctl enable failed").trim().split("\n")[0],
          stopHint,
        };
      }
      return confirm("systemd unit");
    }

    if (plat === "darwin") {
      fs.writeFileSync(file, renderPlist({ port, host }));
      const domain = `gui/${process.getuid?.() ?? ""}`;
      // Replace any previous registration so re-running converges instead of erroring (NS-3).
      spawnSync("launchctl", ["bootout", `${domain}/${SERVICE_LABEL}`], { encoding: "utf8" });
      let r = spawnSync("launchctl", ["bootstrap", domain, file], { encoding: "utf8" });
      if (r.status !== 0) {
        // Pre-Catalina syntax. Older macOS has no `bootstrap`, and failing there for a naming
        // reason rather than a real one would be a silly way to lose the feature.
        r = spawnSync("launchctl", ["load", "-w", file], { encoding: "utf8" });
      }
      if (r.status !== 0) {
        return {
          ok: false,
          verified,
          detail: (r.stderr || "launchctl could not load the agent").trim().split("\n")[0],
          stopHint,
        };
      }
      return confirm("LaunchAgent");
    }

    if (plat === "win32") {
      fs.writeFileSync(file, renderCmdShim({ port, host }));
      // /sc onlogon starts it at each logon; /f overwrites our own task so re-running converges.
      // Note: Task Scheduler has no direct equivalent of Restart=on-failure here — if the server
      // dies mid-session it stays down until next logon. Documented rather than faked.
      const r = spawnSync(
        "schtasks",
        ["/create", "/tn", SERVICE_LABEL, "/tr", `"${file}"`, "/sc", "onlogon", "/f"],
        { encoding: "utf8" },
      );
      if (r.status !== 0) {
        return {
          ok: false,
          verified,
          detail: (r.stderr || r.stdout || "schtasks /create failed").trim().split(/\r?\n/)[0],
          stopHint,
        };
      }
      // /create schedules it for next logon; run it once now so it is usable immediately.
      spawnSync("schtasks", ["/run", "/tn", SERVICE_LABEL], { encoding: "utf8" });
      const res = confirm("scheduled task");
      // Worth restating even on success: Task Scheduler has no Restart=on-failure equivalent, so
      // a server that dies mid-session stays down until next logon.
      return res.ok
        ? { ...res, detail: `${res.detail} (no auto-restart on Windows)` }
        : res;
    }

    return { ok: false, verified, detail: `unsupported platform ${plat}`, stopHint };
  } catch (e) {
    return { ok: false, verified, detail: e.message || String(e), stopHint };
  }
}

/** How the user stops and removes what we installed, per platform. */
export function stopCommand() {
  if (process.platform === "darwin") {
    return `launchctl bootout gui/$(id -u)/${SERVICE_LABEL} && rm ${servicePath()}`;
  }
  if (process.platform === "win32") {
    return `schtasks /delete /tn ${SERVICE_LABEL} /f`;
  }
  return `systemctl --user disable --now ${SERVICE_NAME}`;
}

/** The command to run the server by hand, for anyone we could not set up automatically. */
export function manualCommand({ port, host = "127.0.0.1" }) {
  return `gitnexus mcp --http --port ${port} --host ${host}`;
}
