#!/usr/bin/env node
/**
 * Agent-facing GitNexus maintenance CLI (no MCP required).
 * Usage: node scripts/bearing-agent.mjs status|refresh|brief|health|verify|doctor|review [base]|pr-impact [base]|branch-status [base]|commit-msg|map|scorecard|stats [--json]|graph-smoke|capabilities|token-benchmark|detect-api|fallback "<why>"|fallback:off|fallback-log [--json]
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * How to invoke a bearing command IN THIS REPO.
 *
 * A stealth install adds no npm scripts — package.json is tracked, and editing it is the leak the
 * mode exists to avoid — so an npm-script invocation in help text was advice the reader could not
 * follow (NS-5). Resolve against what actually exists instead of assuming the shared layout.
 * @param {string} name e.g. "bearing:fallback"
 */
/**
 * Counter key → human label, and the humaniser. ONE map: there were two local copies, the scorecard's
 * with 14 keys and the all-sessions stats' with 7, and stats filtered its output BY ITS OWN COPY — so
 * seven counters were written on every session and shown to nobody, `consultNudges` and
 * `microscopeNudges` among them. `labelFor` was a local const in the scorecard that stats called
 * anyway, crashing with a ReferenceError mid-table on every run of `bearing:stats`.
 *
 * Both readers now derive their keys from what was actually COUNTED, so a new counter appears without
 * anyone remembering to add it here; the fallback humanises an unlabelled key rather than hiding it.
 */
const labels = {
  graphCalls: "GitNexus MCP calls",
  grepRedirects: "Grep → graph redirects",
  readRedirects: "Large Read → graph redirects",
  impactGate: "Impact-before-edit gates",
  commitGate: "detect_changes-before-commit gates",
  editStaleBlocks: "Stale-edit blocks",
  compactions: "Context compactions",
  classicalFallbackGranted: "Classical-fallback grants (GN distrusted)",
  driftRefreshBlocks: "Graph-drift refresh blocks (edited since index)",
  taskCoreNudges: "Task-core nudges (edits since the core was last written)",
  northStarAnchors: "North-star re-anchors (mid-session drift guards)",
  impactVerdictsQuestioned: "Impact verdicts questioned (LOW from unresolved callers)",
  consultNudges: "Consult prompts (invent-vs-implement, at first edit)",
  microscopeNudges: "Deep-review nudges (change grew multi-file)"
};

const labelFor = (k) => labels[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());


function howToRun(name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (pkg.scripts?.[name]) return `npm run ${name}`;
  } catch {
    /* no package.json, or unreadable → fall through to the direct form */
  }
  return `node scripts/bearing-agent.mjs ${name.replace(/^bearing:/, "")}`;
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Refuse with a diagnosis rather than a stack trace when .bearing/lib is not there. Lives in
// scripts/lib/ because a check for a missing directory cannot import from it.
const { assertKitInstalled } = await import(
  pathToFileURL(path.join(ROOT, "scripts/lib/require-kit.mjs")).href
);
assertKitInstalled(ROOT);

const { withProjectTmpEnv, tmpSpaceReport, enospcHelp, isEnospcError } = await import(
  pathToFileURL(path.join(ROOT, "scripts/lib/project-tmp.mjs")).href
);
const { gitnexusSpawn } = await import(
  pathToFileURL(path.join(ROOT, ".bearing/lib/gitnexus-cmd.mjs")).href
);
const { inspectPersistence,
  inspectMcpServer, probeMcpEndpoint, classifyPersistenceOutput } = await import(
  pathToFileURL(path.join(ROOT, ".bearing/lib/persistence-health.mjs"))
    .href
);
const {
  grantClassicalFallback,
  revokeClassicalFallback,
  fallbackGrant,
  appendFallbackReport,
  readFallbackReports,
  northStarsPath,
  northStarsExists,
  northStarsDigest,
  readNorthStars,
  bumpScore,
} = await import(
  pathToFileURL(path.join(ROOT, ".bearing/lib/session-primer.mjs")).href
);

