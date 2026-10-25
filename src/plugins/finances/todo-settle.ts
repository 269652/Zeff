import { euroAmounts, refDue, refLabeler, refPayable, rowRefs, settledBy, todoAmount, todoAmounts, todoLinkFinder, todoSettler, type Evidence } from "@/lib/boards/todo-settle";
import { claimById, claimsOf } from "@/plugins/people/graph";
import { peoplePaid, promisedAmount } from "@/plugins/people/todo-settle";
import { isInstalled } from "@/plugins/state";
import { getPage, rawRows, setCell } from "@/plugins/workspace/store";
import { viaSource } from "@/plugins/workspace/events";
import { getSqlite } from "@/db";
import { allocate, allocationsOf, confirmByBank, deallocate, onLedgerChange, paymentByKey, recordPayment, twinOf } from "@/lib/money/ledger";
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
  // A debt written down from a promise is the promises' money only while its total is no more than what you promised them in all
  // (40 € and 20 € → a debt of 60 €; or it has none): one whose figures became a bigger debt since (30.000 € to the one who lent
  // 200 €) only names it — the promise kept, the debt untouched.
  const isThePromise = (r: { cells: Record<string, unknown> }) => {
    const total = Number(r.cells[DEBT.total]);
    if (!Number.isFinite(total) || total <= 0) return true;
    const c = claimById(Number(r.cells[DEBT.claim]));
    if (!c) return false;
    const promised = claimsOf(c.personId)
      .filter((x) => x.kind === "commitment" && x.direction === "mine" && x.status !== "rejected")
      .reduce((s, x) => s + (euroAmounts(x.text)[0] ?? 0), 0);
    return total <= promised + 0.005;
  };
  const linked =
    claims.size || cases.size
      ? rawRows(db)
          .filter((r) => !getPage(r.id)?.archivedAt && ((claims.has(Number(r.cells[DEBT.claim])) && isThePromise(r)) || cases.has(String(r.cells.srcref ?? ""))))
          .map((r) => r.id)
      : [];
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

// ---------------------------------------------------------------------------
// A debt of your own, computed from the ledger: where it starts (what you set, kept with when) less what was allocated since
// ---------------------------------------------------------------------------

type Base = { open: number | null; due: string | null; at: string; shownOpen: number | null; shownDue: string | null };

