import { getTodo } from "@/lib/todos/store";
import type { TodoView } from "@/lib/todos/shared";
import { evidenceOfTodo, refDue, refLabeler, refPayable, rowRefs, todoAmount, todoLinkFinder, todoSettler, type Evidence } from "@/lib/todos/settle";
import { getSqlite } from "@/db";
import * as ledger from "@/lib/money/ledger";
import { isInstalled } from "@/plugins/state";
import { caseStanding, openOf, paymentsOf } from "./bank";
import { getPref } from "@/lib/prefs";
import { getPage, rawRows } from "@/plugins/workspace/store";
import { casesOfRef, getCase, updateCase } from "./store";

/**
 * A payment todo ticked off pays its case (the Cases plugin, through lib/todos/settle.ts): the todos come from the cases (a
 * letter's instalment, a warning) — done, the money went out. Its amount is booked on each open case it belongs to (as the bank's bookings are, case_payments) and the case
 * follows: the instalment due moves on a month, a rest paid leaves nothing due and the case done. The transfer on the statement later
 * is this payment (bank.ts counts it once). Server only.
 */

/** A todo that asks for money to go out — as payments.ts reads them. */
const PAYS = /überweis|bezahl|zahl(?:en|ung)|\brate\b|raten|begleich|anweis/i;

/** The due a month on — on the plan's day of the month when it has one (paid late on the 23rd, the next is still the 15th). */
const plusMonth = (iso: string, planDay?: number): string => {
  const d = new Date(`${iso}T12:00:00`);
  const want = planDay && planDay >= 1 && planDay <= 31 ? planDay : d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(want, last)); // (the 31st in February: its last day)
  return d.toLocaleDateString("sv-SE");
};

/** The open cases a todo belongs to: as one of their sources, or as the warning made for one. */
function casesOfTodo(todoId: number): number[] {
  const ids = new Set(casesOfRef(`todo:${todoId}`).filter((c) => c.status === "open").map((c) => c.id));
  try {
    for (const r of getSqlite().prepare("select case_id from case_warnings where todo_id = ?").all(todoId) as { case_id: number }[]) if (getCase(r.case_id)?.status === "open") ids.add(r.case_id);
  } catch {
    // (no warnings table yet)
  }
  return [...ids];
}

/** The open cases a payment todo pays — none when it is no payment, or the statement's booking settled it (that is the payment). */
function casesPaidBy(todo: TodoView): number[] {
  if (!isInstalled("cases") || (!PAYS.test(todo.text) && !todo.ops.some((o) => o.type === "bank-transfer"))) return [];
  if (getSqlite().prepare("select 1 from sqlite_master where name = 'bank_transactions'").get() && getSqlite().prepare("select 1 from bank_transactions where todo_id = ?").get(todo.id)) return [];
  return casesOfTodo(todo.id);
}

/** A todo done: when it is a payment of cases, each of them paid (on `today`). How many cases. */
export function payFromTodo(todoId: number, today = new Date().toLocaleDateString("sv-SE")): number {
  const todo = getTodo(todoId);
  if (!todo) return 0;
  let n = 0;
  const e = { ...evidenceOfTodo(todo), date: today };
  for (const caseId of casesPaidBy(todo)) if (payCase(caseId, e)) n++;
  return n;
}

/**
 * One case paid by a proof (a payment todo ticked off, "paid" by hand): a payment in the ledger (its key the proof's), allocated to the
 * case — its figures follow (settleCase, on the ledger's change). Whether there was an amount to book.
 */
function payCase(caseId: number, e: Evidence, amount = todoAmount(e)): boolean {
  const s = getCase(caseId)?.compiled;
  const paid = amount ?? s?.installment ?? s?.open ?? null;
  if (paid == null) return false;
  const source = e.key.startsWith("todo:") ? "todo" : e.key.startsWith("tx:") ? "bank" : "hand";
  const p = ledger.recordPayment({ key: e.key, date: e.date, amount: paid, label: e.label, source, tx: source === "bank" ? e.key.slice(3) : null });
  ledger.allocate(p.id, `case:${caseId}`, paid);
  return true;
}

