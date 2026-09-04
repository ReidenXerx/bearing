/**
 * POST-CONDITION CHECKS — run at the end of every install and update.
 *
 * Why this exists, stated plainly: bearing used to assert outcomes it never observed. A single
 * session found nine defects in the install path and a human running `npx bearing` would have been
 * told about none of them. Three of the nine printed SUCCESS while broken — the macOS service
 * announced "listening on 127.0.0.1:39100" for an agent that was crash-looping on exit 127, the
 * CLI exited 0 having installed nothing when its own path crossed a symlink, and every generated
 * script silently reverted to `npx gitnexus@latest` after the installer had just written the
 * operator's chosen binary.
 *
 * The existing verifier could not have caught any of them: it asks "does this file exist", and
 * every one of those failures had all the right files in all the right places with the wrong
 * CONTENT. Presence is not correctness.
 *
 * So the rule these checks encode: **every line the installer prints is a claim, and a claim must
 * be checked against the disk, not against what the code intended to do.** Each check below exists
 * because a real defect shipped through the gap it now covers; the comment on each names it.
 *
 * This lives in lib/ rather than the shipped bundle on purpose. `scripts/bearing-verify.mjs` is
 * owned by the gitnexus feature, so an intel-only install had no verification whatsoever — the
 * configuration least likely to be exercised by the author was also the least checked.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { MANIFEST_PATH, MANIFEST_PATHS_LEGACY, AGENTS_MARKER_BEGIN } from "./constants.mjs";
import { runtimeIds } from "./kit-shared.mjs";
import { readJsonSafe } from "./adapters/json-util.mjs";
import { PLACEHOLDER, PERSONA_PLACEHOLDER } from "./kit-shared.mjs";

/** @typedef {{ id: string, ok: boolean, label: string, detail: string, fatal?: boolean }} Finding */

const read = (root, rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
};
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/**
 * Every gitnexus invocation in package.json must name the RECORDED binary.
 *
 * The defect: `bearing-setup.sh` re-runs the in-repo script merge at step 7, after the installer
 * wrote the operator's choice at step 5, and rebuilt all 16 commands from the bare default. The
 * manifest said `gitnexus`, the scripts said `npx gitnexus@latest`, and nothing compared them.
 */
function checkScriptsUseRecordedBinary(root, gitnexusCmd) {
  const pkg = readJsonSafe(path.join(root, "package.json"), null);
  const scripts = pkg?.scripts ?? {};
  const ours = Object.entries(scripts).filter(([k]) => /^(bearing|gitnexus):/.test(k));
  if (!ours.length) return null; // no scripts installed (intel-only) — nothing to assert
  const want = (gitnexusCmd || "gitnexus").trim();
  // Only the commands that actually SPAWN gitnexus matter; the rest run node helpers.
  const spawners = ours.filter(([, v]) => /\bgitnexus\b/.test(v) && !/^node /.test(v.trim()));
  // Compare the INVOCATION SHAPE, not a substring. `"npx gitnexus@latest".includes("gitnexus")` is
  // true, so a substring test could never fail — a vacuous assertion of exactly the kind that let
  // four defects ship under green tests here before (NS-9). npx-vs-PATH is also the distinction
  // that actually matters: npx never consults PATH, it fetches and caches its own copy, so the two
  // forms run genuinely different programs while printing the same version string.
  const wantsNpx = /\bnpx\b/.test(want);
  const wrong = spawners.filter(([, v]) => /\bnpx\b/.test(v) !== wantsNpx);
  return {
    id: "scripts_binary",
    ok: wrong.length === 0,
    label: "npm scripts call the recorded gitnexus",
    detail: wrong.length
      ? `${wrong.length}/${spawners.length} call something else, e.g. ${wrong[0][0]} -> ${wrong[0][1].slice(0, 60)}`
      : `${spawners.length} scripts -> \`${want}\``,
  };
}

