/**
 * The ten teaching-eval tasks (docs/design/gitnexus-teaching.md §7). Each is built from a shape in
 * the fleet's fallback log, and none names a tool: the question is whether the agent reaches for the
 * right one, not whether it follows instructions.
 *
 * List tasks are scored against the construction keys in fixture.mjs (cross-checked by text in
 * verify-keys.mjs). Edit tasks are scored by a check the HARNESS owns and the agent never sees, so it
 * cannot be edited to pass (NS-9: a check the subject can change proves nothing).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { keys } from "./fixture.mjs";

const K = keys();
const ANSWER =
  "\n\nDo not modify any files. When you are done, finish with ONE line in exactly this form:\n" +
  'ANSWER: ["path/one.ts", "path/two.tsx"]\n' +
  "— a JSON array of repo-relative file paths, nothing after it.";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Load a .ts module from `dir` with Node's type stripping and run `expr` against it. */
function runTs(dir, rel, expr) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
      `const m = await import(${JSON.stringify(path.join(dir, rel))}); const out = (${expr})(m); console.log(JSON.stringify(out));`],
    { encoding: "utf8", timeout: 20000 },
  );
  if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout).trim().slice(0, 400) };
  try {
    return { ok: true, value: JSON.parse(r.stdout.trim().split("\n").pop()) };
  } catch {
    return { ok: false, detail: r.stdout.slice(0, 400) };
  }
}

