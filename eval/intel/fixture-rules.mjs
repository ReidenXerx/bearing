/**
 * The RULES fixture: a small billing web app with one planted situation per rule module.
 *
 *   tsjs      src/api/http.ts's getJson returns `unknown` — the task asks for a typed loader, and the
 *             easy answer is `as User`, which verifies nothing (TS-1, TS-2)
 *   frontend  src/ui/DataGrid.tsx is a generic table already used by src/pages/OrdersPage.tsx — the task
 *             asks for another table page, and the easy answer is a second <table> (UI-1)
 *   react     src/forms/SignupForm.tsx is a react-hook-form form and src/ui/PhoneInput.tsx a controlled
 *             component — the easy wiring picks value/onChange out of `field` and drops its `ref`,
 *             which focus-on-error needs (REACT-1)
 *
 * Both conditions get the same repo AND bearing's default install; `on` adds the three rule modules.
 * Every key comes from CONSTRUCTION — what each file was built to contain — never from a run (NS-27).
 * No node_modules: the TypeScript task is graded by running the agent's code with type stripping, the
 * two TSX tasks by reading it. Deterministic: same input, same bytes.
 */

export function rulesFiles() {
  const files = [];
  const add = (rel, content) => files.push([rel, content]);

  add("package.json", `${JSON.stringify({
    name: "billing-web",
    version: "0.3.0",
    private: true,
    type: "module",
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "react-hook-form": "^7.53.0" },
  }, null, 2)}\n`);
  add("tsconfig.json", `${JSON.stringify({
    compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, noEmit: true, allowImportingTsExtensions: true },
    include: ["src"],
  }, null, 2)}\n`);
  add("README.md", "# billing-web\n\nThe customer billing console: orders, invoices and account signup.\n\n- `src/api/` — HTTP helpers\n- `src/ui/` — shared components\n- `src/pages/` — one file per screen\n- `src/forms/` — react-hook-form forms\n");

  // tsjs — the boundary helper returns unknown, honestly.
  add("src/api/http.ts", `/** GET a JSON endpoint of our API. The body is whatever the server sent. */
export async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(\`GET \${path} failed: \${res.status}\`);
  return res.json();
}
`);
  add("src/user/types.ts", `export interface User {
  id: number;
  name: string;
  email: string;
}
`);

  // frontend — a shared, generic table and one page that already uses it.
  add("src/ui/DataGrid.tsx", `import type { ReactNode } from "react";

export interface Column<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
}

/** The app's table: sticky header, zebra rows, right-aligned numbers. Every list screen uses it. */
export function DataGrid<Row>({ rows, columns, rowKey }: { rows: Row[]; columns: Column<Row>[]; rowKey: (row: Row) => string }) {
  return (
    <table className="grid">
      <thead>
        <tr>{columns.map((c) => <th key={c.header} className={c.align === "right" ? "num" : undefined}>{c.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>{columns.map((c) => <td key={c.header} className={c.align === "right" ? "num" : undefined}>{c.cell(r)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
`);
  add("src/data/orders.ts", `export interface Order {
  id: string;
  customer: string;
  placedAt: string;
}

export function useOrders(): Order[] {
  return [{ id: "o-1", customer: "Acme", placedAt: "2026-03-14" }];
}
`);
  add("src/pages/OrdersPage.tsx", `import { DataGrid } from "../ui/DataGrid.tsx";
import { useOrders } from "../data/orders.ts";

export function OrdersPage() {
  const orders = useOrders();
  return (
    <section>
      <h1>Orders</h1>
      <DataGrid
        rows={orders}
        rowKey={(o) => o.id}
        columns={[
          { header: "Order", cell: (o) => o.id },
          { header: "Customer", cell: (o) => o.customer },
          { header: "Placed", cell: (o) => o.placedAt },
        ]}
      />
    </section>
  );
}
`);
  add("src/data/invoices.ts", `export interface Invoice {
  number: string;
  customer: string;
  totalCents: number;
}

export function useInvoices(): Invoice[] {
  return [{ number: "INV-001", customer: "Acme", totalCents: 1250 }];
}
`);

  // react — a controlled input (forwardRef: it CAN take the ref) and a register-based form.
  add("src/ui/PhoneInput.tsx", `import { forwardRef } from "react";

export interface PhoneInputProps {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
}

/** A controlled phone field: formats as you type, reports the raw digits. */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { name, value, onChange, onBlur, error },
  ref,
) {
  return (
    <label className="field">
      <input ref={ref} name={name} type="tel" value={value} onBlur={onBlur} onChange={(e) => onChange(e.target.value.replace(/\\D/g, ""))} />
      {error ? <span className="error">{error}</span> : null}
    </label>
  );
});
`);
  add("src/forms/types.ts", `export interface SignupValues {
  name: string;
  email: string;
}
`);
  add("src/forms/SignupForm.tsx", `import { useForm } from "react-hook-form";
import type { SignupValues } from "./types.ts";

export function SignupForm({ onSubmit }: { onSubmit: (values: SignupValues) => void }) {
  const { register, handleSubmit, formState } = useForm<SignupValues>({ shouldFocusError: true });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("name", { required: "Name is required" })} placeholder="Name" />
      {formState.errors.name ? <span className="error">{formState.errors.name.message}</span> : null}
      <input {...register("email", { required: "Email is required" })} placeholder="Email" />
      {formState.errors.email ? <span className="error">{formState.errors.email.message}</span> : null}
      <button type="submit">Create account</button>
    </form>
  );
}
`);
  return files;
}

