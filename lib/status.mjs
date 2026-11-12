/**
 * `bearing status` — what bearing does in this repo, and the knob for each part of it.
 *
 * The user bearing is built for already works with agents and decides WHEN (NS-31). What they need
 * from the tool is not a tutorial but an inventory: what is loaded into every session, what speaks
 * up without being asked and how often it actually did, which knob turns each of those off, and
 * what is there to invoke. Every line here is read from the disk — the registered hooks, the config
 * the hooks themselves load, the counts they recorded — not from what an install meant to write.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AGENTS_MARKER_BEGIN, AGENTS_MARKER_END, MANIFEST_PATH, SKILLS_STORE } from "./constants.mjs";
import { readJsonSafe } from "./adapters/json-util.mjs";
import { hookRegistrations } from "./doctor.mjs";
import { OPT_IN_HOOKS } from "./adapters/claude.mjs";

/**
 * Every hook that can put words in front of the agent unasked, with the knob that silences it.
 * `bearing-precompact.mjs` is absent on purpose: it counts a compaction and says nothing.
 * The test runs each hook with its knob off and asserts it stays silent — a moment listed here
 * without a working knob is a broken promise (NS-31), not a missing feature.
 */
export const MOMENTS = [
  {
    hook: "bearing-session.mjs",
    name: "session brief",
    knob: "sessionBrief",
    off: false,
    when: () => "each session start, and the recovery steps after a compaction",
  },
  {
    hook: "bearing-northstar-anchor.mjs",
    name: "north-star reminder",
    knob: "northStarAnchorEvery",
    off: 0,
    score: "northStarAnchors",
    on: (c) => Number(c.northStarAnchorEvery) > 0,
    when: (c) =>
      (Number(c.northStarAnchorEveryTokens) > 0
        ? `every ${c.northStarAnchorEveryTokens} tokens of context growth (northStarAnchorEveryTokens)`
        : `every ${c.northStarAnchorEvery} tool calls`) + ", and the relevant ones after a doc write",
  },
  {
    hook: "bearing-taskcore-nudge.mjs",
    name: "task-core nudge",
    knob: "taskCoreEveryEdits",
    off: 0,
    score: "taskCoreNudges",
    on: (c) => Number(c.taskCoreEveryEdits) > 0,
    when: (c) => `after ${c.taskCoreEveryEdits} edits since this chat's task-core was written`,
  },
  {
    hook: "bearing-consult-nudge.mjs",
    name: "consult prompt",
    knob: "consultNudge",
    off: false,
    onValue: true,
    score: "consultNudges",
    when: () => "once per chat, at the first edit: did that edit decide a rule only you can answer?",
  },
  {
    hook: "bearing-impact-audit.mjs",
    name: "impact audit",
    knob: "impactAudit",
    off: false,
    score: "impactVerdictsQuestioned",
    when: () => "after a GitNexus impact call that resolved no callers but graded the change LOW",
  },
];

const DAY = 24 * 60 * 60 * 1000;

/** The config exactly as the installed hooks load it; the package's copy only if that is missing. */
async function hookConfig(root, bundleRoot) {
  for (const base of [path.join(root, ".bearing/lib"), path.join(bundleRoot, ".bearing/lib")]) {
    try {
      const mod = await import(pathToFileURL(path.join(base, "hook-helpers.mjs")).href);
      return { cfg: mod.loadHookConfig(root), from: base.startsWith(root) ? "installed" : "package" };
    } catch {
      /* try the next */
    }
  }
  return { cfg: null, from: null };
}

/**
 * How often each counter moved in the last `days`: archived sessions from the telemetry log plus
 * the live scorecard, which is archived only when the next session starts.
 */
function firedCounts(root, days = 30, now = Date.now()) {
  const totals = {};
  const add = (counts) => {
    for (const [k, v] of Object.entries(counts ?? {})) totals[k] = (totals[k] ?? 0) + (Number(v) || 0);
  };
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, ".bearing/.gitnexus-telemetry.jsonl"), "utf8");
  } catch {
    /* no history yet */
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const at = Date.parse(r.endedAt ?? r.startedAt ?? "");
      if (Number.isFinite(at) && now - at <= days * DAY) add(r.counts);
    } catch {
      /* skip a malformed line */
    }
  }
  const card = readJsonSafe(path.join(root, ".bearing/.gitnexus-scorecard.json"), null);
  const at = Date.parse(card?.updatedAt ?? "");
  if (card && Number.isFinite(at) && now - at <= days * DAY) add(card.counts);
  return totals;
}