/**
 * RUN the read-only commands bearing just installed. Not their shape — them.
 *
 * `scripts_binary` above compares invocation shape and never executes anything, so a command could
 * be named correctly and still be broken. Every defect of that kind this file exists to catch got
 * through: `bearing --version` answered "Missing target repo path"; `bearing install --stealth`
 * died on "Not a git repository: /cwd/--stealth"; and on a CLAUDE-ONLY install three shipped
 * reporters failed on Cursor files it was never supposed to have, signing off with "restart Cursor".
 * That last one was found by writing this check, before it was even wired in.
 *
 * Only reporters — nothing that indexes, writes or spawns the analyzer — and each is bounded, so the
 * whole pass costs well under a second on a real repo (measured: 38–263ms each).
 * @param {string} root @param {Set<string>} features
 */
/** The runtime recorded at install, or "" when unknowable. */
function manifestRuntime(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".bearing/manifest.json"), "utf8")).runtime || "";
  } catch {
    return "";
  }
}

function checkCommandsRun(root, features) {
  // ctx.features is absent when runPostChecks is called bare (tests, ad-hoc). Treat unknown as
  // "check it" rather than throwing inside a checker whose whole job is catching breakage.
  if (features && !features.has("gitnexus")) {
    return { id: "commands_run", ok: true, label: "installed commands run", detail: "no graph module" };
  }
  const agent = path.join(root, "scripts/bearing-agent.mjs");
  if (!fs.existsSync(agent)) {
    return { id: "commands_run", ok: true, label: "installed commands run", detail: "no scripts installed" };
  }
  // Read-only reporters. `refresh`, `map` and the analyze wrappers are deliberately absent: this
  // runs at the end of an install and must not start indexing anything.
  const SAFE = ["status", "health", "verify", "doctor", "brief", "branch-status", "scorecard"];
  const broken = [];
  // These wrappers create a project-local scratch dir on first run. A check that leaves litter in
  // the repository it is checking is not a check — the uninstall test caught `.tmp-agent` surviving
  // an uninstall purely because this had run and created it.
  const tmpDir = path.join(root, ".tmp-agent");
  const tmpExisted = fs.existsSync(tmpDir);
  // Which runtimes this install actually covers. This used to expand the aliases with its own
  // copy of the table, which then drifted: it still read `both` as cursor+zed and `all` as
  // including cursor, months after `both` became zed+claude. A second table is a second answer —
  // ask the installer's (NS-2's lesson, in miniature: computed, never hand-maintained).
  const installed = runtimeIds(manifestRuntime(root) || "");
  for (const c of SAFE) {
    const r = spawnSync(process.execPath, [agent, c], {
      cwd: root,
      encoding: "utf8",
      timeout: 20000,
    });
    // A non-zero exit is NOT automatically a defect. At install time there is no index yet, so these
    // reporters correctly say so and exit 1 — that is the command working. What this is looking for
    // is a command that CRASHED: a stack trace, or nothing at all where a diagnostic belongs.
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    // "Ran" means: produced its report without blowing up. Exit code alone does not decide it —
    // several of these legitimately exit 1 to signal a stale index, in prose, with a fix attached.
    // An earlier version required a ✓/✗ marker in the output and flagged the three that report in
    // plain sentences, which is the check inventing a convention its own commands do not follow.
    const crashed =
      r.status === null || // killed or timed out
      /^\s*(?:[A-Za-z]*Error|Uncaught|node:internal)/m.test(out) ||
      /\n\s+at .+:\d+:\d+/.test(out) || // a stack trace
      !out.trim(); // silence where a report belongs
    // A well-formed report about a runtime this repo never installed is the other failure mode, and
    // the one crash-detection cannot see: on a CLAUDE-only install three reporters failed on Cursor
    // files, exiting 1 with a tidy ✗ list and "restart Cursor". Every line of that is the command
    // working perfectly and being wrong (NS-6 — advice for a problem that does not exist).
    for (const other of ["cursor", "zed", "codex"]) {
      if (installed.has(other)) continue;
      const line = out
        .split("\n")
        .find((l) => /[✗]/.test(l) && new RegExp(other, "i").test(l));
      if (line) broken.push(`${c}: complains about ${other}, which is not installed — ${line.trim().slice(0, 60)}`);
    }
    if (crashed) {
      const first = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /Error|Cannot|undefined|not a function/.test(l));
      broken.push(`${c}: ${first ? first.slice(0, 70) : `exit ${r.status ?? "timeout"}, no output`}`);
    }
  }
  if (!tmpExisted) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort — it is gitignored either way */
    }
  }
  return {
    id: "commands_run",
    ok: broken.length === 0,
    label: "installed commands run",
    detail: broken.length ? `${broken.length} failed: ${broken.join("; ").slice(0, 160)}` : `${SAFE.length} reporters exit 0`,
  };
}