function loadStaleness() {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, ".bearing/lib/check-staleness.mjs"), ROOT],
    {
      encoding: "utf8",
      env: withProjectTmpEnv(ROOT),
    },
  );
  try {
    return JSON.parse(r.stdout.trim() || "{}");
  } catch {
    return {
      fresh: false,
      reason: "check_failed",
      detail: r.stderr || "staleness check failed",
    };
  }
}

function run(cmd, args, opts = {}) {
  return runAllowFail(cmd, args, opts, true);
}

/**
 * Like run(), but returns the exit status instead of killing the process when `fatal` is false.
 * The refresh path MUST use this: exiting on failure skips markRefreshOutcome(false), so the
 * refresh-failed flag is never written, the stale policy never reaches classical_fallback, and the
 * session stays fully denied with the agent looping on agent-refresh.
 */
function runAllowFail(cmd, args, opts = {}, fatal = false) {
  const env = withProjectTmpEnv(ROOT, opts.env);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts, env });
  // isEnospcError also matches the MESSAGE ("no space left on device"), which a child that printed
  // the error and exited non-zero reports instead of an error.code — the inline check missed those
  // and gave a generic failure where the temp-dir help was the useful answer.
  if (isEnospcError(r.error)) {
    console.error("\n" + enospcHelp(ROOT));
    if (fatal) process.exit(1);
    return r.status ?? 1;
  }
  if (r.status !== 0) {
    if (fatal) process.exit(r.status ?? 1);
    return r.status ?? 1;
  }
  return 0;
}

const cmd = process.argv[2] ?? "status";

if (cmd === "fallback") {
  const reason = process.argv
    .slice(3)
    // npm eats the `--` separator; a DIRECT `node scripts/bearing-agent.mjs fallback -- "why"`
    // does not, and that is the form stealth installs are told to use — so it landed verbatim in
    // every failure report sent to the GitNexus devs.
    .filter((a, i) => !(i === 0 && a === "--"))
    .join(" ")
    .trim();
  if (!reason) {
    console.error(
      `Usage: ${howToRun("bearing:fallback")} -- "<why GitNexus can't be trusted here>"\n` +
        `   or: node scripts/bearing-agent.mjs fallback "<why>"`,
    );
    process.exit(2);
  }
  grantClassicalFallback(ROOT, reason);
  bumpScore(ROOT, "classicalFallbackGranted");
  appendFallbackReport(ROOT, reason); // durable "where GitNexus fell short" report
  const g = fallbackGrant(ROOT);
  const mins = g ? Math.max(1, Math.round(g.remainingMs / 60000)) : 15;
  console.log(`⚠ Classical fallback GRANTED for ~${mins} min — reason: ${reason}`);
  console.log(
    "  Classical Grep/Read/shell are now allowed. Re-confirm findings with the graph once GitNexus is reliable.",
  );
  console.log(`  Logged for review → ${howToRun('bearing:fallback-log')} (report these to the GitNexus devs).`);
  console.log(`  End early: ${howToRun('bearing:fallback:off')}`);
  process.exit(0);
}

if (cmd === "fallback-log") {
  const reports = readFallbackReports(ROOT);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(reports, null, 2));
    process.exit(0);
  }
  if (!reports.length) {
    console.log("No GitNexus fallback reports yet — agents haven't distrusted the graph in this repo.");
    process.exit(0);
  }
  console.log(
    `GitNexus fallback reports — ${reports.length} time(s) an agent distrusted the graph (report these upstream):\n`,
  );
  for (const r of reports.slice(-30)) {
    const idx = r.index || {};
    const size = idx.nodes != null ? `${idx.nodes} nodes/${idx.embeddings ?? "?"} emb` : "no index";
    const ver = r.gitnexusVersion ? ` v${r.gitnexusVersion}` : "";
    console.log(`• ${r.at} · ${r.repo}${ver} · ${size} · indexed ${(r.indexedCommit || "?").slice(0, 7)}`);
    console.log(`    ${r.reason}`);
  }
  if (reports.length > 30) console.log(`\n(showing last 30 of ${reports.length}; --json for all)`);
  console.log(`\nExport for the GitNexus developers: ${howToRun('bearing:fallback-log')} -- --json`);
  process.exit(0);
}

