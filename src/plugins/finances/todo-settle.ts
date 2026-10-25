import { refDue, refLabeler, refPayable, rowRefs, settledBy, todoAmount, todoAmounts, todoLinkFinder, todoSettler, type Evidence } from "@/lib/boards/todo-settle";
import { claimsOf } from "@/plugins/people/graph";
import { peoplePaid, promisedAmount } from "@/plugins/people/todo-settle";
import { isInstalled } from "@/plugins/state";
import { getPage, rawRows, setCell } from "@/plugins/workspace/store";
import { viaSource } from "@/plugins/workspace/events";
import { debtsDbId } from "./debts";
import { DEBT } from "./fields";
import { setDebtMoney } from "./own";

/**
 * What hangs on a proof, for the Finances plugin (lib/boards/todo-settle.ts): the debts of what was found before — the one written down
 * from a promise (its claim), a case's row; and, for a booking no todo took (the fallback), a debt of your own to whoever it paid, of
 * its instalment or of what is open — unless a todo or "paid" by hand settled it with that amount in the ten days before (the same
 * payment, already counted). Settled: a debt of your own is down by what it paid (an instalment's due a month on, paid off: nothing
 * due); a case's row follows its case (settled before it). Server only.
 */

const DAYS_SAME = 10;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** A booking's own debt rows: to whoever it paid, of its instalment or what is open — not counted already by another proof. */
function debtsPaid(e: Evidence, db: number): number[] {
  const amount = todoAmount(e);
  if (amount == null) return [];
  const people = new Set(peoplePaid(e));
  if (!people.size) return [];
  const since = new Date(new Date(`${e.date}T12:00:00`).getTime() - DAYS_SAME * 864e5).toISOString();
  return rawRows(db)
    .filter((r) => !getPage(r.id)?.archivedAt && !r.cells.srcref)
    .filter((r) => (Array.isArray(r.cells[DEBT.creditor]) ? (r.cells[DEBT.creditor] as unknown[]) : []).some((c) => people.has(Number(c))))
    .filter((r) => [Number(r.cells[DEBT.rate]), Number(r.cells[DEBT.open])].some((v) => Number.isFinite(v) && near(v, amount)))
    .filter((r) => !settledBy(`debt:${r.id}`).some((s) => s.subject !== e.key && s.at >= since))
    .map((r) => r.id);
}

todoLinkFinder((e, found) => {
  const db = isInstalled("finances") ? debtsDbId() : null;
  if (!db) return [];
  const claims = new Set(found.filter((r) => r.startsWith("claim:")).map((r) => Number(r.slice(6))));
  const cases = new Set(found.filter((r) => r.startsWith("case:")));
  const linked = claims.size || cases.size ? rawRows(db).filter((r) => !getPage(r.id)?.archivedAt && (claims.has(Number(r.cells[DEBT.claim])) || cases.has(String(r.cells.srcref ?? "")))).map((r) => r.id) : [];
  const booked = e.key.startsWith("tx:") && !linked.length ? debtsPaid(e, db) : [];
  return [...linked, ...booked].map((id) => `debt:${id}`);
});

// A row of the debts database stands for its debt (and a case's row for its case too); "paid" by hand pays its instalment, else what is open.
rowRefs((rowId) => {
  const row = getPage(rowId);
  if (!row || row.dbId !== debtsDbId()) return [];
  const src = String(row.props.srcref ?? "");
  return [`debt:${rowId}`, ...(src.startsWith("case:") ? [src] : [])];
});
refPayable("debt", (ref) => {
  const row = getPage(Number(ref.slice(5)));
  if (!row || row.props.srcref) return null; // (a case's row: paid on its case)
  const rate = Number(row.props[DEBT.rate]);
  const open = Number(row.props[DEBT.open]);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, Number.isFinite(open) && open > 0 ? open : rate) : Number.isFinite(open) && open > 0 ? open : null;
});

