/**
 * The teaching-mode eval fixture: a small TS/React monorepo with the code shapes the fleet's
 * fallback log is made of, each planted on purpose and each next to a DECOY that shares its name.
 *
 * Why synthetic: an answer key has to be known exactly, and it must NOT come from the graph (NS-27)
 * — a key derived from the index cannot see the index being confidently wrong, which 41 of 169
 * logged fallbacks were. Here the key comes from construction (which page was built with which
 * flag), and `verify-keys.mjs` re-derives every key by text search alone. Two independent routes
 * that must agree.
 *
 * Deterministic: same input, same bytes. No randomness, no timestamps.
 */
import fs from "node:fs";
import path from "node:path";

// ── Pages: one row per file, flags say which shapes it contains ─────────────
// dt: renders DataTable ("jsx" | "alias" = imported as Grid) · fmt: calls core formatAmount ·
// ledger: uses accountingHelpers.formatLedgerCell ("call" | "destructure" | "value") ·
// refresh: calls SessionStore.refreshToken ("hook" | "class") · rate: calls rateFor ·
// quote: calls quoteShipping · cart: uses @acme/checkout cartTotal · fee: uses billing shippingFee ·
// invWrite: changes an Invoice's status · orderWrite: changes an Order's status (decoy) ·
// legacyRate / legacyLedger / apiRefresh: decoys sharing a name with a real target.
const WEB = [
  { name: "Dashboard", dt: "jsx", fmt: true, refresh: "hook", rate: true },
  { name: "Invoices", dt: "jsx", fmt: true, ledger: "call" },
  { name: "InvoiceList", dt: "alias", fmt: true },
  { name: "Payments", dt: "jsx", apiRefresh: true, fmt: true },
  { name: "Reports", ledger: "value", dt: "jsx" },
  { name: "Checkout", quote: true, cart: true, fmt: true, refresh: "hook" },
  { name: "Cart", cart: true, fmt: true },
  { name: "Orders", orderWrite: true, dt: "jsx" },
  { name: "Customers", dt: "alias", refresh: "hook" },
  { name: "Settings", refresh: "hook" },
  { name: "Docs", docsMention: true },
  { name: "Ledger", ledger: "destructure", dt: "jsx", fmt: true },
];
const ADMIN = [
  { name: "AdminHome", dt: "jsx", refresh: "class" },
  { name: "InvoiceDetail", invWrite: true, fmt: true },
  { name: "RateCard", rate: true, dt: "jsx" },
  { name: "LegacyQuote", legacyRate: true },
  { name: "AuditLog", refresh: "class", dt: "jsx" },
  { name: "Users", dt: "jsx" },
  { name: "Refunds", invWrite: true, ledger: "call" },
  { name: "Exports", legacyLedger: true },
  { name: "Payouts", fee: true, fmt: true },
  { name: "Taxes", quote: true },
];

const pagePath = (app, name) => `apps/${app}/src/pages/${name}.tsx`;

