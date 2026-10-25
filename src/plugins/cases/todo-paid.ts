import { getTodo } from "@/lib/boards/store";
import type { TodoView } from "@/lib/boards/shared";
import { evidenceOfTodo, refDue, refLabeler, refPayable, rowRefs, todoAmount, todoLinkFinder, todoSettler, type Evidence } from "@/lib/boards/todo-settle";
import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";
import { caseStanding, openOf, paymentsOf } from "./bank";
import { getPage } from "@/plugins/workspace/store";
import { casesOfRef, getCase, updateCase } from "./store";

/**
 * A payment todo ticked off pays its case (the Cases plugin, through lib/boards/todo-settle.ts): the todos come from the cases (a
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
 * One case paid by a proof (a payment todo ticked off, "paid" by hand): its amount booked as a payment of its own (its key the
 * payment's id), the case brought up to it — and how the case's summary was before (null: no amount to book).
 */
function payCase(caseId: number, e: Evidence, amount = todoAmount(e)): { compiled: unknown } | null {
  const s = getCase(caseId)?.compiled;
  const before = s ? JSON.parse(JSON.stringify(s)) : null;
  const paid = amount ?? s?.installment ?? s?.open ?? null;
  if (paid == null) return null;
  paymentsOf(caseId); // (the payments' table there)
  getSqlite().prepare("insert or ignore into case_payments (case_id, tx_id, amount, date) values (?, ?, ?, ?)").run(caseId, e.key, paid, e.date);
  settleCase(caseId);
  return { compiled: before };
}

/** A payment taken back (its todo opened again): off the case, the summary as it was before — unless it was summed up anew since. */
function unpayCase(caseId: number, undo: { compiled?: unknown } | null, key: string): void {
  getSqlite().prepare("delete from case_payments where case_id = ? and tx_id = ?").run(caseId, key);
  const now = getCase(caseId)?.compiled;
  if (undo?.compiled && now?.settled?.includes(key)) updateCase(caseId, { compiled: undo.compiled as NonNullable<typeof now> });
}

/**
 * A case's summary brought up to its payments: each payment since it was made that it has not counted yet moves the instalment due
 * on a month — or, with no instalment, pays what is open: nothing due any more. What is open paid in all: the case done. Each payment
 * counts once (the summary keeps which), so this can run any time — after a payment, after the AI summed the case up anew.
 */
export function settleCase(caseId: number): void {
  const c = getCase(caseId);
  const s = c?.compiled;
  if (!c || !s) return;
  const counted = new Set(s.settled ?? []);
  const since = s.at.slice(0, 10);
  const fresh = paymentsOf(caseId).filter((p) => p.date >= since && !counted.has(p.txId));
  if (!fresh.length) return;
  const next = { ...s };
  for (const p of fresh) {
    counted.add(p.txId);
    if (!next.nextDue) continue;
    if (next.installment != null && p.amount >= next.installment - 0.005) next.nextDue = plusMonth(next.nextDue, next.installmentDay);
    else if (next.installment == null) next.nextDue = null;
  }
  const open = s.open != null ? caseStanding(caseId).open : null;
  if (open === 0) {
    next.done = true;
    next.nextDue = null;
  }
  updateCase(caseId, { compiled: { ...next, settled: [...counted] } });
}

// What hangs on a proof (lib/boards/todo-settle.ts): the cases a payment todo pays — settled by booking the payment. (A booking on the
// statement is the cases' own: bank.ts matches it; "paid" by hand names its case.)
todoLinkFinder((e) => {
  const todo = e.todoId ? getTodo(e.todoId) : undefined;
  return todo ? casesPaidBy(todo).map((id) => `case:${id}`) : [];
});
todoSettler(
  "case",
  (ref, e, amount) => {
    const r = payCase(Number(ref.slice(5)), e, amount);
    return r ? { undo: r } : false;
  },
  (ref, undo, key) => unpayCase(Number(ref.slice(5)), undo as { compiled?: unknown } | null, key),
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
  return c ? { title: `${c.compiled?.title || c.label} (${c.label})`, href: null } : null;
});
