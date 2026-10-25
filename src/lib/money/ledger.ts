import { getSqlite } from "@/db";

/**
 * The ledger: every payment once — a booking on the statement, a payment todo ticked off, "paid" said by hand — and what it is
 * for: its allocations to things by ref ("case:3", "debt:3442"). What is open on a thing is computed from it, never patched: the
 * figure it started from (the letter's, the one you set) less what was allocated to it since — so taking a payment back, or moving
 * it to another thing, is releasing an allocation, and the figures follow (each kind's recompute). The same payment twice (a todo
 * ticked off, the bank's booking of it days later) is one payment, confirmed by the booking (twinOf / confirmByBank). Server only.
 */

export type PaymentSource = "bank" | "todo" | "hand";
export type Payment = { id: number; key: string; date: string; amount: number; label: string; source: PaymentSource; tx: string | null };
export type Allocation = Payment & { paymentId: number; ref: string; amount: number; allocatedAt: string };

/** The days a booking may come after a payment ticked off or said by hand and still be it (a transfer takes days to book). */
export const TWIN_DAYS = 10;

let ready = false;
function db() {
  const d = getSqlite();
  if (ready) return d;
  d.exec(`
    create table if not exists ledger_payments (id integer primary key autoincrement, key text not null unique, date text not null, amount real not null, label text not null default '', source text not null, tx text, created_at text not null);
    create table if not exists ledger_allocations (id integer primary key autoincrement, payment_id integer not null references ledger_payments(id) on delete cascade, ref text not null, amount real not null, created_at text not null, unique (payment_id, ref));
    create index if not exists ledger_allocations_ref on ledger_allocations (ref);
    create index if not exists ledger_payments_tx on ledger_payments (tx);
  `);
  ready = true;
  return d;
}

type PRow = { id: number; key: string; date: string; amount: number; label: string; source: PaymentSource; tx: string | null };
const toPayment = (r: PRow): Payment => ({ id: r.id, key: r.key, date: r.date, amount: r.amount, label: r.label, source: r.source, tx: r.tx });
const cents = (v: number) => Math.round(v * 100) / 100;

/** A thing's figures brought up to its allocations — by its kind ("case", "debt"), the plugins say how. */
type Recompute = (ref: string) => void;
const recomputers = new Map<string, Recompute[]>();
/** What follows when a thing's allocations change — its own figures, and what shows them (a case's row among the debts). */
export const onLedgerChange = (kind: string, r: Recompute): void => {
  const list = recomputers.get(kind) ?? [];
  if (!list.includes(r)) recomputers.set(kind, [...list, r]);
};
function recompute(ref: string): void {
  for (const r of recomputers.get(ref.split(":")[0]) ?? []) {
    try {
      r(ref);
    } catch (e) {
      console.warn(`[ledger] ${ref}:`, e instanceof Error ? e.message : e);
    }
  }
}