/**
 * Every runtime's MCP entry must match the recorded transport AND binary.
 *
 * Three separate defects landed here: setup overwrote .cursor/mcp.json with a hardcoded npx stdio
 * entry, the Zed adapter hardcoded the same and (because Zed project settings beat user settings)
 * overrode a correctly configured global one, and neither was compared against the manifest.
 */
function checkMcpEntries(root, { mcpTransport, gitnexusCmd }) {
  const want = mcpTransport?.mode === "http" ? mcpTransport.url : null;
  const bin = (gitnexusCmd || "gitnexus").split(/\s+/)[0];
  /** @type {[string, any][]} */
  const entries = [];
  const claude = readJsonSafe(path.join(root, ".mcp.json"), null);
  if (claude?.mcpServers?.gitnexus) entries.push([".mcp.json", claude.mcpServers.gitnexus]);
  const cursor = readJsonSafe(path.join(root, ".cursor/mcp.json"), null);
  if (cursor?.mcpServers?.gitnexus) entries.push([".cursor/mcp.json", cursor.mcpServers.gitnexus]);
  const zed = readJsonSafe(path.join(root, ".zed/settings.json"), null);
  if (zed?.context_servers?.gitnexus) entries.push([".zed/settings.json", zed.context_servers.gitnexus]);
  if (!entries.length) return null;

  const bad = [];
  for (const [file, e] of entries) {
    if (want) {
      // Zed is the documented exception only if it cannot do http; today it can, so all three
      // must be remote when the repo chose http.
      if (e.url !== want) bad.push(`${file} is not pointed at ${want}`);
    } else if (!e.command || !String(e.command).includes(bin)) {
      bad.push(`${file} spawns ${e.command ?? "?"} ${(e.args ?? []).join(" ")}`.trim());
    }
  }
  return {
    id: "mcp_entries",
    ok: bad.length === 0,
    label: "MCP entries match the recorded choice",
    detail: bad.length ? bad.join("; ") : `${entries.length} runtime(s) -> ${want ?? bin}`,
  };
}

/**
 * If the repo is pointed at a shared http server, something must actually answer there.
 *
 * The defect: installService reported ok for a LaunchAgent that never started, so the repo was
 * configured against a dead port. A broken http entry fails EVERY graph call, which is worse than
 * the per-client contention it was meant to solve.
 */
function checkHttpServerReachable(mcpTransport) {
  if (mcpTransport?.mode !== "http" || !mcpTransport.url) return null;
  const probe = `
    const {url} = {url: ${JSON.stringify(mcpTransport.url)}};
    fetch(url, {method:'GET', signal: AbortSignal.timeout(2500)})
      .then(() => process.exit(0)).catch(() => process.exit(1));
  `;
  const r = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", timeout: 8000 });
  const port = Number(new URL(mcpTransport.url).port) || 39100;
  return {
    id: "mcp_http_live",
    ok: r.status === 0,
    label: "shared MCP server answers",
    detail:
      r.status === 0
        ? mcpTransport.url
        : `nothing answering at ${mcpTransport.url} — every graph call will fail until it is up`,
    // Environmental, not a bearing defect: say what to DO rather than ask for a bug report.
    environmental: true,
    hint: `start it with \`gitnexus mcp --http --port ${port}\`, or re-run with --mcp stdio`,
  };
}

/**
 * Machine-local state must not be committable.
 *
 * The defect: three separate ignore gaps meant git would take the agent's in-flight task-core, a
 * session flag, and ~30 install backups into the repo's history. The backups are the dangerous
 * one — uninstall RESTORES from them, so committing them corrupts a later uninstall.
 */