function page(app, p) {
  const core = new Set();
  const lines = [];
  const body = [];
  const jsx = [];
  if (p.dt === "jsx") (core.add("DataTable"), jsx.push(`      <DataTable rows={rows} columns={columns} />`));
  if (p.dt === "alias") jsx.push(`      <Grid rows={rows} columns={columns} />`);
  if (p.fmt) (core.add("formatAmount"), body.push(`  const label = formatAmount(rows.length * 1250);`));
  if (p.rate) (core.add("rateFor"), body.push(`  const multiplier = rateFor("express");`));
  if (p.quote) (core.add("quoteShipping"), body.push(`  const shipping = quoteShipping(2.5, "standard");`));
  if (p.ledger === "call") (core.add("accountingHelpers"), body.push(`  const cell = accountingHelpers.formatLedgerCell(rows.length);`));
  if (p.ledger === "destructure") {
    core.add("accountingHelpers");
    body.push(`  const { formatLedgerCell } = accountingHelpers;`, `  const cell = formatLedgerCell(42);`);
  }
  if (p.ledger === "value") {
    core.add("accountingHelpers");
    body.push(`  const ledgerColumns = [{ key: "amount", render: accountingHelpers.formatLedgerCell }];`);
  }
  if (p.refresh === "hook") {
    core.add("useStores");
    body.push(`  const { session } = useStores();`, `  React.useEffect(() => { void session.refreshToken(); }, [session]);`);
  }
  if (p.invWrite) {
    core.add("Invoice");
    body.push(
      `  const [invoice, setInvoice] = React.useState<Invoice | null>(null);`,
      `  const settle = () => invoice && setInvoice({ ...invoice, status: "${p.name === "Refunds" ? "void" : "paid"}" });`,
    );
  }
  if (p.orderWrite) {
    core.add("Order");
    body.push(`  const ship = (order: Order) => { order.status = "shipped"; return order; };`);
  }
  if (p.cart) lines.push(`import { cartTotal } from "@acme/checkout";`), body.push(`  const total = cartTotal([{ sku: "A1", qty: 2, priceCents: 1999 }], "express");`);
  if (p.fee) lines.push(`import { shippingFee } from "@acme/billing";`), body.push(`  const fee = shippingFee(3, "overnight");`);
  if (p.legacyRate) lines.push(`import { LegacyPricing } from "@acme/legacy";`), body.push(`  const legacy = new LegacyPricing();`, `  const old = legacy.rateFor("A");`);
  if (p.legacyLedger) lines.push(`import { formatLedgerCell } from "@acme/legacy";`), body.push(`  const exported = formatLedgerCell(7);`);
  if (p.apiRefresh) lines.push(`import { ApiClient } from "@acme/checkout";`), body.push(`  const client = new ApiClient();`, `  React.useEffect(() => { void client.refreshToken(); }, []);`);
  if (p.docsMention) {
    body.push(`  // The DataTable component documents its columns prop in the core README.`);
    jsx.push(`      <p>Tables across the app use the shared DataTable from core.</p>`);
  }

  const imports = [`import React from "react";`];
  if (core.size) imports.push(`import { ${[...core].sort().join(", ")} } from "@acme/core";`);
  if (p.dt === "alias") imports.push(`import { DataTable as Grid } from "@acme/core";`);
  imports.push(...lines);

  const rows = `  const rows: Array<{ id: string }> = [{ id: "a" }, { id: "b" }];`;
  const cols = `  const columns = [{ key: "id", title: "ID" }];`;
  const view = [`    <section className="page page-${p.name.toLowerCase()}">`, `      <h1>${p.name}</h1>`, ...jsx, `    </section>`];

  if (p.refresh === "class") {
    // A class component reaching the store through props: the receiver is `this.props.stores`.
    return [
      ...imports,
      `import type { RootStore } from "@acme/core";`,
      ``,
      `export class ${p.name} extends React.Component<{ stores: RootStore }> {`,
      `  componentDidMount() {`,
      `    void this.props.stores.session.refreshToken();`,
      `  }`,
      ``,
      `  render() {`,
      `  ${rows.trim()}`,
      `  ${cols.trim()}`,
      ...body.map((l) => `  ${l}`),
      `    return (`,
      ...view.map((l) => `  ${l}`),
      `    );`,
      `  }`,
      `}`,
      ``,
    ].join("\n");
  }
  return [...imports, ``, `export function ${p.name}() {`, rows, cols, ...body, `  return (`, ...view, `  );`, `}`, ``].join("\n");
}