/** A payment kept — once per key (the proof it comes from: "tx:<booking>", "todo:<id>", "hand:<n>"). */
export function recordPayment(p: { key: string; date: string; amount: number; label: string; source: PaymentSource; tx?: string | null }): Payment {
  const d = db();
  const had = d.prepare("select * from ledger_payments where key = ?").get(p.key) as PRow | undefined;
  if (had) return toPayment(had);
  d.prepare("insert into ledger_payments (key, date, amount, label, source, tx, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(p.key, p.date.slice(0, 10), cents(Math.abs(p.amount)), p.label, p.source, p.tx ?? null, new Date().toISOString());
  return toPayment(d.prepare("select * from ledger_payments where key = ?").get(p.key) as PRow);
}

export const paymentByKey = (key: string): Payment | null => {
  const r = db().prepare("select * from ledger_payments where key = ?").get(key) as PRow | undefined;
  return r ? toPayment(r) : null;
};

/** Part of a payment (or all of it) for a thing — its figures follow. */
export function allocate(paymentId: number, ref: string, amount: number): void {
  db().prepare("insert into ledger_allocations (payment_id, ref, amount, created_at) values (?, ?, ?, ?) on conflict (payment_id, ref) do update set amount = excluded.amount").run(paymentId, ref, cents(amount), new Date().toISOString());
  recompute(ref);
}

/** An allocation released (the proof taken back, a payment moved elsewhere) — a payment left for nothing goes; the figures follow. */
export function deallocate(paymentId: number, ref: string): void {
  const d = db();
  d.prepare("delete from ledger_allocations where payment_id = ? and ref = ?").run(paymentId, ref);
  if (!d.prepare("select 1 from ledger_allocations where payment_id = ?").get(paymentId)) d.prepare("delete from ledger_payments where id = ?").run(paymentId);
  recompute(ref);
}

/** What was allocated to a thing, oldest first (`allocatedSince`: only from then on — a figure set later starts afresh). */
export function allocationsOf(ref: string, opts: { allocatedSince?: string; paidSince?: string } = {}): Allocation[] {
  return (
    db()
      .prepare(
        `select p.*, a.payment_id paymentId, a.ref ref, a.amount allocated, a.created_at allocatedAt from ledger_allocations a join ledger_payments p on p.id = a.payment_id
         where a.ref = ? and (? is null or a.created_at >= ?) and (? is null or p.date >= ?) order by p.date, a.id`,
      )
      .all(ref, opts.allocatedSince ?? null, opts.allocatedSince ?? null, opts.paidSince ?? null, opts.paidSince ?? null) as (PRow & { paymentId: number; ref: string; allocated: number; allocatedAt: string })[]
  ).map((r) => ({ ...toPayment(r), paymentId: r.paymentId, ref: r.ref, amount: r.allocated, allocatedAt: r.allocatedAt }));
}

/** The money allocated to a thing (since a day, or since the allocations of a moment). */
export const paidOn = (ref: string, opts: { allocatedSince?: string; paidSince?: string } = {}): number => cents(allocationsOf(ref, opts).reduce((s, a) => s + a.amount, 0));

/**
 * The payment a booking is, when it is one already: of the same amount, for one of these things, ticked off or said by hand (not yet
 * confirmed by a booking) within TWIN_DAYS of it. Null: a payment of its own.
 */
export function twinOf(b: { amount: number; date: string; refs: string[] }): Payment | null {
  if (!b.refs.length) return null;
  const day = Date.parse(`${b.date.slice(0, 10)}T12:00:00`);
  const rows = db()
    .prepare(`select distinct p.* from ledger_payments p join ledger_allocations a on a.payment_id = p.id where p.tx is null and p.source != 'bank' and a.ref in (${b.refs.map(() => "?").join(",")})`)
    .all(...b.refs) as PRow[];
  const hit = rows.find((r) => Math.abs(r.amount - Math.abs(b.amount)) < 0.005 && Math.abs(Date.parse(`${r.date}T12:00:00`) - day) <= TWIN_DAYS * 864e5);
  return hit ? toPayment(hit) : null;
}

/** A payment confirmed by the booking that is it (its id kept with it: the booking counts no second time). */
export function confirmByBank(paymentId: number, tx: string, label: string): void {
  const d = db();
  const p = d.prepare("select label from ledger_payments where id = ?").get(paymentId) as { label: string } | undefined;
  if (!p) return;
  d.prepare("update ledger_payments set tx = ?, label = ? where id = ?").run(tx, p.label.includes(label) ? p.label : `${p.label} · ${label}`, paymentId);
}

/** Whether a booking is in the ledger already (as its own payment, or confirming one). */
export const knowsBooking = (tx: string): boolean => !!db().prepare("select 1 from ledger_payments where tx = ? or key = ?").get(tx, `tx:${tx}`);

/** The things a payment is for. */
export const allocationsOfPayment = (paymentId: number): { ref: string; amount: number }[] =>
  (db().prepare("select ref, amount from ledger_allocations where payment_id = ? order by id").all(paymentId) as { ref: string; amount: number }[]).map((r) => ({ ...r }));
