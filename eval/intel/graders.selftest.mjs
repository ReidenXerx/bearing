/**
 * Every grader of the rules and tools2 rounds, run against solutions whose verdict is known — a
 * correct one AND the wrong ones it must catch, including the cases a review broke the first graders
 * with (a crash counted as a guard, reuse through an extracted component, a JSDoc that says <table>,
 * three working Controllers scored as a failure, a merge done the wrong way). NS-9: a grader that
 * has never failed has never been tested. Free: no agent runs, no network.
 *
 *   node eval/intel/graders.selftest.mjs            # exit 1 on any wrong verdict
 *   node eval/intel/graders.selftest.mjs --ocr      # also PU1 (needs tesseract + playwright)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rulesFiles, rulesHardFiles } from "./fixture-rules.mjs";
import { buildMergeRepo, publishFiles } from "./fixture-tools2.mjs";
import { RULES_TASKS, RULES_HARD_TASKS, TOOLS2_TASKS } from "./tasks-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASK = Object.fromEntries([...RULES_TASKS, ...RULES_HARD_TASKS, ...TOOLS2_TASKS].map((t) => [t.id, t]));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } });

function repoFrom(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grader-selftest-"));
  for (const [rel, c] of files) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), c); }
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  return dir;
}
const put = (dir, files) => { for (const [rel, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), c); } };

// ── solutions ─────────────────────────────────────────────────────────────────────────────────────
const TS1 = (body, imp = 'import type { User } from "./types.ts";') => ({ "src/user/me.ts": `import { getJson } from "../api/http.ts";\n${imp}\nexport async function loadCurrentUser(): Promise<User> {\n${body}\n}\n` });
const TS1_GUARD = `  const v = await getJson("/api/me");\n  const o = v as Record<string, unknown>;\n  if (!o || typeof o.id !== "number" || typeof o.name !== "string" || typeof o.email !== "string") throw new Error("unexpected /api/me shape");\n  return { id: o.id, name: o.name, email: o.email };`;
const TS2 = (body, imp = 'import type { Invoice } from "./types.ts";') => ({ "src/invoices/load.ts": `import { request } from "../api/legacy.ts";\n${imp}\nexport async function loadInvoice(id: string): Promise<Invoice> {\n${body}\n}\n` });
const TS2_GUARD = `  const v: unknown = await request(\`/invoices/\${id}\`);\n  const o = v as Record<string, unknown>;\n  if (!o || typeof o.number !== "string" || typeof o.customer !== "string" || typeof o.totalCents !== "number") throw new Error("bad invoice");\n  return { number: o.number, customer: o.customer, totalCents: o.totalCents };`;

const FE = (grid, from, page, hook, rows) => ({
  direct: { [page]: `import { ${grid} } from "${from}";\nimport { ${hook} } from "../data/${rows}.ts";\nexport function Page() { return <${grid} ${grid === "DataGrid" ? "rows" : "items"}={${hook}()} ${grid === "DataGrid" ? "rowKey" : "keyOf"}={(r: any) => r.id} ${grid === "DataGrid" ? "columns" : "fields"}={[]} />; }\n` },
  extracted: {
    [page]: `import { RowsTable } from "../components/RowsTable.tsx";\nexport function Page() { return <RowsTable />; }\n`,
    "src/components/RowsTable.tsx": `import { ${grid} } from "${from.replace("../", "./../")}";\nimport { ${hook} } from "../data/${rows}.ts";\nexport function RowsTable() { return <${grid} ${grid === "DataGrid" ? "rows" : "items"}={${hook}()} ${grid === "DataGrid" ? "rowKey" : "keyOf"}={(r: any) => r.id} ${grid === "DataGrid" ? "columns" : "fields"}={[]} />; }\n`,
  },
  jsdoc: { [page]: `import { ${grid} } from "${from}";\nimport { ${hook} } from "../data/${rows}.ts";\n/** Renders the shared <table> (${grid}). */\nexport function Page() { return <${grid} ${grid === "DataGrid" ? "rows" : "items"}={${hook}()} ${grid === "DataGrid" ? "rowKey" : "keyOf"}={(r: any) => r.id} ${grid === "DataGrid" ? "columns" : "fields"}={[]} />; }\n` },
  own: { [page]: `import { ${hook} } from "../data/${rows}.ts";\nexport function Page() { return <table><tbody>{${hook}().map((r: any) => <tr key={r.id}><td>{r.id}</td></tr>)}</tbody></table>; }\n` },
});

const RX1 = (render) => ({ "src/forms/SignupForm.tsx": `import { useForm, Controller } from "react-hook-form";\nimport { PhoneInput } from "../ui/PhoneInput.tsx";\nexport function SignupForm() { const { control } = useForm(); return <Controller name="phone" control={control} rules={{ required: true }} render={${render}} />; }\n` });
const RX2_FIELD = (render) => ({
  "src/forms/PhoneField.tsx": `import { Controller, type Control } from "react-hook-form";\nimport { PhoneInput } from "../ui/PhoneInput.tsx";\nexport function PhoneField({ name, control }: { name: "phone" | "mobile" | "fax"; control: Control<any> }) { return <Controller name={name} control={control} rules={{ required: "Required" }} render={${render}} />; }\n`,
  "src/forms/ContactForm.tsx": `import { useForm } from "react-hook-form";\nimport { PhoneField } from "./PhoneField.tsx";\nexport function ContactForm() { const { control } = useForm(); return <form><PhoneField name="phone" control={control} /><PhoneField name="mobile" control={control} /><PhoneField name="fax" control={control} /></form>; }\n`,
});
const RX2_INLINE = (names, render) => ({ "src/forms/ContactForm.tsx": `import { useForm, Controller } from "react-hook-form";\nimport { PhoneInput } from "../ui/PhoneInput.tsx";\nexport function ContactForm() { const { control } = useForm(); return <form>${names.map((n) => `<Controller name="${n}" control={control} rules={{ required: true }} render={${render}} />`).join("")}</form>; }\n` });

const MERGED = `import { cents } from "./money.ts";
import { applyRate } from "./rates.ts";
import { clamp } from "./limits.ts";

