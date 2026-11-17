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
import { hasSharedInstall } from "./stealth.mjs";

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
    // Two knobs: the token cadence, and northStarAnchorEvery — which is the off switch AND the
    // call-count cadence used whenever the context size cannot be read. Printing one value under
    // the other's description was a claim the config did not make (NS-20).
    also: ["northStarAnchorEveryTokens"],
    on: (c) => Number(c.northStarAnchorEvery) > 0,
    when: (c, root) =>
      (!hasNorthStarClaims(root)
        ? "silent until .bearing/northstars.md holds an NS-# line — "
        : "") +
      (Number(c.northStarAnchorEveryTokens) > 0
        ? `every ${c.northStarAnchorEveryTokens} tokens of context growth (every ${c.northStarAnchorEvery} tool calls where the size cannot be read)`
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
    hook: "bearing-memory-nudge.mjs",
    name: "memory nudge",
    knob: "memoryNudge",
    off: false,
    score: "memoryNudges",
    when: (c) =>
      "after a merge, tag, release or publish" +
      (c.sessionBrief === false
        ? " (the brief is off, so no stale-memory line at session start)"
        : Number(c.memoryStaleDays) > 0
          ? `; and in the brief when memory is ${c.memoryStaleDays}+ days old with commits since`
          : " (the stale-memory line is off: memoryStaleDays 0)"),
  },
  {
    hook: "bearing-sessions.mjs",
    name: "parallel-session warning",
    knob: "sessionsWarn",
    off: false,
    onValue: true,
    score: "sessionWarnings",
    // The hook uses 30 when the knob is 0 or junk; print what it will DO, not the raw value (NS-20).
    when: (c) => `when another live session (any worktree) edited the same file in the last ${Number(c.sessionsWindowMinutes) > 0 ? Number(c.sessionsWindowMinutes) : 30} minutes`,
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

/** Does the north-stars file hold a claim the anchor can digest? Without one the anchor is silent. */
function hasNorthStarClaims(root) {
  try {
    return /\*\*NS-\d+\*\*|^#{1,6}\s*NS-\d+/m.test(fs.readFileSync(path.join(root, ".bearing/northstars.md"), "utf8"));
  } catch {
    return false;
  }
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
  // Each installed skill's frontmatter (name + description) is loaded every session too — it is
  // how the agent knows the skill exists. Leaving it out understated the cost by about a third.
  let chars = 0;
  let n = 0;
  try {
    for (const dir of fs.readdirSync(path.join(root, SKILLS_STORE))) {
      try {
        const md = fs.readFileSync(path.join(root, SKILLS_STORE, dir, "SKILL.md"), "utf8");
        const fm = md.match(/^---\n([\s\S]*?)\n---/);
        if (fm) {
          chars += fm[1].length;
          n++;
        }
      } catch {
        /* not a skill dir */
      }
    }
  } catch {
    /* no skill store */
  }
  if (n) out.push({ file: `${n} skill description${n > 1 ? "s" : ""}`, tokens: Math.round(chars / 4), skills: true });
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
      when: on && cfg ? m.when(cfg, abs) : "off",
      knob: m.knob,
      value,
      also: (m.also ?? []).filter((k) => cfg?.[k] !== undefined).map((k) => ({ knob: k, value: cfg[k] })),
      offValue: m.off,
      fired30d: m.score ? (fired[m.score] ?? 0) : null,
      note,
    });
  }
  return {
    root: abs,
    installed: Boolean(manifest),
    // A committed install on a clone that has not run bearing yet (pre-2.0.3 repos never committed
    // the record). "No bearing install" there was false: the hooks were registered and firing.
    sharedNoRecord: !manifest && hasSharedInstall(abs).shared,
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
  if (!s.installed && s.sharedNoRecord) {
    L.push(`${s.root}: bearing is committed here, but this checkout has no install record yet.`);
    L.push("  Run `bearing update` — it reads the modules from disk and writes the record, which you then commit.");
    console.log(L.join("\n"));
    return 0;
  }
  if (!s.installed) {
    L.push(`${s.root}: no bearing install (${MANIFEST_PATH} is missing) — bearing doctor says more`);
    console.log(L.join("\n"));
    return 1;
  }
  L.push(`${s.root}`);
  L.push(`  bearing ${s.kitVersion ?? "?"} · runtime ${s.runtime ?? "?"} · ${s.features.join(", ") || "no modules"}`);

  L.push("", "Always loaded");
  if (!s.alwaysLoaded.length) L.push("  nothing");
  for (const a of s.alwaysLoaded) {
    L.push(a.skills
      ? `  ${a.file} (name + description each) ≈ ${a.tokens.toLocaleString("en-US")} tokens`
      : `  ${a.file}: bearing's block ≈ ${a.tokens.toLocaleString("en-US")} tokens (characters ÷ 4)`);
  }

  L.push("", "Speaks up without being asked");
  if (!s.moments.length) {
    L.push(String(s.runtime ?? "").match(/claude|both|all/)
      ? "  nothing found on disk — the hooks are registered but missing; `bearing doctor` names them"
      : "  nothing — only Claude Code has the hooks these need (NS-14)");
  } else {
    const w = Math.max(...s.moments.map((m) => m.name.length));
    for (const m of s.moments) {
      const mark = m.on === null ? "?" : m.on ? "✓" : "·";
      const count = m.fired30d === null ? "" : ` · fired ${m.fired30d}× in 30 days`;
      L.push(`  ${mark} ${m.name.padEnd(w)}  ${m.when}`);
      const own = m.value === undefined ? `${m.knob}: —` : `${m.knob}: ${JSON.stringify(m.value)} (off: ${JSON.stringify(m.offValue)})`;
      const knob = [...(m.also ?? []).map((a) => `${a.knob}: ${JSON.stringify(a.value)}`), own].join(" · ");
      L.push(`    ${" ".repeat(w)}  ${knob}${count}`);
      if (m.note) L.push(`    ${" ".repeat(w)}  ${m.note}`);
    }
    L.push(
      "  Knobs go in .bearing/hooks.json (team, committed) or .bearing/hooks.local.json (this machine, wins) —\n" +
        "  except turning consultNudge or sessionsWarn on or off: that registers the hook in the committed\n" +
        "  .claude/settings.json, so set those two in hooks.json, or every teammate's update flips it.",
    );
    if (s.configFrom === "package") L.push("  (read with this package's config loader — the installed one is missing)");
  }

  L.push("", "On ask — name it in a prompt, or /<skill> in Claude Code");
  L.push(s.skills.length ? `  ${s.skills.join(" · ")}` : "  no skills installed");
  console.log(L.join("\n"));
  return 0;
}