// ── Library files ────────────────────────────────────────────────────────────
function paginateTs() {
  // ~300 lines, with the off-by-one in pageCount. Everything else is plausible, correct filler,
  // because T10 measures what it costs to READ a long known file, and a short one would not.
  const out = [
    `/** Pagination helpers shared by every list screen. */`,
    `export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; pageCount: number }`,
    ``,
    `/** How many pages does \`total\` items take at \`pageSize\` per page? */`,
    `export function pageCount(total: number, pageSize: number): number {`,
    `  if (pageSize <= 0) throw new Error("pageSize must be positive");`,
    `  if (total <= 0) return 0;`,
    `  return Math.floor(total / pageSize);`,
    `}`,
    ``,
    `export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {`,
    `  const total = items.length;`,
    `  const count = pageCount(total, pageSize);`,
    `  const safe = Math.min(Math.max(1, page), Math.max(1, count));`,
    `  const start = (safe - 1) * pageSize;`,
    `  return { items: items.slice(start, start + pageSize), page: safe, pageSize, total, pageCount: count };`,
    `}`,
    ``,
  ];
  const helpers = [
    ["clampPage", "page: number, count: number", "return Math.min(Math.max(1, page), Math.max(1, count));"],
    ["firstIndex", "page: number, pageSize: number", "return (Math.max(1, page) - 1) * pageSize;"],
    ["lastIndex", "page: number, pageSize: number, total: number", "return Math.min(total, Math.max(1, page) * pageSize) - 1;"],
    ["hasNext", "page: number, count: number", "return page < count;"],
    ["hasPrev", "page: number", "return page > 1;"],
    ["nextPage", "page: number, count: number", "return Math.min(count, page + 1);"],
    ["prevPage", "page: number", "return Math.max(1, page - 1);"],
    ["pageWindow", "page: number, count: number, width: number", "const half = Math.floor(width / 2);\n  const from = Math.max(1, Math.min(page - half, count - width + 1));\n  return Array.from({ length: Math.min(width, count) }, (_, i) => from + i);"],
    ["rangeLabel", "page: number, pageSize: number, total: number", "if (total === 0) return \"0 of 0\";\n  return `${firstIndex(page, pageSize) + 1}–${lastIndex(page, pageSize, total) + 1} of ${total}`;"],
    ["isValidPageSize", "size: number", "return Number.isInteger(size) && size > 0 && size <= 500;"],
    ["normalizePageSize", "size: number, fallback = 25", "return isValidPageSize(size) ? size : fallback;"],
    ["offsetFor", "page: number, pageSize: number", "return firstIndex(page, pageSize);"],
    ["pageOfIndex", "index: number, pageSize: number", "return Math.floor(index / pageSize) + 1;"],
    ["sliceBounds", "page: number, pageSize: number, total: number", "return [firstIndex(page, pageSize), Math.min(total, firstIndex(page, pageSize) + pageSize)] as const;"],
    ["emptyPage", "pageSize: number", "return { items: [] as never[], page: 1, pageSize, total: 0, pageCount: 0 };"],
  ];
  for (const [name, params, bodyText] of helpers) {
    out.push(`/**`, ` * ${name}: a small, independent pagination helper.`, ` * Kept pure so list screens can call it during render.`, ` */`);
    out.push(`export function ${name}(${params}) {`, `  ${bodyText}`, `}`, ``);
  }
  out.push(`/** Sorting helpers paired with pagination on list screens. */`);
  const sorters = ["byId", "byName", "byCreatedAt", "byUpdatedAt", "byAmount", "byStatus", "byOwner", "byDueDate", "byPriority", "byRegion"];
  for (const s of sorters) {
    const field = s.slice(2, 3).toLowerCase() + s.slice(3);
    out.push(
      `export function ${s}<T extends Record<string, unknown>>(a: T, b: T): number {`,
      `  const x = a["${field}"] as string | number | undefined;`,
      `  const y = b["${field}"] as string | number | undefined;`,
      `  if (x === y) return 0;`,
      `  if (x === undefined) return 1;`,
      `  if (y === undefined) return -1;`,
      `  return x < y ? -1 : 1;`,
      `}`,
      ``,
    );
  }
  while (out.length < 300) out.push(`// (reserved for future pagination helpers)`);
  return out.join("\n") + "\n";
}