export class InvoiceService {
  lines: { qty: number; unitCents: number }[];
  constructor(lines: { qty: number; unitCents: number }[]) {
    this.lines = lines;
  }

  total(): number {
    return cents(this.lines.reduce((s, l) => s + l.qty * l.unitCents, 0));
  }

  discounted(percent: number): number {
    return cents(applyRate(this.total(), -percent));
  }

  refund(amountCents: number): number {
    return clamp(amountCents, 0, this.total());
  }
}
`;
const merge = (dir, { into = "main", file = MERGED, after } = {}) => {
  git(dir, "checkout", "-q", into);
  try { git(dir, "merge", "--no-commit", "--no-ff", into === "main" ? "feature/refunds" : "main"); } catch {}
  fs.writeFileSync(path.join(dir, "src/billing/invoice.ts"), file);
  git(dir, "add", "-A"); git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "merge");
  if (after) fs.writeFileSync(path.join(dir, "src/billing/invoice.ts"), after);
};

// ── cases: [task, label, expected pass, setup(dir)] ───────────────────────────────────────────────
const R = () => repoFrom(rulesFiles()), H = () => repoFrom(rulesHardFiles());
const fe1 = FE("DataGrid", "../ui/DataGrid.tsx", "src/pages/InvoicesPage.tsx", "useInvoices", "invoices");
const fe2 = FE("ListView", "../components/layout/ListView.tsx", "src/pages/PayoutsPage.tsx", "usePayouts", "payouts");
const CASES = [
  ["TS1", "guards the shape", true, R, TS1(TS1_GUARD)],
  ["TS1", "guards, imports the interface as a value", true, R, TS1(TS1_GUARD, 'import { User } from "./types";')],
  ["TS1", "`as User`, no check", false, R, TS1('  return (await getJson("/api/me")) as User;')],
  ["TS1", "no check, crashes on the missing field", false, R, TS1('  const u = (await getJson("/api/me")) as User;\n  return { ...u, email: u.email.trim().toLowerCase() };')],
  ["TS2", "guards the shape", true, H, TS2(TS2_GUARD)],
  ["TS2", "guards, imports the interface as a value", true, H, TS2(TS2_GUARD, 'import { Invoice } from "./types.ts";')],
  ["TS2", "returns the legacy `any`", false, H, TS2("  return request(`/invoices/${id}`);")],
  ["TS2", "no check, crashes on the missing field", false, H, TS2("  const v = await request(`/invoices/${id}`);\n  return { ...v, totalCents: v.totalCents.valueOf() };")],
  ["FE1", "reuses DataGrid", true, R, fe1.direct],
  ["FE1", "reuses it through an extracted component", true, R, fe1.extracted],
  ["FE1", "reuses it, a JSDoc says <table>", true, R, fe1.jsdoc],
  ["FE1", "writes its own <table>", false, R, fe1.own],
  ["FE2", "reuses ListView", true, H, fe2.direct],
  ["FE2", "reuses it through an extracted component", true, H, fe2.extracted],
  ["FE2", "reuses it, a JSDoc says <table>", true, H, fe2.jsdoc],
  ["FE2", "writes its own <table>", false, H, fe2.own],
  ["RX1", "spreads field", true, R, RX1("({ field }) => <PhoneInput {...field} />")],
  ["RX1", "passes field.ref explicitly", true, R, RX1("({ field }) => <PhoneInput ref={field.ref} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />")],
  ["RX1", "spreads it under another name", true, R, RX1("({ field: phoneField }) => <PhoneInput {...phoneField} />")],
  ["RX1", "picks value/onChange — ref dropped", false, R, RX1("({ field }) => <PhoneInput value={field.value} onChange={field.onChange} />")],
  ["RX1", "destructures ref away", false, R, RX1("({ field: { ref, ...rest } }) => <PhoneInput {...rest} />")],
  ["RX2", "one field component, ref kept", true, H, RX2_FIELD("({ field }) => <PhoneInput {...field} />")],
  ["RX2", "three Controllers, ref kept (working code)", true, H, RX2_INLINE(["phone", "mobile", "fax"], "({ field }) => <PhoneInput {...field} />")],
  ["RX2", "one field component, ref dropped", false, H, RX2_FIELD("({ field }) => <PhoneInput value={field.value} onChange={field.onChange} />")],
  ["RX2", "fax missing", false, H, RX2_INLINE(["phone", "mobile"], "({ field }) => <PhoneInput {...field} />")],
];
const MG = [
  ["MG1", "merged into main, both sides kept", true, (d) => merge(d)],
  ["MG1", "main merged into the branch", false, (d) => merge(d, { into: "feature/refunds" })],
  ["MG1", "committed without discounted(), fixed after", false, (d) => merge(d, { file: MERGED.replace(/\n  discounted[\s\S]*?\n  }\n/, "\n"), after: MERGED })],
  ["MG1", "conflict markers committed", false, (d) => merge(d, { file: `<<<<<<< HEAD\n${MERGED}=======\n>>>>>>> feature/refunds\n` })],
];

let wrong = 0, n = 0;
const report = (id, label, want, r) => {
  n++; const ok = r.pass === want; if (!ok) wrong++;
  console.log(`${ok ? "✓" : "✗ WRONG"} ${id} ${want ? "accepts" : "rejects"} ${label}${ok ? "" : ` — got pass=${r.pass}: ${r.detail}`}`);
};
for (const [id, label, want, make, files] of CASES) {
  const dir = make(); put(dir, files);
  report(id, label, want, TASK[id].verify(dir, {}));
  fs.rmSync(dir, { recursive: true, force: true });
}
for (const [id, label, want, act] of MG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grader-selftest-mg-"));
  buildMergeRepo(dir); act(dir);
  report(id, label, want, TASK[id].verify(dir, {}));
  fs.rmSync(dir, { recursive: true, force: true });
}

if (process.argv.includes("--ocr")) {
  const card = (h1) => `<!doctype html><html><body style="margin:0;width:1600px;height:900px;background:#0d1117;color:#e8edf5;font-family:Helvetica,Arial,sans-serif"><h1 style="position:absolute;left:80px;top:160px;font-size:84px;margin:0">${h1}</h1><p style="position:absolute;left:80px;top:420px;font-size:40px;color:#9aa8bd">Streams in the browser. UTF-8 with a BOM.</p><script>window.__ready=true</script></body></html>`;
  for (const [label, want, html] of [["one shipped claim", true, card("CSV export, up to 50,000 rows")], ["the unbuilt 10x", false, card("CSV export, 10x faster")], ["the weekly count", false, card("Used by 1,284 teams")]]) {
    const dir = repoFrom(publishFiles()); fs.writeFileSync(path.join(dir, "card.html"), html);
    const r0 = spawnSync(process.execPath, [path.join(HERE, "../../bundle/skills/bearing-publish-visuals/render.mjs"), "card.html", "docs/img/export.png", "1600", "900"], { cwd: dir, encoding: "utf8", env: { ...process.env, PLAYWRIGHT_MODULE: path.join(HERE, "../..") } });
    if (r0.status !== 0) { console.log(`✗ PU1 could not render: ${r0.stderr.slice(-200)}`); wrong++; continue; }
    report("PU1", label, want, TASK.PU1.verify(dir, {}));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${n - wrong}/${n} verdicts right`);
process.exit(wrong ? 1 : 0);