function bases() {
  const d = getSqlite();
  d.exec("create table if not exists debt_bases (row_id integer primary key, open real, due text, at text not null, shown_open real, shown_due text)");
  return d;
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const dayOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Where a debt starts: what it says now when first asked (and later, whenever it says something else than what was computed —
 * you changed the open or the due day in the table, or in the debt's form: your figure is the new start).
 */
function baseOf(rowId: number): Base {
  const d = bases();
  const row = getPage(rowId);
  const now = { open: num(row?.props[DEBT.open]), due: dayOf(row?.props[DEBT.due]) };
  const b = d.prepare("select open, due, at, shown_open shownOpen, shown_due shownDue from debt_bases where row_id = ?").get(rowId) as Base | undefined;
  if (b && b.shownOpen === now.open && b.shownDue === now.due) return b;
  const fresh: Base = { ...now, at: new Date().toISOString(), shownOpen: now.open, shownDue: now.due };
  d.prepare("insert into debt_bases (row_id, open, due, at, shown_open, shown_due) values (?, ?, ?, ?, ?, ?) on conflict (row_id) do update set open = excluded.open, due = excluded.due, at = excluded.at, shown_open = excluded.shown_open, shown_due = excluded.shown_due").run(rowId, fresh.open, fresh.due, fresh.at, fresh.open, fresh.due);
  return fresh;
}

/**
 * A debt of your own brought to the ledger: its start less the payments allocated to it since; each instalment-sized one moves the
 * due a month on while the due is near (paid ahead of a plan years off: the plan stays as it is); paid off: nothing due. The cells
 * are what is shown — written here only.
 */
export function recomputeDebt(rowId: number): void {
  const row = getPage(rowId);
  if (!row || row.props.srcref || row.dbId !== debtsDbId()) return;
  const b = baseOf(rowId);
  if (b.open == null) return;
  const rate = num(row.props[DEBT.rate]);
  const day = num(row.props[DEBT.day]);
  let open = b.open;
  let due = b.due;
  for (const a of allocationsOf(`debt:${rowId}`, { allocatedSince: b.at })) {
    open = Math.round((open - a.amount) * 100) / 100;
    const soon = new Date(new Date(`${a.date}T12:00:00`).getTime() + 31 * 864e5).toLocaleDateString("sv-SE");
    if (rate && due && due <= soon && a.amount >= rate - 0.005) due = plusMonth(due, day);
  }
  const left = Math.max(0, open);
  const shownOpen = left > 0 ? left : null;
  const shownDue = left > 0 ? due : null;
  setDebtMoney(rowId, { open: shownOpen, due: shownDue });
  bases().prepare("update debt_bases set shown_open = ?, shown_due = ? where row_id = ?").run(num(getPage(rowId)?.props[DEBT.open]), dayOf(getPage(rowId)?.props[DEBT.due]), rowId);
}

onLedgerChange("debt", (ref) => recomputeDebt(Number(ref.slice(5))));
// A case's allocations changed: its row among the debts follows it.
onLedgerChange("case", (ref) => {
  const db = debtsDbId();
  const row = db ? rawRows(db).find((r) => r.cells.srcref === ref) : undefined;
  if (row) followCase(row.id, Number(ref.slice(5)));
});

/** What a proof paid on a debt: the promises to its creditor it kept (40 € and 20 € — one todo, two promises), else its amount. */
function paidOnDebt(row: { props: Record<string, unknown> }, e: Evidence, amount: number | null, found: readonly string[]): number | null {
  const creditor = Array.isArray(row.props[DEBT.creditor]) ? Number((row.props[DEBT.creditor] as unknown[])[0]) : NaN;
  const kept = new Set(found.filter((r) => r.startsWith("claim:")).map((r) => Number(r.slice(6))));
  const promised = Number.isFinite(creditor) && kept.size ? claimsOf(creditor).filter((c) => kept.has(c.id)).map((c) => promisedAmount(c, todoAmounts(e)) ?? 0) : [];
  return promised.length ? Math.round(promised.reduce((sum, a) => sum + a, 0) * 100) / 100 : amount;
}

todoSettler(
  "debt",
  (ref, e, amount, found) => {
    const row = getPage(Number(ref.slice(5)));
    if (!row) return false;
    const srcref = String(row.props.srcref ?? "");
    // A case's row: the case was paid just before (cases/todo-paid.ts) — the row follows it on the ledger's change.
    if (srcref.startsWith("case:")) return true;
    // A booking that is a payment ticked off or said by hand days before: that payment, confirmed — not a second one.
    const twin = e.key.startsWith("tx:") ? twinOf({ amount: e.amount ?? 0, date: e.date, refs: [ref] }) : null;
    if (twin) {
      confirmByBank(twin.id, e.key.slice(3), e.label);
      return true;
    }
    const paid = paidOnDebt(row, e, amount, found);
    if (paid == null || num(row.props[DEBT.open]) == null) return false;
    baseOf(row.id); // (where it starts: before this payment)
    const source = e.key.startsWith("todo:") ? "todo" : e.key.startsWith("tx:") ? "bank" : "hand";
    const p = recordPayment({ key: e.key, date: e.date, amount: paid, label: e.label, source, tx: source === "bank" ? e.key.slice(3) : null });
    allocate(p.id, ref, paid);
    return true;
  },
  // The proof taken back: its allocation released — the debt as the ledger says without it.
  (ref, _undo, key) => {
    const p = paymentByKey(key);
    if (p) deallocate(p.id, ref);
  },
);