if (cmd === "northstars") {
  const nsp = northStarsPath(ROOT);
  if (!northStarsExists(ROOT)) {
    console.log(`No north-stars yet — create ${nsp}.`);
    console.log(
      "\nIt is the project's SEMANTIC anchor: short, numbered, falsifiable propositions (NS-1, NS-2, …)",
    );
    console.log(
      "stating invariants, exact term meanings, settled decisions, and rejected ideas. It outranks every",
    );
    console.log("other doc. Format + routine: the `bearing-northstars` skill.");
    process.exit(0);
  }
  const lines = northStarsDigest(ROOT);
  if (process.argv.includes("--full")) {
    console.log(readNorthStars(ROOT));
    process.exit(0);
  }
  console.log(`Project north-stars — ${lines.length} proposition(s) · ${nsp}\n`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(`\nFull document: ${howToRun('bearing:northstars')} -- --full`);
  process.exit(0);
}

if (cmd === "fallback:off" || cmd === "unfallback") {
  revokeClassicalFallback(ROOT);
  console.log("Classical fallback ended — graph-first enforcement re-armed.");
  process.exit(0);
}

if (cmd === "status") {
  const grant = fallbackGrant(ROOT);
  if (grant) {
    const mins = Math.max(1, Math.round(grant.remainingMs / 60000));
    console.log(
      `⚠ CLASSICAL FALLBACK active (${grant.reason || "GitNexus distrusted"}) — classical tools allowed for ~${mins} min more.`,
    );
    console.log(`  End early: ${howToRun('bearing:fallback:off')}\n`);
  }
  const stale = loadStaleness();
  const systemTmp = tmpSpaceReport(ROOT);
  if (stale.fresh) {
    console.log("GitNexus index: fresh (matches HEAD)");
    console.log(
      `  indexed: ${(stale.indexedCommit || "").slice(0, 7)} @ ${stale.indexedAt ?? "?"}`,
    );
    if ((stale.embeddingCount ?? 0) > 0) {
      console.log(`  embeddings: ${stale.embeddingCount} vectors`);
    }
    if ((stale.driftingFiles ?? 0) > 0) {
      console.log(
        `  ⚠ working tree: ${stale.driftingFiles} source file(s) edited since index — graph queries may be stale.`,
      );
      console.log(`    Resync: ${howToRun('bearing:refresh')} (fast, incremental)`);
    }
    console.log(systemTmp);
    process.exit(0);
  }
  console.log("GitNexus index: STALE — graph and/or embeddings may be wrong");
  console.log(`  ${stale.detail || stale.reason}`);
  if (stale.reason === "missing_embeddings") {
    console.log(
      "  embeddings: missing — agent-refresh runs analyze --embeddings",
    );
  }
  console.log(`  Fix: ${howToRun('bearing:agent-refresh')}`);
  console.log(systemTmp);
  process.exit(1);
}

function markRefreshOutcome(success, detail = "") {
  const setPending = path.join(
    ROOT,
    ".bearing/lib/set-refresh-pending.mjs",
  );
  spawnSync(
    process.execPath,
    [setPending, ROOT, success ? "clear" : "set-failed", detail],
    {
      cwd: ROOT,
      stdio: "ignore",
      env: withProjectTmpEnv(ROOT),
    },
  );
  // Invalidate the short-TTL staleness cache so the next tool call sees fresh state.
  try {
    fs.unlinkSync(path.join(ROOT, ".bearing/.gitnexus-staleness-cache.json"));
  } catch {
    /* ignore */
  }
}

if (cmd === "refresh") {
  console.log("==> GitNexus agent refresh (diagnose, then run the cheapest sufficient analyze)");
  console.log(tmpSpaceReport(ROOT));
  try {
    // Was an unconditional `bearing:full-pdg` — analyze --force + embeddings + skills + PDG — for
    // ANY staleness, including two files behind. A full rebuild bought to close a small gap, and on
    // a large repository that is minutes of the user's time per staleness event.
    //
    // refresh-cli reads the diagnosis and picks the tier: nothing when no source moved, incremental
    // for a normal gap, and --force only where it is genuinely required — a missing index, a
    // diverged history, or a graph with no embeddings, which cannot be repaired incrementally
    // because analyze short-circuits on "already up to date" before it ever reaches the embedder.
    const rc = runAllowFail(process.execPath, [".bearing/lib/refresh-cli.mjs", ROOT], {
      stdio: "inherit",
    });
    if (rc !== 0) {
      markRefreshOutcome(false, `analyze exited ${rc} — index could not be refreshed`);
      console.error(
        "\n==> Refresh FAILED. Classical Grep/Read are now permitted so you are not stuck.\n" +
          `    Fix the cause (network, disk, gitnexus install) and re-run: ${howToRun('bearing:agent-refresh')}\n` +
          `    If GitNexus itself is the problem: ${howToRun('bearing:fallback')} -- \"<what went wrong>\"`,
      );
      process.exit(rc);
    }
    // The INDEX is refreshed by this point — rc was 0 above. What follows re-syncs teaching files,
    // and a failure there is a tidiness problem, not a graph problem.
    //
    // It used to run under `run()`, which throws into the catch below and reports "agent-refresh
    // failed (ENOSPC or command error)" with exit 1. A zed install hit exactly that: the sync
    // verified a Cursor rule the repo never had, and every refresh looked catastrophic. Since
    // `bearing:agent-status` tells the agent to run this AUTONOMOUSLY, exit 1 reads as an unusable
    // graph and can stop work that was never broken. The runtime bug is fixed; this makes the
    // whole class survivable.
    if (
      fs.existsSync(path.join(ROOT, "scripts/sync-cursor-bearing-teaching.sh"))
    ) {
      const syncRc = runAllowFail("bash", ["scripts/sync-cursor-bearing-teaching.sh"], {
        stdio: "inherit",
      });
      if (syncRc !== 0) {
        console.error(
          `\n==> Teaching sync exited ${syncRc}. THE INDEX IS REFRESHED and the graph is usable —\n` +
            "    this step only re-links skills and rule files. Continuing.",
        );
      }
    }
  } catch (err) {
    console.error("\n" + enospcHelp(ROOT));
    markRefreshOutcome(false, "agent-refresh failed (ENOSPC or command error)");
    process.exit(1);
  }
  const stale = loadStaleness();
  if (stale.fresh) {
    console.log("==> Index fresh after refresh");
    markRefreshOutcome(true);
    try {
      const { generateArchDoc } = await import(
        pathToFileURL(
          path.join(ROOT, ".bearing/lib/generate-arch-doc.mjs"),
        ).href
      );
      const res = generateArchDoc(ROOT, undefined, withProjectTmpEnv(ROOT));
      if (res.written)
        console.log(`==> Architecture doc refreshed: ${res.path}`);
    } catch {
      /* best effort */
    }
    process.exit(0);
  }
  console.error(
    "==> Refresh finished but index still not fresh — check git state",
  );
  markRefreshOutcome(false, "agent-refresh finished but index still stale");
  process.exit(1);
}

if (cmd === "brief") {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, ".bearing/lib/agent-brief.mjs"), ROOT],
    {
      encoding: "utf8",
      env: withProjectTmpEnv(ROOT),
    },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