// A debt of your own: its next due is the todo's — and the todo's, set by you, is the debt's (a case's row follows its case).
refDue("debt", {
  dueOf: (ref) => {
    const row = getPage(Number(ref.slice(5)));
    if (!row || row.props.srcref) return null;
    return typeof row.props[DEBT.due] === "string" ? String(row.props[DEBT.due]) : null;
  },
  setDue: (ref, day) => {
    const row = getPage(Number(ref.slice(5)));
    if (row && !row.props.srcref && row.dbId === debtsDbId()) setDebtMoney(row.id, { due: day });
  },
});

refLabeler("debt", (ref) => {
  const row = getPage(Number(ref.slice(5)));
  return row ? { title: row.title, href: `/workspace/${row.id}` } : null;
});

const plusMonth = (iso: string, day: number | null): string => {
  const d = new Date(`${iso}T12:00:00`);
  const want = day && day >= 1 && day <= 31 ? day : d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toLocaleDateString("sv-SE");
};

/** A case's row of the debts database: what its case says now (after the case was paid, or its payment taken back). */
function followCase(rowId: number, caseId: number): void {
  void import("@/plugins/cases/store").then(async ({ getCase }) => {
    const c = getCase(caseId);
    if (!c) return;
    const { openOf } = await import("@/plugins/cases/bank");
    viaSource(() => {
      setCell(rowId, DEBT.open, openOf(c));
      setCell(rowId, DEBT.due, c.compiled?.nextDue ?? null);
    });
  });
}

todoSettler("debt", (ref, todo, amount, found) => {
  const row = getPage(Number(ref.slice(5)));
  if (!row) return false;
  const srcref = String(row.props.srcref ?? "");
  if (srcref.startsWith("case:")) {
    // A case's row: what its case says now (the case was paid just before — cases/todo-paid.ts).
    followCase(row.id, Number(srcref.slice(5)));
    return { undo: { caseId: Number(srcref.slice(5)) } };
  }
  // What it paid on this debt: the promises to its creditor it kept (40 € and 20 € — one todo, two promises), else the todo's amount.
  const creditor = Array.isArray(row.props[DEBT.creditor]) ? Number((row.props[DEBT.creditor] as unknown[])[0]) : NaN;
  const kept = new Set(found.filter((r) => r.startsWith("claim:")).map((r) => Number(r.slice(6))));
  const promised = Number.isFinite(creditor) && kept.size ? claimsOf(creditor).filter((c) => kept.has(c.id)).map((c) => promisedAmount(c, todoAmounts(todo)) ?? 0) : [];
  const paid = promised.length ? Math.round(promised.reduce((s, a) => s + a, 0) * 100) / 100 : amount;
  if (paid == null) return false;
  const open = Number(row.props[DEBT.open]);
  if (!Number.isFinite(open)) return false;
  const left = Math.max(0, Math.round((open - paid) * 100) / 100);
  const due = typeof row.props[DEBT.due] === "string" ? String(row.props[DEBT.due]) : null;
  const rate = Number(row.props[DEBT.rate]) || null;
  // The instalment due now paid: the next one a month on. Paid ahead of a plan that starts later (years off): the plan stays as it is.
  const soon = new Date(Date.now() + 31 * 864e5).toLocaleDateString("sv-SE");
  const nextDue = !left ? null : rate && due && due <= soon && paid >= rate - 0.005 ? plusMonth(due, Number(row.props[DEBT.day]) || null) : due;
  setDebtMoney(row.id, { open: left || null, due: nextDue });
  return { undo: { open, due } };
}, (ref, undo) => {
  // The todo opened again: the debt as it was before it (a case's row: its case, taken back just before).
  const rowId = Number(ref.slice(5));
  const was = (undo ?? {}) as { open?: number | null; due?: string | null; caseId?: number };
  if (was.caseId) return followCase(rowId, was.caseId);
  if (getPage(rowId)) setDebtMoney(rowId, { open: was.open ?? null, due: was.due ?? null });
});