/** The bearing block of an always-loaded contract file, sized as characters ÷ 4 — an estimate. */
function alwaysLoaded(root) {
  const out = [];
  for (const rel of ["CLAUDE.md", "AGENTS.md", ".bearing/contract.md"]) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const a = text.indexOf(AGENTS_MARKER_BEGIN);
    const b = text.indexOf(AGENTS_MARKER_END);
    const block = rel === ".bearing/contract.md" ? text : a >= 0 && b > a ? text.slice(a, b) : "";
    if (block.trim()) out.push({ file: rel, tokens: Math.round(block.length / 4) });
  }
  return out;
}

function skills(root) {
  try {
    return fs
      .readdirSync(path.join(root, SKILLS_STORE), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("bearing-"))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} root
 * @param {{ bundleRoot: string, now?: number }} ctx
 */
export async function status(root, { bundleRoot, now = Date.now() }) {
  const abs = path.resolve(root);
  const manifest = readJsonSafe(path.join(abs, MANIFEST_PATH), null);
  const { cfg, from } = await hookConfig(abs, bundleRoot);
  const registered = new Set(hookRegistrations(abs).map((r) => r.script));
  const fired = firedCounts(abs, 30, now);
  const moments = [];
  for (const m of MOMENTS) {
    if (!fs.existsSync(path.join(abs, ".claude/hooks", m.hook))) continue; // module or runtime absent
    const value = cfg?.[m.knob];
    const on = cfg ? (m.on ? m.on(cfg) : value !== false) : null;
    const isRegistered = registered.has(m.hook);
    let note = null;
    // An opt-in hook is registered only while its knob is on (OPT_IN_HOOKS): a knob turned on since
    // the last update has nothing to run yet, and one turned off still costs a spawn per call.
    // The installed hooks are older than this package and have never heard of this knob, so
    // writing it in hooks.json would do nothing yet. Saying "undefined" would be a claim about a
    // setting that does not exist (NS-20).
    if (cfg && value === undefined) note = "this install predates the knob — bearing update adds it";
    else if (on && !isRegistered) note = "on in config but not registered — run bearing update";
    else if (on === false && isRegistered && m.hook in OPT_IN_HOOKS) note = "off; bearing update also unregisters it";
    else if (on === false && m.onValue !== undefined) note = `to turn on: "${m.knob}": ${JSON.stringify(m.onValue)}, then bearing update`;
    moments.push({
      name: m.name,
      hook: m.hook,
      on,
      registered: isRegistered,
      when: on && cfg ? m.when(cfg) : "off",
      knob: m.knob,
      value,
      offValue: m.off,
      fired30d: m.score ? (fired[m.score] ?? 0) : null,
      note,
    });
  }
  return {
    root: abs,
    installed: Boolean(manifest),
    kitVersion: manifest?.kitVersion ?? null,
    runtime: manifest?.runtime ?? null,
    features: manifest?.features ?? [],
    configFrom: from,
    alwaysLoaded: alwaysLoaded(abs),
    moments,
    skills: skills(abs),
  };
}

export function printStatus(s) {
  const L = [];
  if (!s.installed) {
    L.push(`${s.root}: no bearing install (${MANIFEST_PATH} is missing) — bearing doctor says more`);
    console.log(L.join("\n"));
    return 1;
  }
  L.push(`${s.root}`);
  L.push(`  bearing ${s.kitVersion ?? "?"} · runtime ${s.runtime ?? "?"} · ${s.features.join(", ") || "no modules"}`);

  L.push("", "Always loaded");
  if (!s.alwaysLoaded.length) L.push("  nothing");
  for (const a of s.alwaysLoaded) L.push(`  ${a.file}: bearing's block ≈ ${a.tokens.toLocaleString("en-US")} tokens (characters ÷ 4)`);

  L.push("", "Speaks up without being asked");
  if (!s.moments.length) {
    L.push("  nothing — only Claude Code has the hooks these need (NS-14)");
  } else {
    const w = Math.max(...s.moments.map((m) => m.name.length));
    for (const m of s.moments) {
      const mark = m.on === null ? "?" : m.on ? "✓" : "·";
      const count = m.fired30d === null ? "" : ` · fired ${m.fired30d}× in 30 days`;
      L.push(`  ${mark} ${m.name.padEnd(w)}  ${m.when}`);
      const knob = m.value === undefined ? `${m.knob}: —` : `${m.knob}: ${JSON.stringify(m.value)} (off: ${JSON.stringify(m.offValue)})`;
      L.push(`    ${" ".repeat(w)}  ${knob}${count}`);
      if (m.note) L.push(`    ${" ".repeat(w)}  ${m.note}`);
    }
    L.push(
      "  Knobs go in .bearing/hooks.json (team, committed) or .bearing/hooks.local.json (this machine, wins).",
    );
    if (s.configFrom === "package") L.push("  (read with this package's config loader — the installed one is missing)");
  }

  L.push("", "On ask — name it in a prompt, or /<skill> in Claude Code");
  L.push(s.skills.length ? `  ${s.skills.join(" · ")}` : "  no skills installed");
  console.log(L.join("\n"));
  return 0;
}
