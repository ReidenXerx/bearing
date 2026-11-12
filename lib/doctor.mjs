/**
 * `bearing doctor` — is this install healthy, read from the disk, changing nothing.
 *
 * Why it exists: bearing's own repo ran every hook TWICE for weeks. A stealth install had left
 * its registrations in `.claude/settings.local.json`; a later shared install wrote them again to
 * `.claude/settings.json`; Claude Code ran both. Two of those registrations pointed at hooks an
 * update had already deleted, so they failed on every tool call — and nothing said so. It was found
 * by noticing a reminder appear twice. The post-install checks could not have seen it: they run at
 * install time, on the files that install wrote, and the stale file was neither.
 *
 * So doctor asks what an install looks like NOW, any time, on any install — not only the gitnexus
 * ones, which is all `scripts/bearing-verify.mjs` reaches (NS-21). It reuses every post-install
 * check (they read the disk, not the installer's intent) and adds the hook checks that failure needed.
 *
 * Every finding names its fix, and the fix it names must actually clear it — the test runs it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MANIFEST_PATH } from "./constants.mjs";
import { readJsonSafe } from "./adapters/json-util.mjs";
import { runPostChecks } from "./postcheck.mjs";
import { hasSharedInstall } from "./stealth.mjs";

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];
const HOOK_SCRIPT = /\.claude\/hooks\/((?:bearing|gitnexus)-[\w.-]+\.mjs)/;

/** Every bearing hook registration, in every settings file Claude Code merges. */
function hookRegistrations(root) {
  const out = [];
  for (const rel of SETTINGS) {
    const cfg = readJsonSafe(path.join(root, rel), null);
    for (const [event, groups] of Object.entries(cfg?.hooks ?? {})) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of g?.hooks ?? []) {
          const m = String(h?.command ?? "").match(HOOK_SCRIPT);
          if (m) out.push({ file: rel, event, matcher: g.matcher ?? "", script: m[1] });
        }
      }
    }
  }
  return out;
}