function checkMachineLocalIgnored(root) {
  const isRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
  if (isRepo.status !== 0) return null;
  const mustIgnore = [
    ".bearing/manifest.json",
    ".bearing/.bearing-session-primed.flag",
    ".bearing/.gitnexus-scorecard.json",
    ".bearing/.task-core.md",
    ".bearing/task-cores/a-chat-id.md",
    ".bearing/lib/anything.mjs.bearing-backup",
    ".bearing/hooks.local.json",
  ];
  // A file git already TRACKS is never reported as ignored, however good the rule is. That is the
  // case this check actually hits in the field — a repo installed before the rule existed committed
  // the file once, and every later version's .gitignore is powerless. Saying only "would be
  // committed" sends the user to edit a .gitignore that is already correct, so name the real cause
  // and the one command that fixes it (NS-6: a problem must come with its exit).
  const leaked = [];
  for (const rel of mustIgnore) {
    if (spawnSync("git", ["check-ignore", "-q", rel], { cwd: root }).status === 0) continue;
    const tracked =
      spawnSync("git", ["ls-files", "--error-unmatch", rel], { cwd: root }).status === 0;
    leaked.push({ rel, tracked });
  }
  const tracked = leaked.filter((l) => l.tracked).map((l) => l.rel);
  const untracked = leaked.filter((l) => !l.tracked).map((l) => l.rel);
  const parts = [];
  if (tracked.length) {
    parts.push(
      `already COMMITTED, so the ignore rule cannot help — run \`git rm --cached ${tracked.join(" ")}\``,
    );
  }
  if (untracked.length) parts.push(`would be committed: ${untracked.join(", ")}`);
  return {
    id: "local_state_ignored",
    ok: leaked.length === 0,
    label: "machine-local state is gitignored",
    detail: leaked.length ? parts.join("; ") : "manifest, session state, task-core, backups",
  };
}