/** A payment taken back (its todo opened again, "paid" undone): its allocation to the case released — the figures follow. */
function unpayCase(caseId: number, key: string): void {
  const p = ledger.paymentByKey(key);
  if (p) ledger.deallocate(p.id, `case:${caseId}`);
}

/** The due a month back (a summary from before the ledger moved it on by its payments: where it started). */
const minusMonth = (iso: string, planDay?: number): string => {
  const d = new Date(`${iso}T12:00:00`);
  const want = planDay && planDay >= 1 && planDay <= 31 ? planDay : d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toLocaleDateString("sv-SE");
};

/**
 * A case's figures computed from its letters and its payments, never patched: the summary's due and done as the letters say (kept as
 * `base`), moved on by the payments since the summary — each instalment-sized one a month (on the plan's day), a payment without
 * an instalment pays what is open; what is open paid in all: the case done, nothing due. Runs on every change of its allocations and
 * after the AI summed it up anew — any time, the same result.
 */
export function settleCase(caseId: number): void {
  const c = getCase(caseId);
  const s = c?.compiled;
  if (!c || !s) return;
  // (A summary from before: its due was moved on by the payments it had counted — moved back, that is where it started.)
  const counted = s.settled ?? [];
  const base = s.base ?? {
    nextDue: counted.length && s.nextDue && s.installment != null ? counted.reduce((d) => minusMonth(d, s.installmentDay), s.nextDue) : counted.length ? null : s.nextDue,
    done: counted.length ? false : s.done,
  };
  const since = s.at.slice(0, 10);
  let due = base.nextDue;
  for (const p of paymentsOf(caseId).filter((x) => x.date >= since)) {
    if (!due) break;
    if (s.installment != null && p.amount >= s.installment - 0.005) due = plusMonth(due, s.installmentDay);
    else if (s.installment == null) due = null;
  }
  const open = s.open != null ? caseStanding(caseId).open : null;
  const { settled: _settled, ...rest } = s;
  const next = { ...rest, base, nextDue: open === 0 ? null : due, done: open === 0 || base.done };
  if (JSON.stringify(next) !== JSON.stringify(s)) updateCase(caseId, { compiled: next });
}

// The ledger: a case's allocations changed (a booking matched, a todo ticked off, one taken back) — its figures follow.
ledger.onLedgerChange("case", (ref) => settleCase(Number(ref.slice(5))));

// What hangs on a proof (lib/todos/settle.ts): the cases a payment todo pays — settled by booking the payment. (A booking on the
// statement is the cases' own: bank.ts matches it; "paid" by hand names its case.)
todoLinkFinder((e) => {
  const todo = e.todoId ? getTodo(e.todoId) : undefined;
  return todo ? casesPaidBy(todo).map((id) => `case:${id}`) : [];
});
todoSettler(
  "case",
  (ref, e, amount) => payCase(Number(ref.slice(5)), e, amount),
  (ref, _undo, key) => unpayCase(Number(ref.slice(5)), key),
);
// A case's row in the Workspace (the cases database) stands for its case; "paid" by hand pays its instalment, else what is open.
rowRefs((rowId) => {
  const src = String(getPage(rowId)?.props.srcref ?? "");
  return src.startsWith("case:") ? [src] : [];
});
refPayable("case", (ref) => {
  const c = getCase(Number(ref.slice(5)));
  if (!c || c.status !== "open") return null;
  return c.compiled?.installment ?? openOf(c);
});

// A running case's next instalment is the due day of the todos that hang on it.
refDue("case", {
  dueOf: (ref) => {
    const c = getCase(Number(ref.slice(5)));
    return c && c.status === "open" && !c.compiled?.done ? (c.compiled?.nextDue ?? null) : null;
  },
});

refLabeler("case", (ref) => {
  const c = getCase(Number(ref.slice(5)));
  if (!c) return null;
  // Its page: its row in the cases database (pref workspace.casesDb, as database.ts keeps it).
  const db = getPref<number | null>("workspace.casesDb", null);
  const row = db ? rawRows(db).find((r) => r.cells.srcref === ref) : undefined;
  return { title: `${c.compiled?.title || c.label} (${c.label})`, href: row ? `/workspace/${row.id}` : null };
});