function checkHooksOnce(regs) {
  const seen = new Map();
  for (const r of regs) {
    const k = `${r.event} ${r.matcher} ${r.script}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(r.file);
  }
  const dup = [...seen.entries()].filter(([, files]) => files.length > 1);
  return {
    id: "hooks_once",
    ok: dup.length === 0,
    label: "each bearing hook is registered once",
    detail: dup.length
      ? `${dup.length} registered more than once, so Claude Code runs them twice: ` +
        dup.slice(0, 4).map(([k, files]) => `${k.split(" ").pop()} (${files.join(" + ")})`).join("; ") +
        (dup.length > 4 ? "; …" : "")
      : `${regs.length} registration(s), none duplicated`,
    fix: "bearing update",
  };
}

function checkHooksResolve(root, regs) {
  const missing = [...new Set(regs.filter((r) => !fs.existsSync(path.join(root, ".claude/hooks", r.script))).map((r) => `${r.script} (${r.file})`))];
  return {
    id: "hooks_resolve",
    ok: missing.length === 0,
    label: "every registered hook exists",
    detail: missing.length
      ? `registered but not on disk, so it fails on every tool call: ${missing.join("; ")}`
      : "all present",
    fix: "bearing update",
  };
}

/** Compare dotted versions numerically; a pre-release or junk segment compares as 0. */
function cmpVersion(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function checkCurrent(manifest, packageVersion) {
  const v = manifest?.kitVersion;
  if (!v || !packageVersion) {
    return { id: "install_current", ok: true, label: "installed by this version", detail: "version unknown — not checked" };
  }
  const c = cmpVersion(v, packageVersion);
  return {
    id: "install_current",
    ok: c >= 0,
    label: "installed by this version",
    detail: c < 0 ? `installed by ${v}; this is ${packageVersion}` : c > 0 ? `installed by ${v}, newer than this ${packageVersion}` : v,
    fix: "bearing update",
  };
}

/**
 * Retired hook-config keys, read with THIS package's list — an old install's own copy is older.
 *
 * Two fixes, and the hint has to name the right one. A key still holding the value bearing seeded
 * is removed by `update`; a value someone chose is theirs, and update leaves it. The first draft of
 * this check said "delete them by hand, update leaves them" for every key — and on the first fleet
 * run every flagged key was a seeded one that update removes (NS-20).
 */
async function checkRetiredKeys(root, bundleRoot) {
  let mod;
  try {
    mod = await import(pathToFileURL(path.join(bundleRoot, ".bearing/lib/hook-helpers.mjs")).href);
  } catch {
    return null;
  }
  const inUse = mod.retiredHookKeysInUse?.(root) ?? [];
  const seeded = mod.SEEDED_RETIRED_VALUES ?? {};
  const theirs = inUse.filter((k) => {
    const cfg = readJsonSafe(path.join(root, k.file), {});
    return !(k.key in seeded) || JSON.stringify(cfg?.[k.key]) !== JSON.stringify(seeded[k.key]);
  });
  return {
    id: "retired_hook_keys",
    ok: inUse.length === 0,
    label: "hook config has no retired keys",
    detail: inUse.length
      ? `read by nothing: ${inUse.map((k) => `${k.key} in ${k.file}`).join("; ")}`
      : "none",
    fix: theirs.length
      ? `${theirs.length < inUse.length ? "bearing update removes the ones still at bearing's default; " : ""}` +
        `delete by hand the one(s) you set: ${theirs.map((k) => `${k.key} in ${k.file}`).join("; ")}`
      : "bearing update",
  };
}

/**
 * @param {string} root
 * @param {{ packageVersion?: string, bundleRoot: string }} ctx
 * @returns {Promise<{ root: string, installed: boolean, findings: object[], defects: object[], environmental: object[] }>}
 */
export async function doctor(root, { packageVersion, bundleRoot }) {
  const abs = path.resolve(root);
  const manifest = readJsonSafe(path.join(abs, MANIFEST_PATH), null);
  if (!manifest) {
    // The manifest is gitignored, so a clone or worktree of a repo that COMMITTED its install has
    // none — the ordinary team case. The install there is real; this clone has just never recorded
    // its modules, and `update` infers them from disk and writes one. Advising `install` here — the
    // first draft did, for fourteen worktrees on the first fleet run — is advice to redo what exists.
    if (hasSharedInstall(abs).shared) {
      const regs = hookRegistrations(abs);
      const findings = [
        {
          id: "manifest",
          ok: false,
          warn: true,
          label: "this clone has a manifest",
          detail: "bearing is committed here, but this clone never recorded which modules it has",
          fix: "bearing update",
        },
        checkHooksOnce(regs),
        checkHooksResolve(abs, regs),
      ];
      const failed = findings.filter((f) => !f.ok);
      return { root: abs, installed: true, findings, defects: failed.filter((f) => !f.warn), environmental: failed.filter((f) => f.warn) };
    }
    const f = { id: "manifest", ok: false, label: "a bearing install", detail: `no ${MANIFEST_PATH}`, fix: "bearing install" };
    return { root: abs, installed: false, findings: [f], defects: [f], environmental: [] };
  }
  const features = new Set(manifest.features ?? []);
  const regs = hookRegistrations(abs);
  const findings = [
    checkCurrent(manifest, packageVersion),
    checkHooksOnce(regs),
    checkHooksResolve(abs, regs),
    await checkRetiredKeys(abs, bundleRoot),
    ...runPostChecks(abs, { features, mcpTransport: manifest.mcpTransport, gitnexusCmd: manifest.gitnexusCmd, manifest }),
  ].filter(Boolean);
  const failed = findings.filter((f) => !f.ok);
  return {
    root: abs,
    installed: true,
    findings,
    defects: failed.filter((f) => !f.environmental),
    environmental: failed.filter((f) => f.environmental),
  };
}

/** Human output. Returns the exit code: 1 when anything is a defect, 0 otherwise. */
export function printDoctor(report, { verbose = false } = {}) {
  const lines = [`${report.root}`];
  for (const f of report.findings) {
    if (f.ok && !verbose) continue;
    const mark = f.ok ? "✓" : f.environmental || f.warn ? "⚠" : "✗";
    lines.push(`  ${mark} ${f.label}: ${f.detail}`);
    if (!f.ok && f.fix) lines.push(`      fix: ${f.fix === "bearing update" ? `bearing update ${report.root}` : f.fix}`);
  }
  if (!report.defects.length && !report.environmental.length) {
    lines.push(`  ✓ healthy — ${report.findings.length} check(s) passed`);
  }
  console.log(lines.join("\n"));
  return report.defects.length ? 1 : 0;
}
