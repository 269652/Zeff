import { createHash } from "node:crypto";
import { getSqlite } from "@/db";
import { caseRefs } from "@/lib/boards/similar";
import { addManualTodo, addTodoUserNote, listTodos, setTodoDue, setTodoOps, setTodoStatus } from "@/lib/boards/store";
import { settleEvidence } from "@/lib/boards/todo-settle";
import * as ledger from "@/lib/money/ledger";
import { t } from "@/lib/i18n/server";
import { detailsOf } from "@/plugins/people/details";
import { getPerson } from "@/plugins/people/store";
import { isInstalled } from "@/plugins/state";
import { partiesOf } from "./parties";
import { caseTitle, type Case } from "./shared";
import { caseByKey, getCase, listCases } from "./store";

/**
 * The bank (the Cases plugin): your account's bookings — read from a statement (the Revolut plugin) or fetched from a
 * bank connection (bank-sync) — matched to what you owe. A payment out that fits a todo's
 * transfer (the amount, and the recipient, the account or the case number) settles the todo with a note and counts for
 * its case; a case's open amount follows. An instalment ten days late, with nothing paid, makes a todo before the plan
 * lapses. And one overview of every debt, with the months ahead against your income. Server only.
 */

export type Booking = { date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; reference: string };
export type Transaction = Booking & { id: string; account: string; caseId: number | null; todoId: number | null };