if (cmd === "health") {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, ".bearing/lib/agent-health.mjs"), ROOT],
    {
      encoding: "utf8",
      env: withProjectTmpEnv(ROOT),
    },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 0);
}

if (cmd === "token-benchmark") {
  // Pass the tail through so `--targets 12` and `--json` reach the script unchanged.
  const rest = process.argv.slice(3);
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/bearing-token-benchmark.mjs"), ROOT, ...rest],
    { encoding: "utf8", env: withProjectTmpEnv(ROOT) },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

if (cmd === "capabilities") {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, ".bearing/lib/graph-capabilities.mjs"), ROOT, ...process.argv.slice(3)],
    { encoding: "utf8", env: withProjectTmpEnv(ROOT) },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

if (cmd === "graph-smoke") {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, ".bearing/lib/graph-smoke.mjs"), ROOT],
    {
      encoding: "utf8",
      env: withProjectTmpEnv(ROOT),
    },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

if (cmd === "detect-api") {
  const { writeApiRouterProfile } = await import(
    pathToFileURL(path.join(ROOT, ".bearing/lib/detect-api-router.mjs"))
      .href
  );
  const profile = writeApiRouterProfile(ROOT);
  console.log(
    `API router profile: ${profile.profile} (Route nodes: ${profile.routeNodes ?? "n/a"})`,
  );
  console.log(`  → ${profile.recommendation}`);
  if (profile.sourceSignals.customSymbols.length) {
    console.log(
      `  custom symbols: ${profile.sourceSignals.customSymbols.join(", ")}`,
    );
  }
  process.exit(0);
}