/** @returns {Record<string, string>} repo-relative path → contents */
function files() {
  const f = {};
  f["package.json"] = JSON.stringify({ name: "acme-mono", private: true, workspaces: ["packages/*", "apps/*"] }, null, 2) + "\n";
  f["tsconfig.json"] = JSON.stringify({
    compilerOptions: { strict: true, jsx: "react-jsx", module: "esnext", target: "es2022", moduleResolution: "bundler",
      paths: { "@acme/core": ["packages/core/src"], "@acme/billing": ["packages/billing/src"], "@acme/checkout": ["packages/checkout/src"], "@acme/legacy": ["packages/legacy/src"] } },
  }, null, 2) + "\n";
  f["README.md"] = "# acme-mono\n\nWeb and admin apps on a shared core. Packages: core, billing, checkout, legacy.\n";
  for (const pkg of ["core", "billing", "checkout", "legacy"]) {
    f[`packages/${pkg}/package.json`] = JSON.stringify({ name: `@acme/${pkg}`, private: true, main: "src/index.ts" }, null, 2) + "\n";
  }
  for (const app of ["web", "admin"]) {
    f[`apps/${app}/package.json`] = JSON.stringify({ name: `@acme/${app}`, private: true }, null, 2) + "\n";
  }

  // core
  f["packages/core/src/index.ts"] = [
    `export * from "./pricing/rates";`,
    `export * from "./pricing/quote";`,
    `export * from "./money/format";`,
    `export * from "./ui";`,
    `export { accountingHelpers } from "./helpers/accountingHelpers";`,
    `export * from "./stores";`,
    `export * from "./models/Invoice";`,
    `export * from "./models/Order";`,
    `export { theme } from "./theme";`,
    `export * from "./pagination/paginate";`,
    ``,
  ].join("\n");
  f["packages/core/src/pricing/rates.ts"] = [
    `export type Tier = "standard" | "express" | "overnight";`,
    ``,
    `const RATES: Record<Tier, number> = { standard: 1, express: 1.8, overnight: 2.6 };`,
    ``,
    `/** Multiplier applied to every shipping price for a delivery tier. */`,
    `export function rateFor(tier: Tier): number {`,
    `  return RATES[tier];`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/pricing/quote.ts"] = [
    `import { rateFor, type Tier } from "./rates";`,
    ``,
    `const BASE_PER_KG = 4.5;`,
    ``,
    `export function quoteShipping(weightKg: number, tier: Tier): number {`,
    `  return Math.round(weightKg * BASE_PER_KG * rateFor(tier) * 100) / 100;`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/money/format.ts"] = [
    `/** Render an amount in minor units as a currency string. */`,
    `export function formatAmount(cents: number, currency = "USD"): string {`,
    `  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/ui/DataTable.tsx"] = [
    `import React from "react";`,
    ``,
    `export interface Column<T> { key: keyof T & string; title?: string; render?: (value: unknown) => string }`,
    ``,
    `export function DataTable<T extends { id: string }>({ rows, columns }: { rows: T[]; columns: Column<T>[] }) {`,
    `  return (`,
    `    <table>`,
    `      <thead><tr>{columns.map((c) => <th key={c.key}>{c.title ?? c.key}</th>)}</tr></thead>`,
    `      <tbody>{rows.map((r) => <tr key={r.id}>{columns.map((c) => <td key={c.key}>{String(r[c.key])}</td>)}</tr>)}</tbody>`,
    `    </table>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/ui/ReportTable.tsx"] = [
    `import React from "react";`,
    `import { DataTable } from "./DataTable";`,
    ``,
    `/** A DataTable with a caption, for printed reports. */`,
    `export function ReportTable({ caption, rows }: { caption: string; rows: Array<{ id: string }> }) {`,
    `  return (`,
    `    <figure>`,
    `      <figcaption>{caption}</figcaption>`,
    `      <DataTable rows={rows} columns={[{ key: "id", title: "ID" }]} />`,
    `    </figure>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/ui/Badge.tsx"] = `import React from "react";\n\nexport function Badge({ label }: { label: string }) {\n  return <span className="badge">{label}</span>;\n}\n`;
  f["packages/core/src/ui/index.ts"] = `export { DataTable } from "./DataTable";\nexport { ReportTable } from "./ReportTable";\nexport { Badge } from "./Badge";\n`;
  f["packages/core/src/helpers/accountingHelpers.ts"] = [
    `/** Formatting rules shared by every ledger screen. */`,
    `export const accountingHelpers = {`,
    `  formatLedgerCell(value: number): string {`,
    `    return value < 0 ? \`(\${Math.abs(value).toFixed(2)})\` : value.toFixed(2);`,
    `  },`,
    `  isPostable(amount: number): boolean {`,
    `    return Number.isFinite(amount) && amount !== 0;`,
    `  },`,
    `};`,
    ``,
  ].join("\n");
  f["packages/core/src/stores/SessionStore.ts"] = [
    `export class SessionStore {`,
    `  token = "";`,
    `  expiresAt = 0;`,
    ``,
    `  async refreshToken(): Promise<string> {`,
    `    this.token = \`t-\${Date.now()}\`;`,
    `    this.expiresAt = Date.now() + 3_600_000;`,
    `    return this.token;`,
    `  }`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/stores/RootStore.ts"] = `import { SessionStore } from "./SessionStore";\n\nexport class RootStore {\n  session = new SessionStore();\n}\n`;
  f["packages/core/src/stores/context.tsx"] = [
    `import React from "react";`,
    `import { RootStore } from "./RootStore";`,
    ``,
    `const StoresContext = React.createContext<RootStore>(new RootStore());`,
    ``,
    `export const StoresProvider = StoresContext.Provider;`,
    `export const useStores = () => React.useContext(StoresContext);`,
    ``,
  ].join("\n");
  f["packages/core/src/stores/sessionBootstrap.ts"] = [
    `import type { RootStore } from "./RootStore";`,
    ``,
    `/** Called once at startup: make sure the session token is fresh before the first request. */`,
    `export async function bootstrapSession(root: RootStore): Promise<void> {`,
    `  if (root.session.expiresAt < Date.now()) await root.session.refreshToken();`,
    `}`,
    ``,
  ].join("\n");
  f["packages/core/src/stores/index.ts"] = `export { SessionStore } from "./SessionStore";\nexport { RootStore } from "./RootStore";\nexport { StoresProvider, useStores } from "./context";\nexport { bootstrapSession } from "./sessionBootstrap";\n`;
  f["packages/core/src/models/Invoice.ts"] = `export type InvoiceStatus = "draft" | "sent" | "paid" | "void";\n\nexport interface Invoice {\n  id: string;\n  status: InvoiceStatus;\n  totalCents: number;\n}\n`;
  f["packages/core/src/models/Order.ts"] = `export interface Order {\n  id: string;\n  status: "open" | "shipped";\n}\n`;
  f["packages/core/src/theme.ts"] = `export const theme = {\n  primaryColor: "#3987e5",\n  radius: 6,\n  fontFamily: "Inter, system-ui, sans-serif",\n};\n`;
  f["packages/core/src/pagination/paginate.ts"] = paginateTs();

  // billing
  f["packages/billing/src/index.ts"] = `export * from "./invoiceService";\nexport * from "./invoiceVoid";\nexport * from "./shippingFees";\nexport * from "./reports";\n`;
  f["packages/billing/src/invoiceService.ts"] = [
    `import type { Invoice } from "@acme/core";`,
    ``,
    `export function sendInvoice(invoice: Invoice): Invoice {`,
    `  invoice.status = "sent";`,
    `  return invoice;`,
    `}`,
    ``,
    `export function markPaid(invoice: Invoice): Invoice {`,
    `  if (invoice.status === "void") throw new Error("cannot pay a void invoice");`,
    `  invoice.status = "paid";`,
    `  return invoice;`,
    `}`,
    ``,
  ].join("\n");
  f["packages/billing/src/invoiceVoid.ts"] = `import type { Invoice } from "@acme/core";\n\n/** Voiding never mutates: callers keep the original for the audit trail. */\nexport function voidInvoice(invoice: Invoice): Invoice {\n  return { ...invoice, status: "void" };\n}\n`;
  f["packages/billing/src/shippingFees.ts"] = `import { rateFor, type Tier } from "@acme/core";\n\nexport function shippingFee(parcels: number, tier: Tier): number {\n  return parcels * 3.25 * rateFor(tier);\n}\n`;
  f["packages/billing/src/reports.ts"] = [
    `import { accountingHelpers, type Invoice } from "@acme/core";`,
    ``,
    `export function ledgerLines(invoices: Invoice[]): string[] {`,
    `  return invoices.map((inv) => \`\${inv.id}\\t\${inv.status}\\t\${accountingHelpers.formatLedgerCell(inv.totalCents / 100)}\`);`,
    `}`,
    ``,
  ].join("\n");

  // checkout
  f["packages/checkout/src/index.ts"] = `export * from "./cart";\nexport * from "./summary";\nexport { ApiClient } from "./apiClient";\n`;
  f["packages/checkout/src/cart.ts"] = [
    `import { rateFor, type Tier } from "@acme/core";`,
    ``,
    `export interface Line { sku: string; qty: number; priceCents: number }`,
    ``,
    `export function cartTotal(lines: Line[], tier: Tier): number {`,
    `  const goods = lines.reduce((sum, l) => sum + l.qty * l.priceCents, 0);`,
    `  return Math.round(goods + 500 * rateFor(tier));`,
    `}`,
    ``,
  ].join("\n");
  f["packages/checkout/src/summary.ts"] = `import { quoteShipping, type Tier } from "@acme/core";\n\nexport function orderSummary(weightKg: number, tier: Tier): string {\n  return \`Shipping: \${quoteShipping(weightKg, tier).toFixed(2)}\`;\n}\n`;
  f["packages/checkout/src/apiClient.ts"] = [
    `/** HTTP client for the payments provider. Unrelated to the app session. */`,
    `export class ApiClient {`,
    `  private token = "";`,
    ``,
    `  async refreshToken(): Promise<void> {`,
    `    this.token = "provider-token";`,
    `  }`,
    `}`,
    ``,
  ].join("\n");

  // legacy — every file here is a DECOY sharing a name with a real target
  f["packages/legacy/src/index.ts"] = `export { LegacyPricing } from "./LegacyPricing";\nexport { legacyTotal } from "./legacyFormat";\nexport { formatLedgerCell } from "./legacyLedger";\n`;
  f["packages/legacy/src/LegacyPricing.ts"] = `/** Pre-2024 rate codes. Not the core tier pricing. */\nexport class LegacyPricing {\n  rateFor(code: string): number {\n    return code === "A" ? 1.1 : 1.4;\n  }\n}\n`;
  f["packages/legacy/src/legacyFormat.ts"] = `// A local helper that happens to share a name with core's formatAmount. Not exported.\nfunction formatAmount(units: number): string {\n  return units.toFixed(2);\n}\n\nexport function legacyTotal(units: number[]): string {\n  return formatAmount(units.reduce((a, b) => a + b, 0));\n}\n`;
  f["packages/legacy/src/legacyLedger.ts"] = `/** The old CSV exporter's cell format. Not accountingHelpers. */\nexport function formatLedgerCell(value: number): string {\n  return String(Math.round(value));\n}\n`;

  // apps
  for (const p of WEB) f[pagePath("web", p.name)] = page("web", p);
  for (const p of ADMIN) f[pagePath("admin", p.name)] = page("admin", p);
  f["apps/admin/src/featureFlags.ts"] = `/** Feature flags. The keys are flag names, not functions. */\nexport const flags = {\n  formatAmount: true,\n  newLedger: false,\n};\n`;
  f["apps/web/src/styles/banner.module.css"] = `.banner {\n  background: #3987e5;\n  color: white;\n  padding: 12px 16px;\n}\n`;
  f["apps/admin/src/legacy.css"] = `/* Admin chrome kept from the old design. */\n.topbar {\n  border-bottom: 2px solid #3987E5;\n}\n`;
  f["apps/web/index.html"] = `<!doctype html>\n<html>\n  <head>\n    <meta name="theme-color" content="#3987e5" />\n    <title>Acme</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`;
  f["apps/web/src/main.tsx"] = `import React from "react";\nimport { StoresProvider, RootStore, bootstrapSession } from "@acme/core";\nimport { Dashboard } from "./pages/Dashboard";\n\nconst root = new RootStore();\nvoid bootstrapSession(root);\n\nexport const App = () => (\n  <StoresProvider value={root}>\n    <Dashboard />\n  </StoresProvider>\n);\n`;
  return f;
}

/** Answer keys, from CONSTRUCTION. `verify-keys.mjs` re-derives each one from text alone. */
export function keys() {
  const pages = [...WEB.map((p) => ({ ...p, app: "web" })), ...ADMIN.map((p) => ({ ...p, app: "admin" }))];
  const where = (pred) => pages.filter(pred).map((p) => pagePath(p.app, p.name));
  return {
    // T1: everything that calls core rateFor, directly or through quoteShipping.
    rateForCallers: [
      "packages/core/src/pricing/quote.ts",
      "packages/billing/src/shippingFees.ts",
      "packages/checkout/src/cart.ts",
      "packages/checkout/src/summary.ts",
      ...where((p) => p.rate || p.quote),
    ].sort(),
    // T2: every file that renders DataTable, including under an alias.
    dataTableRenderers: ["packages/core/src/ui/ReportTable.tsx", ...where((p) => p.dt)].sort(),
    // T3: every file that uses accountingHelpers.formatLedgerCell — called, destructured or passed as a value.
    ledgerCellUsers: ["packages/billing/src/reports.ts", ...where((p) => p.ledger)].sort(),
    // T4: every file that calls SessionStore.refreshToken.
    sessionRefreshCallers: ["packages/core/src/stores/sessionBootstrap.ts", ...where((p) => p.refresh)].sort(),
    // T6: every file containing the brand colour, any case.
    brandColorFiles: ["packages/core/src/theme.ts", "apps/web/src/styles/banner.module.css", "apps/admin/src/legacy.css", "apps/web/index.html"].sort(),
    // T8: app pages whose numbers depend on the RATES table (directly or through the packages).
    ratesDependentPages: where((p) => p.rate || p.quote || p.cart || p.fee).sort(),
    // T9: every file that changes an Invoice's status — assignment or an updated copy.
    invoiceStatusWriters: ["packages/billing/src/invoiceService.ts", "packages/billing/src/invoiceVoid.ts", ...where((p) => p.invWrite)].sort(),
    // T7: files that call core formatAmount (must all be renamed) and the decoys (must not be).
    formatAmountCallers: where((p) => p.fmt).sort(),
  };
}

/**
 * Write the fixture into `dir` (must be empty or absent).
 * @param {string} dir
 */
export function buildFixture(dir) {
  for (const [rel, body] of Object.entries(files())) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}