// ---------------------------------------------------------------------------
// Kept
// ---------------------------------------------------------------------------

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists bank_transactions (id text primary key, account text not null, date text not null, amount real not null, currency text not null default 'EUR', text text not null default '', counterparty text not null default '', iban text not null default '', reference text not null default '', imported_at text not null, case_id integer, todo_id integer, matched_at text);
    create index if not exists bank_transactions_date on bank_transactions (date);
    create table if not exists case_payments (case_id integer not null references cases(id) on delete cascade, tx_id text not null unique, amount real not null, date text not null);
    create table if not exists case_warnings (case_id integer not null, due text not null, todo_id integer, at text not null, primary key (case_id, due));
  `);
  return d;
}

type TRow = { id: string; account: string; date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; reference: string; case_id: number | null; todo_id: number | null };
const toTx = (r: TRow): Transaction => ({ id: r.id, account: r.account, date: r.date, amount: r.amount, currency: r.currency, text: r.text, counterparty: r.counterparty, iban: r.iban, reference: r.reference, caseId: r.case_id, todoId: r.todo_id });

/** Bookings kept — the same booking (account, day, amount, text, and which of its like it is) once, however often it is read. */
export function addBookings(bookings: Booking[], account: string): { added: number; total: number } {
  const seen = new Map<string, number>();
  const insert = db().prepare("insert or ignore into bank_transactions (id, account, date, amount, currency, text, counterparty, iban, reference, imported_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let added = 0;
  for (const b of bookings) {
    const sig = [account, b.date, b.amount.toFixed(2), b.text].join("|");
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    const id = createHash("sha1").update(`${sig}|${n}`).digest("hex").slice(0, 20);
    added += insert.run(id, account, b.date, b.amount, b.currency, b.text.slice(0, 300), b.counterparty.slice(0, 120), b.iban, b.reference.slice(0, 300), new Date().toISOString()).changes;
  }
  return { added, total: bookings.length };
}

export const listTransactions = (limit = 500): Transaction[] => (db().prepare("select * from bank_transactions order by date desc, id limit ?").all(limit) as TRow[]).map(toTx);

let migrated = false;
/** The payments the cases kept before the ledger (case_payments): moved into it once — a booking's, a todo's ("todo:<id>"), by hand. */
function migrateCasePayments(): void {
  if (migrated) return;
  migrated = true;
  const rows = db().prepare("select case_id caseId, tx_id txId, amount, date from case_payments").all() as { caseId: number; txId: string; amount: number; date: string }[];
  for (const r of rows) {
    const todo = r.txId.startsWith("todo:");
    const hand = r.txId.startsWith("hand:");
    const key = todo || hand ? r.txId : `tx:${r.txId}`;
    if (ledger.paymentByKey(key)) continue;
    const p = ledger.recordPayment({ key, date: r.date, amount: r.amount, label: todo ? `T-${r.txId.slice(5)}` : hand ? t("by hand") : `${t("Booking")} ${deDay(r.date)}`, source: todo ? "todo" : hand ? "hand" : "bank", tx: todo || hand ? null : r.txId });
    ledger.allocate(p.id, `case:${r.caseId}`, r.amount);
  }
  if (rows.length) db().prepare("delete from case_payments").run();
}

/** A case's payments (the ledger's allocations to it), oldest first — `txId`: the payment's key ("tx:…", "todo:…", "hand:…"). */
export const paymentsOf = (caseId: number): { amount: number; date: string; txId: string; label: string; source: string; tx: string | null }[] => {
  db();
  migrateCasePayments();
  return ledger.allocationsOf(`case:${caseId}`).map((a) => ({ amount: a.amount, date: a.date, txId: a.key, label: a.label, source: a.source, tx: a.tx }));
};

/** What is paid on a case since its summary was made, and what is open now. */
export function caseStanding(caseId: number): { paidSince: number; open: number | null; last: { date: string; amount: number } | null } {
  const c = getCase(caseId);
  const all = paymentsOf(caseId);
  const since = c?.compiled?.at?.slice(0, 10) ?? "";
  const paidSince = all.filter((p) => p.date >= since).reduce((s, p) => s + p.amount, 0);
  const open = c?.compiled?.open != null ? Math.max(0, Math.round((c.compiled.open - paidSince) * 100) / 100) : null;
  const last = all.at(-1);
  return { paidSince, open, last: last ? { date: last.date, amount: last.amount } : null };
}

/** What is open on a case now — what its letters say, less what was paid since (a booking, a payment todo ticked off). Null: not said. */
export const openOf = (c: Pick<Case, "id" | "compiled">): number | null => (c.compiled?.open == null ? null : caseStanding(c.id).open);

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** The words of a name worth comparing (four letters and more). */
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
/** Whether a booking's other side is this recipient: a word of the name in what the booking says. */
const namesIt = (tx: Transaction, name: string) => {
  const said = new Set(words(`${tx.counterparty} ${tx.text}`));
  return words(name).some((w) => said.has(w));
};
const sameAmount = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
const euro = (v: number) => `${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;
const deDay = (day: string) => day.split("-").reverse().join(".");

/**
 * The payments out not matched yet, matched: to an open todo's transfer (the amount, and the recipient, the account or the case
 * number) — the todo is done, with a note — and to its case; else to a case by its account or name and its instalment or open
 * amount. How many were matched.
 */
export function matchPayments(): { matched: number } {
  const d = db();
  const open = (d.prepare("select * from bank_transactions where amount < 0 and case_id is null and todo_id is null and matched_at is null order by date").all() as TRow[]).map(toTx);
  if (!open.length) return { matched: 0 };
  const todos = isInstalled("todos") ? listTodosWithTransfer() : [];
  const cases = listCases().filter((c) => c.status === "open");
  let matched = 0;
  for (const tx of open) {
    const refs = caseRefs(`${tx.reference} ${tx.text}`);
    const todo = todos.find(
      (x) => !x.done && sameAmount(tx.amount, Number(x.op.amount)) && (namesIt(tx, x.op.name) || (tx.iban && tx.iban === x.op.iban.replace(/\s+/g, "")) || caseRefs(x.op.purpose).some((r) => refs.includes(r))),
    );
    let caseId: number | null = null;
    if (todo) caseId = caseRefs(todo.op.purpose).map((r) => caseByKey(r.replace(/^\d{1,2} /, ""))?.id).find((id): id is number => !!id) ?? null;
    if (!caseId) {
      const c = cases.find((c) => {
        const s = c.compiled;
        if (!s) return false;
        const who = (s.iban && tx.iban === s.iban.replace(/\s+/g, "")) || refs.some((r) => r.replace(/^\d{1,2} /, "") === c.key) || (s.payee && namesIt(tx, s.payee));
        return who && [s.installment, s.open].some((v) => v != null && sameAmount(tx.amount, v));
      });
      caseId = c?.id ?? null;
    }
    // The same payment twice: one ticked off or said by hand days before (the ledger's twin — confirmed by this booking), or the same
    // booking read twice (a statement and the bank connection, within two days): counted once.
    if (caseId) {
      const ticked = ledger.twinOf({ amount: tx.amount, date: tx.date, refs: [`case:${caseId}`] });
      const read = paymentsOf(caseId).some((p) => p.source === "bank" && sameAmount(p.amount, tx.amount) && Math.abs(Date.parse(p.date) - Date.parse(tx.date)) <= 2 * 864e5);
      if (ticked || read) {
        if (ticked) ledger.confirmByBank(ticked.id, tx.id, `${t("Booking")} ${deDay(tx.date)}`);
        d.prepare("update bank_transactions set case_id = ?, matched_at = ? where id = ?").run(caseId, new Date().toISOString(), tx.id);
        continue;
      }
    }
    if (!todo && !caseId) {
      // No todo and no case took it (a transfer you made without a todo): what it pays anyway — a promise to whoever it paid, a debt
      // of yours to them (lib/boards/todo-settle.ts). Kept as matched when it settled something; the last 60 days only.
      if (tx.date >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) {
        const settled = settleEvidence({ key: `tx:${tx.id}`, label: `${t("Booking")} ${deDay(tx.date)}`, text: `${tx.text} ${tx.reference}`.trim(), refs: [], ops: [], todoId: null, amount: Math.abs(tx.amount), payee: { name: tx.counterparty, iban: tx.iban }, date: tx.date });
        if (settled.length) {
          d.prepare("update bank_transactions set matched_at = ? where id = ?").run(new Date().toISOString(), tx.id);
          matched++;
        }
      }
      continue;
    }
    d.prepare("update bank_transactions set case_id = ?, todo_id = ?, matched_at = ? where id = ?").run(caseId, todo?.id ?? null, new Date().toISOString(), tx.id);
    if (caseId) {
      const p = ledger.recordPayment({ key: `tx:${tx.id}`, date: tx.date, amount: tx.amount, label: `${t("Booking")} ${deDay(tx.date)}`, source: "bank", tx: tx.id });
      ledger.allocate(p.id, `case:${caseId}`, Math.abs(tx.amount));
    }
    if (todo) {
      settleTodo(todo.id, `✓ Bezahlt laut Kontoauszug (${tx.account}, ${deDay(tx.date)}): ${euro(tx.amount)} an ${tx.counterparty || todo.op.name}.`);
      todo.done = true;
    }
    matched++;
  }
  return { matched };
}

type TransferOp = { name: string; iban: string; amount: string; purpose: string };

/** The open todos with a transfer on them. */
function listTodosWithTransfer(): { id: number; op: TransferOp; done: boolean }[] {
  return listTodos({ status: "open" }).flatMap((t) => t.ops.filter((o) => o.type === "bank-transfer").map((o) => ({ id: t.id, op: o as unknown as TransferOp, done: false })));
}

function settleTodo(id: number, note: string): void {
  addTodoUserNote(id, note);
  setTodoStatus(id, "done", note);
}

// ---------------------------------------------------------------------------
// Warning before a plan lapses
// ---------------------------------------------------------------------------

const LATE_DAYS = 10;

/** The instalments ten days late, with nothing paid since they were due: a todo each (once), with the transfer on it. How many. */
export function overdueWarnings(today: string): number {
  if (!isInstalled("todos")) return 0;
  const d = db();
  let made = 0;
  for (const c of listCases().filter((x) => x.status === "open" && !x.compiled?.done)) {
    const s = c.compiled;
    if (!s?.nextDue || s.installment == null) continue;
    const late = Math.round((Date.parse(today) - Date.parse(s.nextDue)) / 864e5);
    if (late < LATE_DAYS) continue;
    if (paymentsOf(c.id).some((p) => p.date >= s.nextDue!)) continue;
    if (d.prepare("select 1 from case_warnings where case_id = ? and due = ?").get(c.id, s.nextDue)) continue;
    // In German, like the todos Zeff makes from your mails.
    const text = `Rate ${euro(s.installment)} (Az. ${c.label}) seit ${late} Tagen überfällig — überweisen, bevor der Ratenplan verfällt (${caseTitle(c)})`;
    const todo = addManualTodo({ ticket: "", text });
    setTodoDue(todo.id, today);
    if (s.iban && !todo.ops.some((o) => o.type === "bank-transfer")) setTodoOps(todo.id, [...todo.ops, { type: "bank-transfer", name: s.payee || s.party, iban: s.iban, bic: s.bic, amount: s.installment.toFixed(2), purpose: s.purpose || c.label }], undefined, true);
    d.prepare("insert into case_warnings (case_id, due, todo_id, at) values (?, ?, ?, ?)").run(c.id, s.nextDue, todo.id, new Date().toISOString());
    made++;
  }
  return made;
}

// ---------------------------------------------------------------------------
// The overview of the debts
// ---------------------------------------------------------------------------

export type DebtRow = { caseId: number; creditor: string; /** Who collects it (a bailiff, a collection agency) — "" none. */ collector: string; /** The creditor's contact. */ creditorId: number | null; /** A debt you wrote down yourself (no case number). */ manual: boolean; caseNumber: string; person: string; total: number | null; open: number | null; installment: number | null; nextDue: string | null; nextWhat: string; last: { date: string; amount: number } | null; contact: string; iban: string };
export type DebtOverview = { rows: DebtRow[]; totals: { total: number; open: number; installments: number }; months: { month: string; installments: number; left: number | null }[]; income: number | null };

/** Every running case as a debt — and the next six months: the instalments due in each, what is left of your income. */
export function debtOverview(opts: { income?: number | null; today?: string } = {}): DebtOverview {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const people = isInstalled("people");
  const rows: DebtRow[] = listCases()
    .filter((c) => c.status === "open" && !c.compiled?.done)
    .map((c) => {
      const s = c.compiled;
      const parties = partiesOf(c.id);
      // Whom to reach: who collects it, else the creditor, else the case's person.
      const contactId = parties.collector?.personId ?? parties.creditor?.personId ?? c.personId;
      const p = contactId && people ? getPerson(contactId) : null;
      const details = p ? detailsOf(p.id) : [];
      const contact = [p?.name, ...(p?.emails ?? []), ...details.filter((x) => x.key === "phone" || x.key === "address").map((x) => x.value)].filter(Boolean).join(" · ");
      const standing = caseStanding(c.id);
      return { caseId: c.id, creditor: parties.creditor?.name || s?.creditor || s?.party || caseTitle(c), collector: parties.collector?.name ?? "", creditorId: parties.creditor?.personId ?? null, manual: !!s?.manual, caseNumber: s?.manual ? "" : c.label, person: p?.name ?? "", total: s?.total ?? null, open: standing.open, installment: s?.installment ?? null, nextDue: s?.nextDue ?? null, nextWhat: s?.nextWhat ?? "", last: standing.last, contact, iban: s?.iban ?? "" };
    })
    .sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const totals = { total: rows.reduce((s, r) => s + (r.total ?? 0), 0), open: rows.reduce((s, r) => s + (r.open ?? 0), 0), installments: rows.reduce((s, r) => s + (r.installment ?? 0), 0) };
  const income = opts.income ?? null;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);
    // The instalments still running that month: what is open isn't paid off before it.
    const installments = rows.filter((r) => r.installment != null && (r.open == null || r.open > r.installment * i)).reduce((s, r) => s + r.installment!, 0);
    return { month, installments, left: income != null ? Math.round((income - installments) * 100) / 100 : null };
  });
  return { rows, totals, months, income };
}