if (cmd === "verify") {
  const verifyPath = path.join(ROOT, "scripts/bearing-verify.mjs");
  const fallback = path.join(ROOT, ".bearing/lib/verify-kit.mjs");
  const script = fs.existsSync(verifyPath) ? verifyPath : fallback;
  const r = spawnSync(
    process.execPath,
    [script, ROOT, ...process.argv.slice(3)],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: withProjectTmpEnv(ROOT),
    },
  );
  process.exit(r.status ?? 1);
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function repoName() {
  return process.env.GITNEXUS_REPO || path.basename(ROOT);
}

function currentBranch() {
  return (
    git(["branch", "--show-current"]) ||
    git(["rev-parse", "--abbrev-ref", "HEAD"]) ||
    "HEAD"
  );
}

function resolveBaseRef(base) {
  if (git(["rev-parse", "--verify", base])) return base;
  if (
    !base.startsWith("origin/") &&
    git(["rev-parse", "--verify", `origin/${base}`])
  )
    return `origin/${base}`;
  return "";
}

function symbolFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  if (/^[A-Z]/.test(base) || base.includes(".")) return base;
  return base || null;
}

if (cmd === "branch-status") {
  const baseArg = process.argv[3] || process.env.GITHUB_BASE_REF || "main";
  const branch = currentBranch();
  const base = resolveBaseRef(baseArg);
  const repo = repoName();
  const lines = [`GitNexus branch status — ${branch}`, ""];
  lines.push(`Repo: ${repo}`);
  lines.push(`Current branch: ${branch}`);
  lines.push(`Base ref: ${base || `${baseArg} (not found locally)`}`);
  if (base) {
    const ahead = git(["rev-list", "--count", `${base}..HEAD`]) || "0";
    const behind = git(["rev-list", "--count", `HEAD..${base}`]) || "0";
    const changed = git(["diff", "--name-only", `${base}...HEAD`])
      .split("\n")
      .filter(Boolean);
    lines.push(`Ahead/behind vs ${base}: +${ahead}/-${behind}`);
    lines.push(`Changed files vs base: ${changed.length}`);
    lines.push("");
    lines.push("Branch-aware MCP calls:");
    lines.push(
      `  gitnexus_detect_changes({ scope: "compare", base_ref: "${base}", repo: "${repo}", branch: "${branch}" })`,
    );
    lines.push(
      `  gitnexus_query({ search_query: "branch ${branch} changed behavior", task_context: "PR review vs ${base}", goal: "affected flows", repo: "${repo}", branch: "${branch}", limit: 5, max_symbols: 12 })`,
    );
  } else {
    lines.push(
      `Fetch the base branch or pass an existing ref: ${howToRun('bearing:branch-status')} -- <base>`,
    );
  }
  console.log(lines.join("\n"));
  process.exit(base ? 0 : 1);
}