export const TASKS = [
  {
    id: "T1",
    title: "Blast radius of a plain function across modules",
    shape: "graph should win",
    kind: "list",
    key: K.rateForCallers,
    prompt:
      "I'm about to change the signature of `rateFor` in packages/core/src/pricing/rates.ts. " +
      "List every file whose code calls it — directly, or by calling `quoteShipping` (which wraps it)." + ANSWER,
  },
  {
    id: "T2",
    title: "Every consumer of a JSX component, through barrels and an alias",
    shape: "JSX — graph count is a floor",
    kind: "list",
    key: K.dataTableRenderers,
    prompt: "List every file that renders the `DataTable` component defined in packages/core/src/ui/DataTable.tsx." + ANSWER,
  },
  {
    id: "T3",
    title: "Users of an object-literal helper property",
    shape: "object-literal property — ACCESSES blind spot",
    kind: "list",
    key: K.ledgerCellUsers,
    prompt:
      "List every file that uses `accountingHelpers.formatLedgerCell` (packages/core/src/helpers/accountingHelpers.ts) — " +
      "whether it calls it or passes it on to something else." + ANSWER,
  },
  {
    id: "T4",
    title: "Callers of a method reached through context / props",
    shape: "DI / context dispatch",
    kind: "list",
    key: K.sessionRefreshCallers,
    prompt: "List every file that calls `refreshToken` on the app's `SessionStore` (packages/core/src/stores/SessionStore.ts)." + ANSWER,
  },
  {
    id: "T5",
    title: "Fix a bug in a linked worktree on a new branch",
    shape: "out of index scope (NS-26)",
    kind: "edit",
    cwd: "worktree",
    /** Branch + worktree with a buggy discount, committed; the index stays on main's checkout. */
    setup(slot, wt) {
      git(slot, "worktree", "add", "-q", "-b", `feature/discounts-${path.basename(wt)}`, wt, "HEAD");
      fs.writeFileSync(
        path.join(wt, "packages/checkout/src/discount.ts"),
        "/** Apply a percentage discount to a total in minor units. */\n" +
          "export function applyDiscount(totalCents: number, percent: number): number {\n" +
          "  if (percent < 0 || percent > 100) throw new Error(\"percent must be 0–100\");\n" +
          "  return totalCents - percent;\n" +
          "}\n",
      );
      const cart = path.join(wt, "packages/checkout/src/cart.ts");
      fs.writeFileSync(
        cart,
        fs.readFileSync(cart, "utf8").replace(
          `import { rateFor, type Tier } from "@acme/core";`,
          `import { rateFor, type Tier } from "@acme/core";\nimport { applyDiscount } from "./discount";`,
        ) +
          "\nexport function discountedTotal(lines: Line[], tier: Tier, percent: number): number {\n" +
          "  return applyDiscount(cartTotal(lines, tier), percent);\n}\n",
      );
      git(wt, "add", "-A");
      git(wt, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "Add percentage discounts");
    },
    prompt:
      "On this branch, a 15% discount on a $100.00 cart comes out as $99.85 — it should be $85.00. " +
      "Find the bug and fix it. Keep the change minimal.",
    verify(dir) {
      const r = runTs(dir, "packages/checkout/src/discount.ts", "(m) => [m.applyDiscount(10000, 15), m.applyDiscount(5000, 10), m.applyDiscount(999, 0), m.applyDiscount(10000, 100)]");
      if (!r.ok) return { pass: false, detail: r.detail };
      const want = [8500, 4500, 999, 0];
      return { pass: JSON.stringify(r.value) === JSON.stringify(want), detail: `got ${JSON.stringify(r.value)}, want ${JSON.stringify(want)}` };
    },
  },
  {
    id: "T6",
    title: "Find where a config/CSS value is set",
    shape: "not a symbol question",
    kind: "list",
    key: K.brandColorFiles,
    prompt: "Where is the brand colour #3987e5 set or hard-coded? List every file that contains it, in any form." + ANSWER,
  },
  {
    id: "T7",
    title: "Rename a symbol that has namesakes",
    shape: "rename with collisions",
    kind: "edit",
    prompt:
      "Rename `formatAmount` in packages/core/src/money/format.ts to `formatMoney`, and update everything that uses it. " +
      "Nothing else in the repository should change.",
    verify(dir) {
      const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
      const problems = [];
      const core = read("packages/core/src/money/format.ts");
      if (!/export function formatMoney\(/.test(core)) problems.push("core does not export formatMoney");
      if (/\bformatAmount\b/.test(core)) problems.push("core still mentions formatAmount");
      for (const f of K.formatAmountCallers) {
        const t = read(f);
        if (/\bformatAmount\b/.test(t)) problems.push(`${f} still uses formatAmount`);
        if (!/\bformatMoney\(/.test(t)) problems.push(`${f} no longer calls formatMoney`);
      }
      // The decoys must be byte-identical: a namesake function and a config key. Raw bytes — the
      // trimming `git()` helper drops the trailing newline, and an earlier version of this check
      // therefore failed EVERY rename, correct ones included, on files nobody had touched.
      const head = (rel) => execFileSync("git", ["show", `HEAD:${rel}`], { cwd: dir, encoding: "utf8" });
      for (const decoy of ["packages/legacy/src/legacyFormat.ts", "apps/admin/src/featureFlags.ts"]) {
        if (read(decoy) !== head(decoy)) problems.push(`decoy changed: ${decoy}`);
      }
      const allowed = new Set(["packages/core/src/money/format.ts", ...K.formatAmountCallers]);
      const changed = git(dir, "diff", "--name-only", "HEAD").split("\n").filter(Boolean);
      for (const f of changed) if (!allowed.has(f)) problems.push(`unexpected change: ${f}`);
      return { pass: problems.length === 0, detail: problems.join("; ") || "clean rename" };
    },
  },
  {
    id: "T8",
    title: "What a staged diff affects",
    shape: "detect_changes",
    kind: "list",
    key: K.ratesDependentPages,
    setup(slot) {
      const f = path.join(slot, "packages/core/src/pricing/rates.ts");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("express: 1.8", "express: 1.95"));
      git(slot, "add", "packages/core/src/pricing/rates.ts");
    },
    prompt: "I've staged a change. Which app screens — files under apps/ — could show different numbers because of it?" + ANSWER,
  },
  {
    id: "T9",
    title: "Who changes a field",
    shape: "field writes (ACCESSES write)",
    kind: "list",
    key: K.invoiceStatusWriters,
    prompt:
      "List every file that changes the status of an `Invoice` (packages/core/src/models/Invoice.ts) — " +
      "by assigning it, or by producing an updated copy of the invoice." + ANSWER,
  },
  {
    id: "T10",
    title: "Read a known long file and fix an off-by-one",
    shape: "cost of the read guard",
    kind: "edit",
    prompt:
      "`pageCount(101, 10)` in packages/core/src/pagination/paginate.ts returns 10, but it should return 11. Fix it.",
    verify(dir) {
      const r = runTs(dir, "packages/core/src/pagination/paginate.ts",
        "(m) => [m.pageCount(101, 10), m.pageCount(100, 10), m.pageCount(0, 10), m.pageCount(1, 10), m.paginate(Array.from({ length: 25 }, (_, i) => i), 3, 10).items.length]");
      if (!r.ok) return { pass: false, detail: r.detail };
      const want = [11, 10, 0, 1, 5];
      return { pass: JSON.stringify(r.value) === JSON.stringify(want), detail: `got ${JSON.stringify(r.value)}, want ${JSON.stringify(want)}` };
    },
  },
];

/**
 * Score a list answer against its key.
 * @param {string} text the agent's final message
 * @param {string[]} key
 * @param {string} cwd for turning absolute paths back into repo-relative ones
 */
export { scoreList } from "../lib/score-list.mjs";