/** Exactly one managed block per agent doc — a marker rename once appended a second one. */
function checkSingleManagedBlock(root, stealth = false) {
  // In stealth we deliberately write NO block into CLAUDE.md/AGENTS.md — they are tracked, and the
  // contract is delivered by the SessionStart hook instead. Demanding a block here would fail every
  // correct stealth install.
  if (stealth) return null;
  const bad = [];
  for (const f of ["AGENTS.md", "CLAUDE.md"]) {
    const t = read(root, f);
    if (t === null) continue;
    const n = (t.match(new RegExp(AGENTS_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    const legacy = (t.match(/<!-- gitnexus-agent-kit:BEGIN -->/g) ?? []).length;
    if (n !== 1 || legacy) bad.push(`${f}: ${n} current + ${legacy} legacy block(s)`);
  }
  return bad.length
    ? { id: "agent_docs", ok: false, label: "one managed block per agent doc", detail: bad.join("; ") }
    : { id: "agent_docs", ok: true, label: "one managed block per agent doc", detail: "AGENTS.md / CLAUDE.md" };
}

/** Nothing from a previous naming may survive — two manifests that disagree is worse than one. */
function checkNoLegacyArtifacts(root) {
  const left = [];
  for (const rel of MANIFEST_PATHS_LEGACY) if (exists(root, rel)) left.push(rel);
  if (exists(root, ".gnkit")) left.push(".gnkit/");
  return {
    id: "no_legacy",
    ok: left.length === 0,
    label: "no legacy layout left behind",
    detail: left.length ? `still present: ${left.join(", ")}` : "clean",
  };
}

/**
 * A declined module must leave NO trace (NS-13).
 *
 * The defect: writing the manifest into `.gitnexus/` created the graph tool's index directory in
 * repos that had explicitly refused the graph module — a fifth leak channel NS-13 does not list.
 */
function checkDeclinedModulesAbsent(root, features) {
  if (!features || features.has("gitnexus")) return null;
  const traces = [];
  if (exists(root, ".gitnexus")) traces.push(".gitnexus/");
  if (exists(root, ".gitnexusignore")) traces.push(".gitnexusignore");
  if (exists(root, ".mcp.json")) {
    const c = readJsonSafe(path.join(root, ".mcp.json"), null);
    if (c?.mcpServers?.gitnexus) traces.push(".mcp.json gitnexus entry");
  }
  const gi = read(root, ".gitignore") ?? "";
  if (gi.split("\n").some((l) => l.trim() === ".gitnexus/")) traces.push(".gitignore names .gitnexus/");
  return {
    id: "declined_clean",
    ok: traces.length === 0,
    label: "declined modules left no trace",
    detail: traces.length ? `gitnexus was not selected but: ${traces.join(", ")}` : "gitnexus fully absent",
  };
}

/** Every file the manifest claims must actually be on disk. */
function checkManifestFilesPresent(root, manifest) {
  const files = manifest?.files ?? [];
  const missing = files.filter((rel) => !exists(root, rel));
  return {
    id: "files_present",
    ok: missing.length === 0,
    label: "recorded files are on disk",
    detail: missing.length ? `${missing.length} missing, e.g. ${missing[0]}` : `${files.length} files`,
  };
}

/**
 * Anything an installed file tells the machine to RUN must exist.
 *
 * The defect this closes was found by a reviewer, not by us: the shipped CI workflow ran
 * `node scripts/gitnexus-ci.mjs` while the bundle installs `scripts/bearing-ci.mjs`, so the merge
 * gate failed with "Cannot find module" on every pull request — a check that looked configured and
 * never once ran. It survived a rename sweep because every file was present and correct on its
 * own; only the reference BETWEEN two files was wrong, and `files_present` cannot see that.
 *
 * Only executable artifacts are scanned. Docs mention commands illustratively and would produce
 * false positives, and a false alarm here trains people to ignore the whole report (NS-5).
 */
function checkNoDanglingReferences(root, manifest) {
  // A stealth install adds NO npm scripts — package.json is tracked — so `npm run bearing:*` in a
  // shipped script's help text is absent by design, not by mistake. Reporting ~20 of those would
  // bury the half of this check that still matters: a `node <script>` path that does not resolve.
  const skipNpm = Boolean(manifest?.stealth);
  const pkg = readJsonSafe(path.join(root, "package.json"), null);
  const scripts = new Set(Object.keys(pkg?.scripts ?? {}));
  const runnable = (manifest?.files ?? []).filter((rel) =>
    /^(\.github\/workflows\/.*\.ya?ml|\.githooks\/[^/]+|scripts\/.*\.(sh|mjs))$/.test(rel),
  );
  const dangling = [];

  // The CONTRACT is the exception to "docs are illustrative". CLAUDE.md, AGENTS.md and the Cursor
  // rule are the agent's always-on instructions, so a command named there is one the agent will
  // actually run. An intel-only install shipped "Print them anytime: `npm run bearing:northstars`"
  // while installing neither the script nor `scripts/`, because every npm script is owned by the
  // gitnexus module — the northstars module advertising a command you only get with a DIFFERENT
  // module (NS-13, NS-20). Note these are checked even when package.json has no scripts at all:
  // that is not the uninteresting case, it is exactly the broken one.
  for (const rel of ["CLAUDE.md", "AGENTS.md"]) {
    const body = read(root, rel);
    if (body === null) continue;
    for (const m of body.matchAll(/\bnpm\s+run\s+([\w.:-]+)/g)) {
      const name = m[1].replace(/[.,;:]+$/, "");
      if (!scripts.has(name)) {
        dangling.push(`${rel} tells the agent to run \`npm run ${name}\` (not installed)`);
      }
    }
  }

  for (const rel of runnable) {
    const body = read(root, rel);
    if (body === null) continue;
    // `node path/to/script.mjs`
    // (the npm half of this loop is skipped under stealth — see skipNpm below)
    for (const m of body.matchAll(/\bnode\s+(?:"([^"]+\.mjs)"|'([^']+\.mjs)'|([\w./-]+\.mjs))/g)) {
      const target = (m[1] ?? m[2] ?? m[3]).replace(/^\.\//, "");
      if (target.startsWith("$") || target.includes("${")) continue; // interpolated at runtime
      // A GUARDED reference is not a claim either, for the same reason interpolation is not: it
      // says "if this is here". The teaching sync smoke-tests the Claude grep guard behind
      // `[[ -f .claude/hooks/bearing-grep-guard.mjs ]]`, and a zed-only install — which is never
      // given that file — failed on it. A correct install reported broken is what NS-5 weighs
      // heaviest, and the guard is the file already saying what this check wants to know.
      if (guardsPath(body, target)) continue;
      if (!exists(root, target)) dangling.push(`${rel} runs ${target} (absent)`);
    }
    if (skipNpm) continue; // stealth installs no npm scripts; see skipNpm
    // `npm run some:script`. The class must include `.`: the gate-doc entries are real
    // package.json keys named `bearing.__gate.1.session`, and stopping at the dot reported a
    // truncated `bearing` as undefined — a false alarm, which is the failure mode that gets a
    // whole report ignored (NS-5). Trailing punctuation from prose is trimmed for the same reason.
    for (const m of body.matchAll(/\bnpm\s+run\s+([\w.:-]+)/g)) {
      // A GLOB is a description, not a command. `npm run bearing:*` in a code comment captured
      // `bearing:`, lost its colon to the punctuation trim above, and failed the install with
      // "runs `npm run bearing` (not defined)" — a script nobody had claimed existed. Same class as
      // the truncation this trim was written for, and the same cost: a false alarm here fails a
      // whole install and gets the real findings ignored (NS-5).
      if (body[m.index + m[0].length] === "*") continue;
      const name = m[1].replace(/[.,;:]+$/, "");
      if (scripts.size && !scripts.has(name)) dangling.push(`${rel} runs \`npm run ${name}\` (not defined)`);
    }
  }
  return {
    id: "no_dangling_refs",
    ok: dangling.length === 0,
    label: "installed files reference commands that exist",
    detail: dangling.length ? dangling.slice(0, 3).join("; ") : `${runnable.length} executable file(s) checked`,
  };
}

/**
 * Does this file test for that path before using it? Shell `[[ -f p ]]` / `[ -e p ]`, and node's
 * `existsSync("p")`. Deliberately literal and same-file: a guard somewhere else is not a guard.
 * @param {string} body @param {string} target
 */
function guardsPath(body, target) {
  const lit = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:\\[\\[?\\s*-[a-z]\\s+["']?${lit}|existsSync\\(\\s*["'\`]${lit})`).test(body);
}

/**
 * The persona reached the contract, and no template syntax leaked into a user-facing file.
 *
 * Both halves matter. An unresolved `__BEARING_PERSONA__` would sit in CLAUDE.md — the first file
 * every agent reads — advertising a broken install. And a contract with no persona line at all
 * means the domain expertise silently reverted to the microscope-only behaviour this replaced.
 */
function checkPersonaResolved(root, stealth = false) {
  // In stealth the contract is .bearing/contract.md, injected by the SessionStart hook, because
  // CLAUDE.md is tracked. Look there too or this check fails on a correct stealth install.
  const stealthContract = read(root, ".bearing/contract.md");
  // Only files BEARING WRITES. In stealth CLAUDE.md and AGENTS.md are the user's — untouched by
  // design — so including them made a correct install fail for lacking a line we never added.
  const docs = (
    stealth
      ? [".bearing/contract.md"]
      : ["CLAUDE.md", "AGENTS.md"]
  ).filter((f) => exists(root, f));
  if (!docs.length) return null;
  // EVERY placeholder, not just the persona one. This check exists because `__GITNEXUS_REPO__`
  // shipped verbatim in the Cursor rule for an unknown number of releases — and the first version
  // of the check looked only for `__BEARING_PERSONA__`, so it would not have caught the very bug it
  // was written for. Listed from the exported constants so adding a placeholder cannot silently
  // add a blind spot: substitution and verification read the same source.
  const leaked = docs.flatMap((f) => {
    const text = read(root, f) ?? "";
    return [PERSONA_PLACEHOLDER, PLACEHOLDER]
      .filter((ph) => text.includes(ph))
      .map((ph) => `${f} (${ph})`);
  });
  const d = readJsonSafe(path.join(root, ".bearing/domain.json"), null);
  const missing = docs.filter((f) => !/You are working as \*\*/.test(read(root, f) ?? ""));
  const problems = [];
  if (leaked.length) problems.push(`unsubstituted placeholder in ${leaked.join(", ")}`);
  if (!d?.persona) problems.push(".bearing/domain.json missing or has no persona");
  if (missing.length) problems.push(`no persona line in ${missing.join(", ")}`);
  return {
    id: "persona",
    ok: problems.length === 0,
    label: "domain persona reached the contract",
    detail: problems.length ? problems.join("; ") : `${d.persona} (${docs.length} doc(s))`,
  };
}


/**
 * A stealth install must leave the repository EXACTLY as clean as it found it.
 *
 * This is the mode's entire promise, so it gets the check rather than the documentation. Anything
 * bearing wrote that git can still see is a leak: a modified tracked file, or an untracked path the
 * exclude rules missed. Both are committable by accident, which for someone who chose stealth
 * precisely to avoid that is the worst possible outcome.
 */
function checkStealthInvisible(root, manifest) {
  if (!manifest?.stealth) return null;
  const r = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  // Paths bearing owns outright: if git can see any of them, an exclude rule is missing.
  // `.mcp.json` is here because bearing CREATES it when the repo has none. Leaving it out of this
  // set is how a real stealth install shipped with `?? .mcp.json` visible: the check reasoned that
  // an untracked merge-target was harmless, when in fact untracked-and-unexcluded is the leak.
  const OURS =
    /^(\.bearing\/|\.claude\/|\.cursor\/|\.agents\/|\.zed\/|\.githooks\/|\.vscode\/|\.gitnexus|\.tmp-agent\/|\.mcp\.json$|scripts\/bearing|docs\/(GITNEXUS|TEAM-BUNDLE|ARCHITECTURE\.gitnexus))/;
  // Files bearing MERGES into. These are pre-existing and tracked, so any modification is a leak
  // however small — this is the set stealth mode exists to leave alone.
  const MERGED =
    /^(\.gitignore|package\.json|CLAUDE\.md|AGENTS\.md|\.mcp\.json)$/;
  const leaks = (r.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ code: l.slice(0, 2), p: l.slice(3).trim() }))
    .filter(({ code, p }) => OURS.test(p) || (MERGED.test(p) && code.trim() !== "??"));
  return {
    id: "stealth_invisible",
    ok: leaks.length === 0,
    label: "stealth install is invisible to git",
    detail: leaks.length
      ? `${leaks.length} path(s) git can see: ${leaks.slice(0, 4).map((l) => `${l.code.trim()} ${l.p}`).join(", ")}`
      : "git status unchanged — nothing bearing wrote can be committed",
  };
}

/**
 * Run every post-condition check. Returns findings; the caller decides how loudly to complain.
 * @param {string} root
 * @param {{ features?: Set<string>, mcpTransport?: any, gitnexusCmd?: string, manifest?: any }} ctx
 * @returns {Finding[]}
 */
export function runPostChecks(root, ctx = {}) {
  const { features, mcpTransport, gitnexusCmd, manifest } = ctx;
  const m = manifest ?? readJsonSafe(path.join(root, MANIFEST_PATH), null);
  return [
    {
      id: "manifest",
      ok: Boolean(m),
      label: "manifest written",
      detail: m ? MANIFEST_PATH : `missing ${MANIFEST_PATH} — the install has no identity`,
    },
    checkManifestFilesPresent(root, m),
    checkNoDanglingReferences(root, m),
    checkPersonaResolved(root, Boolean(m?.stealth)),
    checkStealthInvisible(root, m),
    checkNoLegacyArtifacts(root),
    checkSingleManagedBlock(root, Boolean(m?.stealth)),
    checkMachineLocalIgnored(root),
    checkScriptsUseRecordedBinary(root, gitnexusCmd),
    checkCommandsRun(root, features),
    checkMcpEntries(root, { mcpTransport, gitnexusCmd }),
    checkHttpServerReachable(mcpTransport),
    checkDeclinedModulesAbsent(root, features),
  ].filter(Boolean);
}