if (cmd === "review" || cmd === "pr-impact") {
  const baseArg = process.argv[3] || process.env.GITHUB_BASE_REF || "main";
  const branch = currentBranch();
  const repo = repoName();
  const base = resolveBaseRef(baseArg);
  const range = base ? `${base}...HEAD` : `${baseArg}...HEAD`;
  const names = base
    ? git(["diff", "--name-only", range]).split("\n").filter(Boolean)
    : [];
  const codeFiles = names.filter((f) =>
    /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|cs|cpp|cc|c|cu|cuh|scala)$/i.test(
      f,
    ),
  );

  const lines = [
    `GitNexus branch-aware PR review playbook (${branch} vs ${base || baseArg})`,
    "",
  ];
  if (!base) {
    lines.push(
      `Base ref "${baseArg}" not found — fetch it or pass an existing branch: ${howToRun('bearing:agent-review')} -- <base>`,
    );
    console.log(lines.join("\n"));
    process.exit(1);
  }
  if (!codeFiles.length) {
    lines.push(
      `No changed code files vs ${base}. (${names.length} non-code file(s) changed.)`,
    );
    console.log(lines.join("\n"));
    process.exit(0);
  }

  lines.push(`Changed code files (${codeFiles.length}):`);
  for (const f of codeFiles.slice(0, 12)) lines.push(`  - ${f}`);
  if (codeFiles.length > 12) lines.push(`  … +${codeFiles.length - 12} more`);
  lines.push("");
  lines.push("1) Branch-aware change scope + affected flows:");
  lines.push(
    `   gitnexus_detect_changes({ scope: "compare", base_ref: "${base}", repo: "${repo}", branch: "${branch}" })`,
  );
  lines.push("");
  lines.push("2) Blast radius per changed entry symbol on this branch:");
  const seen = new Set();
  for (const f of codeFiles) {
    const sym = symbolFromFile(f);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    lines.push(
      `   gitnexus_impact({ target: "${sym}", direction: "upstream", repo: "${repo}", branch: "${branch}", summaryOnly: true })`,
    );
    if (seen.size >= 12) break;
  }
  lines.push("");
  lines.push(
    "3) If GitNexus has multi-branch indexes for base + head, use the branch parameter consistently.",
  );
  lines.push(
    "4) HIGH/CRITICAL or security-sensitive changes → PDG impact + bearing-security-review.",
  );
  lines.push(
    "5) Confirm affected_processes match PR intent; verify tests cover them.",
  );
  console.log(lines.join("\n"));
  process.exit(0);
}

/** The MCP transport this repo recorded at install time, or null. */
function recordedTransport(root) {
  for (const rel of [".bearing/manifest.json", ".gitnexus/agent-kit-manifest.json"]) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")).mcpTransport;
      if (t) return t;
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** Where `npm i -g gitnexus` put the package, if it is there at all. */
function globalGitnexusDir() {
  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
    const dir = path.join(prefix, "lib/node_modules/gitnexus");
    return fs.existsSync(dir) ? dir : null;
  } catch {
    return null; // no npm on PATH, or gitnexus came from somewhere else
  }
}

if (cmd === "doctor") {
  const lines = ["GitNexus doctor — backend + kit reachability", ""];
  let problems = 0;

  // Cursor-only: a Claude or Zed install has no .cursor/mcp.json and reporting its absence
  // as a problem told the reader to "restart Cursor" for a file they never wanted (NS-6).
  const wantsCursorHere = String(
    (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, ".bearing/manifest.json"), "utf8")).runtime; } catch { return "cursor"; } })(),
  ).split(",").some((t) => ["cursor", "both", "all"].includes(t.trim().toLowerCase()));
  const mcpPath = path.join(ROOT, ".cursor/mcp.json");
  let mcpOk = false;
  try {
    mcpOk = Boolean(
      JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers?.gitnexus,
    );
  } catch {
    /* missing */
  }
  if (wantsCursorHere) lines.push(`${mcpOk ? "✓" : "✗"} .cursor/mcp.json gitnexus entry`);