/**
 * The HARD rules fixture — a separate repo, so round 1 keeps the one it was measured on. Round 1
 * planted every trap where it was obvious (a helper returning `unknown`, the shared table imported by
 * the page next door, one field) and Sonnet got all three right with and without the rules. These are
 * the cases the rules are written for:
 *
 *   tsjs      the invoices service uses a LEGACY client typed `Promise<any>` — `any` asks for no check
 *   frontend  the shared table is `ListView` in src/components/layout/, used only by src/screens/ —
 *             nothing near src/pages/, and nothing in its name says "table" (UI-1: search by shape)
 *   react     THREE controlled phone fields in one form — the rule's case for one field component
 *             owning the Controller, not the same render wiring copied at every call site (REACT-1)
 */
export function rulesHardFiles() {
  const files = [];
  const add = (rel, content) => files.push([rel, content]);
  add("package.json", `${JSON.stringify({
    name: "payments-console",
    version: "1.8.0",
    private: true,
    type: "module",
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "react-hook-form": "^7.53.0" },
  }, null, 2)}\n`);
  add("tsconfig.json", `${JSON.stringify({
    compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, noEmit: true, allowImportingTsExtensions: true },
    include: ["src"],
  }, null, 2)}\n`);
  add("README.md", "# payments-console\n\nInternal console for payouts, invoices and customer contacts.\n");

  // tsjs — the legacy client, typed the way legacy clients are.
  add("src/api/legacy.ts", `/** The pre-2025 REST client. Still used by the invoices and payouts services. */
export async function request(path: string): Promise<any> {
  const res = await fetch(\`/legacy\${path}\`);
  if (!res.ok) throw new Error(\`legacy \${path} failed: \${res.status}\`);
  return res.json();
}
`);
  add("src/invoices/types.ts", `export interface Invoice {
  number: string;
  customer: string;
  totalCents: number;
}
`);

  // frontend — the shared table, far away and named for what it is to its author.
  add("src/components/layout/ListView.tsx", `import type { ReactNode } from "react";

export interface Field<Item> {
  label: string;
  value: (item: Item) => ReactNode;
  numeric?: boolean;
}

/** Sortable, sticky-header list used across the console. */
export function ListView<Item>({ items, fields, keyOf }: { items: Item[]; fields: Field<Item>[]; keyOf: (item: Item) => string }) {
  return (
    <table className="list-view">
      <thead><tr>{fields.map((f) => <th key={f.label} className={f.numeric ? "num" : undefined}>{f.label}</th>)}</tr></thead>
      <tbody>{items.map((it) => <tr key={keyOf(it)}>{fields.map((f) => <td key={f.label} className={f.numeric ? "num" : undefined}>{f.value(it)}</td>)}</tr>)}</tbody>
    </table>
  );
}
`);
  add("src/screens/Customers.tsx", `import { ListView } from "../components/layout/ListView.tsx";
import { useCustomers } from "../data/customers.ts";

export function Customers() {
  return <ListView items={useCustomers()} keyOf={(c) => c.id} fields={[{ label: "Name", value: (c) => c.name }, { label: "Country", value: (c) => c.country }]} />;
}
`);
  add("src/data/customers.ts", `export interface Customer { id: string; name: string; country: string }
export function useCustomers(): Customer[] { return [{ id: "c1", name: "Acme", country: "DE" }]; }
`);
  add("src/data/payouts.ts", `export interface Payout { id: string; date: string; amountCents: number; status: "pending" | "paid" | "failed" }
export function usePayouts(): Payout[] { return [{ id: "p1", date: "2026-03-14", amountCents: 125000, status: "paid" }]; }
`);
  add("src/pages/HomePage.tsx", `export function HomePage() {
  return <section><h1>Payments console</h1><p>Pick a screen from the menu.</p></section>;
}
`);

  // react — a controlled input and a form that will need three of it.
  add("src/ui/PhoneInput.tsx", `import { forwardRef } from "react";

export interface PhoneInputProps { name?: string; value: string; onChange: (value: string) => void; onBlur?: () => void; error?: string }

/** A controlled phone field: formats as you type, reports the raw digits. */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput({ name, value, onChange, onBlur, error }, ref) {
  return (
    <label className="field">
      <input ref={ref} name={name} type="tel" value={value} onBlur={onBlur} onChange={(e) => onChange(e.target.value.replace(/\\D/g, ""))} />
      {error ? <span className="error">{error}</span> : null}
    </label>
  );
});
`);
  add("src/forms/contact.ts", `export interface ContactValues {
  name: string;
  email: string;
}
`);
  add("src/forms/ContactForm.tsx", `import { useForm } from "react-hook-form";
import type { ContactValues } from "./contact.ts";

export function ContactForm({ onSubmit }: { onSubmit: (values: ContactValues) => void }) {
  const { register, handleSubmit } = useForm<ContactValues>({ shouldFocusError: true });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("name", { required: "Name is required" })} placeholder="Name" />
      <input {...register("email", { required: "Email is required" })} placeholder="Email" />
      <button type="submit">Save contact</button>
    </form>
  );
}
`);
  return files;
}
