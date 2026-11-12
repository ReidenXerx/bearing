/**
 * The REAL round: structural questions asked of a real repository, not a generated fixture.
 *
 * The repository is the user's own (passed as `--repo`), so NOTHING from it is committed here: no
 * paths, no code, no counts beyond the aggregate a report states. The slot is `git archive HEAD` of
 * that repo — tracked files only, no node_modules, no history — and the answer key is computed from
 * that pristine copy by the TypeScript compiler's own parser, loaded from the repo's node_modules.
 *
 * Why the compiler and not ast-grep: ast-grep is the thing under test. An answer key written by the
 * tool being measured would grade it against itself (NS-27). The compiler is an independent parser
 * of the same language, and where the two agree on a count, that agreement is evidence about both.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

/** The directories every task is scoped to. Stated in every prompt, so the key and the ask agree. */
export const REAL_SCOPE = ["src", "lib", "scripts"];

export function repoUnderTest() {
  const repo = process.env.BEARING_EVAL_REPO;
  if (!repo || !fs.existsSync(path.join(repo, ".git"))) {
    throw new Error("the real round needs --repo <path to a git repository> (BEARING_EVAL_REPO)");
  }
  return path.resolve(repo);
}

/** Tracked files at HEAD, nothing else — what a fresh clone would have, minus history. */
export function buildRealFixture(slot) {
  const repo = repoUnderTest();
  fs.mkdirSync(slot, { recursive: true });
  const tar = execFileSync("git", ["-C", repo, "archive", "--format=tar", "HEAD"], { maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", slot], { input: tar, maxBuffer: 1 << 30 });
  // bearing's manifest is usually gitignored, so the archive lacks it, and without it the kit would
  // treat the slot as a fresh install with default modules — not the setup the repo actually runs.
  const manifest = path.join(repo, ".bearing/manifest.json");
  if (fs.existsSync(manifest) && !fs.existsSync(path.join(slot, ".bearing/manifest.json"))) {
    fs.mkdirSync(path.join(slot, ".bearing"), { recursive: true });
    fs.copyFileSync(manifest, path.join(slot, ".bearing/manifest.json"));
  }
}

/** A stamp that changes when the repo's HEAD does, so the slot rebuilds then and only then. */
export function realFixtureStamp() {
  const repo = repoUnderTest();
  return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function loadTs() {
  const req = createRequire(path.join(repoUnderTest(), "package.json"));
  return req("typescript");
}

function scopeFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      // Every JS/TS source, not only .ts: the prompts say "in src/, lib/, scripts/", and the first
      // smoke's agents correctly reported two sites in scripts/*.mjs that a .ts-only key called false.
      else if (/\.(?:tsx?|jsx?|mjs|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
    }
  };
  for (const s of REAL_SCOPE) walk(path.join(dir, s));
  return out.sort();
}

function scriptKind(ts, file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.ts$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function parse(ts, file) {
  const kind = scriptKind(ts, file);
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

/**
 * One site = one call, with every line an agent could reasonably cite for it: where the call starts,
 * where the method name sits (a chained `.query` is often on the next line), and where the first
 * argument starts. A reported `path:line` matches a site when the line is any of these.
 */
function site(sf, rel, call, nameNode) {
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const lines = new Set([at(call), at(nameNode)]);
  if (call.arguments[0]) lines.add(at(call.arguments[0]));
  return { file: rel, lines: [...lines].sort((a, b) => a - b) };
}

/** Every structural answer key, computed from a pristine copy. */
export function realKeys(dir) {
  const ts = loadTs();
  const sqlInterp = [];
  const catchDrops = [];
  const parseIntNoRadix = [];
  let queryCalls = 0;
  let catchErrorCalls = 0;
  for (const abs of scopeFiles(dir)) {
    const rel = path.relative(dir, abs);
    const sf = parse(ts, abs);
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "query") {
          queryCalls++;
          if (n.arguments[0] && ts.isTemplateExpression(n.arguments[0])) sqlInterp.push(site(sf, rel, n, callee.name));
        }
        const isParseInt =
          (ts.isIdentifier(callee) && callee.text === "parseInt") ||
          (ts.isPropertyAccessExpression(callee) && callee.name.text === "parseInt" &&
            ts.isIdentifier(callee.expression) && callee.expression.text === "Number");
        if (isParseInt && n.arguments.length === 1) {
          parseIntNoRadix.push({ ...site(sf, rel, n, ts.isIdentifier(callee) ? callee : callee.name), argText: n.arguments[0].getText(sf) });
        }
      }
      if (ts.isCatchClause(n)) {
        const v = n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name) ? n.variableDeclaration.name.text : null;
        const scan = (m) => {
          if (ts.isCatchClause(m)) return; // a nested catch is its own question
          if (ts.isFunctionLike(m)) return; // a callback defined here runs elsewhere
          if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && m.expression.name.text === "error") {
            const recv = m.expression.expression;
            const recvName = ts.isIdentifier(recv) ? recv.text : ts.isPropertyAccessExpression(recv) ? recv.name.text : "";
            if (/logger$/i.test(recvName) || recvName === "console") {
              catchErrorCalls++;
              let refs = false;
              const find = (k) => {
                if (refs) return;
                if (v && ts.isIdentifier(k) && k.text === v) refs = true;
                else ts.forEachChild(k, find);
              };
              m.arguments.forEach(find);
              if (!refs) catchDrops.push(site(sf, rel, m, m.expression.name));
            }
          }
          ts.forEachChild(m, scan);
        };
        ts.forEachChild(n.block, scan);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { sqlInterp, catchDrops, parseIntNoRadix, queryCalls, catchErrorCalls, files: scopeFiles(dir).length };
}

/**
 * Score a reported list of `path:line` against sites. Each site is matched at most once; a report
 * that names a site twice counts once, and a line that is no site's is a false positive.
 */
export function scoreSites(reported, sites) {
  const norm = (s) => String(s).trim().replace(/^\.\//, "");
  const left = sites.map((s) => ({ ...s, hit: false }));
  let fp = 0;
  const seen = new Set();
  for (const r of reported.map(norm)) {
    if (seen.has(r)) continue;
    seen.add(r);
    const m = r.match(/^(.*):(\d+)$/);
    const hit = m && left.find((s) => !s.hit && s.file === m[1] && s.lines.includes(Number(m[2])));
    if (hit) hit.hit = true;
    else fp++;
  }
  const tp = left.filter((s) => s.hit).length;
  return { tp, fp, fn: sites.length - tp, missed: left.filter((s) => !s.hit).map((s) => `${s.file}:${s.lines[0]}`) };
}

/**
 * The decided rewrite, checked token by token: every no-radix `parseInt` in the pristine copy must
 * now pass `10`, and NOTHING else in any file may change. Formatting is free — the comparison runs
 * on tokens, not text, and a trailing comma before `)` is ignored.
 */
export function checkRadixRewrite(pristine, cwd) {
  const ts = loadTs();
  const keys = realKeys(pristine);
  const bySite = new Map();
  for (const s of keys.parseIntNoRadix) {
    if (!bySite.has(s.file)) bySite.set(s.file, []);
    bySite.get(s.file).push(s);
  }
  const tokens = (text, file) => {
    const sc = ts.createScanner(ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
    const out = [];
    for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) out.push(sc.getTokenText());
    return out.filter((t, i, a) => !(t === "," && a[i + 1] === ")"));
  };
  /** The pristine file with the canonical edit applied: `, 10` after each target's only argument. */
  const expected = (rel) => {
    const abs = path.join(pristine, rel);
    const sf = parse(ts, abs);
    const text = sf.getFullText();
    const ends = [];
    const visit = (n) => {
      if (ts.isCallExpression(n) && n.arguments.length === 1) {
        const c = n.expression;
        const isP = (ts.isIdentifier(c) && c.text === "parseInt") ||
          (ts.isPropertyAccessExpression(c) && c.name.text === "parseInt" && ts.isIdentifier(c.expression) && c.expression.text === "Number");
        if (isP) ends.push(n.arguments[0].getEnd());
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    let out = text;
    for (const e of ends.sort((a, b) => b - a)) out = out.slice(0, e) + ", 10" + out.slice(e);
    return out;
  };
  let converted = 0;
  const wrongFiles = [];
  for (const abs of scopeFiles(pristine)) {
    const rel = path.relative(pristine, abs);
    const after = path.join(cwd, rel);
    const actual = fs.existsSync(after) ? fs.readFileSync(after, "utf8") : "";
    const want = bySite.has(rel) ? expected(rel) : fs.readFileSync(abs, "utf8");
    const a = tokens(actual, rel);
    const w = tokens(want, rel);
    if (a.length === w.length && a.every((t, i) => t === w[i])) {
      converted += bySite.get(rel)?.length ?? 0;
    } else {
      wrongFiles.push(rel);
      // Partial credit: count the sites in this file that did get exactly `parseInt(<same arg>, 10)`.
      if (bySite.has(rel)) {
        const flat = a.join(" ");
        for (const s of bySite.get(rel)) {
          const argToks = tokens(s.argText, rel).join(" ");
          if (flat.includes(`parseInt ( ${argToks} , 10 )`)) converted++;
        }
      }
    }
  }
  return { sites: keys.parseIntNoRadix.length, converted, wrongFiles };
}

// ── The history and knip tasks ──────────────────────────────────────────────

/**
 * A slot WITH history, for the history task: a clone of the repo at HEAD, its remote removed so
 * nothing the agent runs can reach the origin. `git archive` (above) carries no history at all.
 */
export function buildRealHistoryFixture(slot) {
  const repo = repoUnderTest();
  fs.rmSync(slot, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--no-local", "--no-hardlinks", repo, slot], { maxBuffer: 1 << 30 });
  execFileSync("git", ["-C", slot, "remote", "remove", "origin"]);
  const manifest = path.join(repo, ".bearing/manifest.json");
  if (fs.existsSync(manifest) && !fs.existsSync(path.join(slot, ".bearing/manifest.json"))) {
    fs.mkdirSync(path.join(slot, ".bearing"), { recursive: true });
    fs.copyFileSync(manifest, path.join(slot, ".bearing/manifest.json"));
  }
}

/** Keys that only a person could write, kept OUTSIDE this repo because they name a private repo's files. */
export function privateKeys() {
  const p = process.env.BEARING_EVAL_KEYS ?? path.join(process.env.HOME ?? "", ".cache/bearing-eval/intel/real-keys.json");
  if (!fs.existsSync(p)) throw new Error(`the knip task needs a hand-verified key at ${p} (see REPORT-REAL.md)`);
  const k = JSON.parse(fs.readFileSync(p, "utf8"));
  const head = execFileSync("git", ["-C", repoUnderTest(), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (k.head !== head) throw new Error(`the private key was verified at ${k.head.slice(0, 7)}, the repo is at ${head.slice(0, 7)} — re-verify it`);
  return k;
}

const FORMAT_SUBJECT = /\b(prettier|format(?:ting)?|reformat|lint --fix|style\()/i;
const squash = (s) => s.replace(/[\s,;]/g, "");

/**
 * The history task's key: lines whose plain `git blame` names a REFORMAT commit, each with the commit
 * that actually wrote it. Found by git, then CHECKED independently of blame (NS-27): the origin
 * commit's own diff must add that line's content (whitespace and commas ignored, since the reformat
 * re-wrapped it), and its subject must not itself be a reformat. A line that fails either is dropped.
 * Picks the first file, newest reformat first, with at least `n` such lines, spaced apart.
 */
export function historyKey(dir, n = 4) {
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
  const fmt = g("log", "--format=%H%x09%s", "-i", "-E", "--grep=prettier|format|reformat|lint --fix|style\\(")
    .split("\n").filter(Boolean).map((l) => l.split("\t")).filter(([, s]) => FORMAT_SUBJECT.test(s));
  for (const [fsha] of fmt) {
    const files = g("show", "--name-only", "--format=", fsha).split("\n")
      .filter((f) => REAL_SCOPE.some((d) => f.startsWith(`${d}/`)) && /\.[cm]?[jt]sx?$/.test(f) && fs.existsSync(path.join(dir, f)));
    for (const file of files) {
      const blame = (extra) => {
        const out = []; let cur = null;
        for (const l of g("blame", "--line-porcelain", ...extra, "--", file).split("\n")) {
          if (/^[0-9a-f]{40} /.test(l)) { cur = { sha: l.slice(0, 40), line: Number(l.split(" ")[2]) }; out.push(cur); }
          else if (l.startsWith("summary ") && cur) cur.subject = l.slice(8);
          else if (l.startsWith("\t") && cur) cur.code = l.slice(1);
        }
        return out;
      };
      const plain = blame([]);
      const past = blame(["--ignore-rev", fsha]);
      const picked = [];
      for (let i = 0; i < plain.length && picked.length < n; i++) {
        const p = plain[i], o = past[i];
        if (p.sha !== fsha || !o || o.sha === fsha || FORMAT_SUBJECT.test(o.subject ?? "")) continue;
        const code = squash(p.code ?? "");
        if (code.length < 25 || picked.some((q) => Math.abs(q.line - p.line) < 15)) continue;
        const added = squash(g("show", "--format=", o.sha, "--", file).split("\n").filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join(" "));
        if (!added.includes(code)) continue; // the origin's own diff must write it
        picked.push({ line: p.line, origin: o.sha, formatter: fsha });
      }
      if (picked.length >= n) return { file, lines: picked };
    }
  }
  return null;
}