if (wantsCursorHere && !mcpOk) problems++;

  // Live probe of the GitNexus CLI backend (proxy for MCP server health).
  // Probe the SAME binary everything else runs. Hardcoding npx here meant this reported the STOCK
  // npm build's version while every real operation used the linked one — and both print the same
  // version string, so the check stayed green even when the two had diverged completely.
  const gnProbe = gitnexusSpawn(["--version"], ROOT);
  const probe = spawnSync(gnProbe.command, gnProbe.args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: withProjectTmpEnv(ROOT),
  });
  const cliOk = probe.status === 0;
  lines.push(
    `${cliOk ? "✓" : "✗"} gitnexus CLI reachable${cliOk ? ` (${(probe.stdout || "").trim().split("\n")[0]})` : " — npx gitnexus failed (offline? install?)"}`,
  );
  if (!cliOk) problems++;
  const probePersistence = classifyPersistenceOutput(
    `${probe.stdout || ""} ${probe.stderr || ""}`,
  );
  if (probePersistence) {
    lines.push(`✗ ${probePersistence.label}: ${probePersistence.detail}`);
    problems++;
  }

  const stale = loadStaleness();
  lines.push(
    `${stale.fresh ? "✓" : "!"} Index ${stale.fresh ? "fresh" : `stale — ${stale.reason}`}`,
  );

  const gnList = gitnexusSpawn(["list"], ROOT);
  const listProbe = cliOk
    ? spawnSync(gnList.command, gnList.args, {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60000,
        env: withProjectTmpEnv(ROOT),
      })
    : { status: 1, stdout: "" };
  const listOk = listProbe.status === 0;
  lines.push(
    `${listOk ? "✓" : "!"} Repo registry query ${listOk ? "ok" : "unavailable"}`,
  );
  const listPersistence = classifyPersistenceOutput(
    `${listProbe.stdout || ""} ${listProbe.stderr || ""}`,
  );
  if (listPersistence) {
    lines.push(`✗ ${listPersistence.label}: ${listPersistence.detail}`);
    problems++;
  }

  const persistence = inspectPersistence(ROOT);
  for (const c of persistence.checks) {
    const severe = c.id !== "pdg_layer_hint" && !c.ok;
    lines.push(`${c.ok ? "✓" : severe ? "✗" : "!"} ${c.label}: ${c.detail}`);
    if (severe) problems++;
  }

  // The shared server's view of the machine can diverge from the machine. Both ways cost an
  // afternoon before this existed, and both end in a tool failing for a reason the tool cannot
  // explain: a repo deleted from the registry that the running server still serves, and a server
  // still running the binary that `npm i -g` replaced underneath it.
  for (const c of inspectMcpServer({ pkgDir: globalGitnexusDir() }).checks) {
    lines.push(`${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`);
    if (!c.ok) problems++;
  }

  // And ask the endpoint we RECORDED whether it is answering. Everything above probes the CLI and
  // the registry — a different process from the shared server the editor actually talks to, which
  // is why a dead server produced a clean bill of health and a closing line that guessed.
  const endpoint = await probeMcpEndpoint(recordedTransport(ROOT));
  if (endpoint) {
    lines.push(`${endpoint.ok ? "✓" : "✗"} ${endpoint.label}: ${endpoint.detail}`);
    if (!endpoint.ok) problems++;
  }

  lines.push("");
  lines.push(
    problems === 0
      ? endpoint
        ? "Doctor: backend reachable, server current, endpoint answering. If MCP tools still fail, restart your editor to reload its client."
        : "Doctor: backend reachable, server current. If MCP tools still fail, restart your editor."
      : `Doctor: ${problems} problem(s) — fix the ✗ items above${wantsCursorHere ? ", then restart Cursor" : ""}.`,
  );
  console.log(lines.join("\n"));
  process.exit(problems === 0 ? 0 : 1);
}

if (cmd === "map") {
  const { generateArchDoc } = await import(
    pathToFileURL(path.join(ROOT, ".bearing/lib/generate-arch-doc.mjs"))
      .href
  );
  const res = generateArchDoc(ROOT, undefined, withProjectTmpEnv(ROOT));
  if (res.written) {
    console.log(`Architecture doc written: ${res.path}`);
    process.exit(0);
  }
  console.error(`Could not generate architecture doc: ${res.reason}`);
  process.exit(1);
}

if (cmd === "commit-msg") {
  const { draftCommitMessage } = await import(
    pathToFileURL(path.join(ROOT, ".bearing/lib/commit-message.mjs")).href
  );
  const { message } = draftCommitMessage(
    ROOT,
    undefined,
    withProjectTmpEnv(ROOT),
  );
  console.log(message);
  process.exit(0);
}

if (cmd === "scorecard") {
  const { readScorecard } = await import(
    pathToFileURL(path.join(ROOT, ".bearing/lib/session-primer.mjs")).href
  );
  const card = readScorecard(ROOT);
  const counts = card.counts ?? {};
  console.log("GitNexus enforcement scorecard (this session)");
  console.log(
    card.startedAt ? `  since ${card.startedAt}` : "  (no activity yet)",
  );
  // Derive from what was actually COUNTED, not from the label map. Filtering by `labels` meant a
  // counter without a label was written on every event and shown to nobody — four were, two of
  // them for months. A hand-kept list on the read side of a counter is the same drift as one on
  // the write side; the fallback humanises an unlabelled key rather than hiding it.
  const keys = Object.keys(counts).filter((k) => counts[k]);
  if (!keys.length) {
    console.log(
      "  No enforcement events yet — run some tools in a chat first.",
    );
  } else {
    for (const k of keys) console.log(`  ${labelFor(k)}: ${counts[k]}`);
  }
  // The numbers alone never told anyone whether the gates were helping. Say it outright.
  const { diagnoseEnforcement } = await import(
    pathToFileURL(path.join(ROOT, ".bearing/lib/session-primer.mjs")).href
  );
  const findings = diagnoseEnforcement(counts);
  if (findings.length) {
    console.log("");
    console.log("Diagnosis");
    for (const f of findings) {
      console.log(`  ${f.level === "warn" ? "!" : "\u00b7"} ${f.headline}`);
      console.log(`    -> ${f.advice}`);
    }
  }
  process.exit(0);
}

if (cmd === "stats") {
  const { readTelemetry, summarizeTelemetry, readScorecard } = await import(
    pathToFileURL(path.join(ROOT, ".bearing/lib/session-primer.mjs")).href
  );
  const records = readTelemetry(ROOT);
  // Fold in the current (not-yet-archived) session so nothing is missing.
  const live = readScorecard(ROOT);
  if (live?.counts && Object.keys(live.counts).length) {
    records.push({
      startedAt: live.startedAt ?? null,
      endedAt: live.updatedAt ?? null,
      counts: live.counts,
      live: true,
    });
  }
  const s = summarizeTelemetry(records);
  if (process.argv.includes("--json")) {
    const latestIndex = [...records].reverse().find((r) => r.index)?.index ?? null;
    process.stdout.write(JSON.stringify({ ...s, latestIndex }, null, 2) + "\n");
    process.exit(0);
  }
  console.log("GitNexus telemetry — all sessions");
  if (!s.sessions) {
    console.log("  No sessions recorded yet. A session is archived on the NEXT");
    console.log("  session start; run some tools + start a new chat to accrue data.");
    process.exit(0);
  }
  console.log(`  sessions: ${s.sessions}  |  ${s.firstAt ?? "?"} → ${s.lastAt ?? "?"}`);
  if (s.avgDurationMs != null) {
    console.log(`  avg session length: ${Math.round(s.avgDurationMs / 1000)}s`);
  }
  // Column width from the widest label actually being printed. A hardcoded 36 collided with the
  // number the moment a label grew past it — "Consult prompts (invent-vs-implement, at first edit)1".
  const width = Math.max(8, ...Object.keys(s.totals).filter((k) => s.totals[k]).map((k) => labelFor(k).length)) + 2;
  console.log("  " + "metric".padEnd(width) + "total   avg/session");
  const keys = Object.keys(s.totals).filter((k) => s.totals[k]);
  if (!keys.length) {
    console.log("  (no enforcement events across recorded sessions)");
  } else {
    for (const k of keys) {
      console.log(
        `  ${labelFor(k).padEnd(width)}${String(s.totals[k]).padEnd(8)}${s.avgPerSession[k]}`,
      );
    }
  }
  const gate = (s.totals.impactGate ?? 0) + (s.totals.commitGate ?? 0);
  const redir = (s.totals.grepRedirects ?? 0) + (s.totals.readRedirects ?? 0);
  console.log(
    `\n  Value: ${redir} lazy-search redirect(s) to the graph, ${gate} pre-edit/commit gate(s) fired.`,
  );
  console.log(`  Log: ${path.join(".bearing", ".gitnexus-telemetry.jsonl")}`);
  const fb = readFallbackReports(ROOT);
  if (fb.length) {
    console.log(
      `\n  ⚠ GitNexus fallback reports: ${fb.length} — where the graph fell short. See: ${howToRun('bearing:fallback-log')}`,
    );
  }
  process.exit(0);
}

console.error(
  `Unknown command: ${cmd}. Use: status | refresh | brief | health | verify | doctor | review [base] | pr-impact [base] | branch-status [base] | commit-msg | map | scorecard | stats | graph-smoke | detect-api | fallback "<why>" | fallback:off | fallback-log`,
);
process.exit(2);
