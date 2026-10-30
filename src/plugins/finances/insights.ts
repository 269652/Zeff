import { addMonths, detectRecurring, recipientKey, STRICT, type Booking, type Recurring } from "./recurring";
import { addDays } from "@/lib/dates";

/**
 * Money insights (the Finances plugin): what the bank's bookings say beyond the debts — the subscriptions and contracts that go
 * out regularly but aren't in a contracts database of yours (Verträge), and where your account stands in the next 90 days
 * (what comes in regularly, the fixed costs, the debts' instalments, the payments ahead — each counted once). Pure: bookings,
 * rows and plans come in, figures go out (the reading is insights-data.ts). Client-safe.
 */

/** A booking as the bank keeps it — its reference too (where a customer number stands). */
export type InBooking = Booking & { reference?: string };
export type Flowing = Recurring & { bookings: InBooking[] };

/** A row of a contracts database (one that publishes "Fixkosten"): its title, what it costs a month, its customer number. */
export type ContractRow = {
  id: number;
  dbId: number;
  title: string;
  /** Its cost a month (the published column) — null: none written. */
  monthly: number | null;
  /** Where a source's row came from ("recurring:<key>": the contracts source brought it). */
  srcref: string;
  customer: string;
  /** In the view the fixed costs are summed over (not cancelled). */
  running: boolean;
};

export type MatchBy = "source" | "number" | "name" | "amount";
export type Match = { by: MatchBy; rowId: number; dbId: number; title: string };

/**
 * The recipients money only moves between: what goes to them comes back too (a fifth of it at least) — a pocket or savings
 * account of your own ("An EUR Ersparnisse" and "Von EUR Ersparnisse", the bank lists both legs), money lent back and forth.
 * Neither a contract nor an income.
 */
export function movedOnly(bookings: InBooking[]): Set<string> {
  const sums = new Map<string, { out: number; in: number }>();
  for (const b of bookings) {
    const key = recipientKey(b);
    const s = sums.get(key) ?? { out: 0, in: 0 };
    if (b.amount < 0) s.out -= b.amount;
    else s.in += b.amount;
    sums.set(key, s);
  }
  return new Set([...sums].filter(([, s]) => s.out > 0 && s.in > 0 && Math.min(s.in, s.out) >= Math.max(s.in, s.out) * 0.2).map(([k]) => k));
}

/** The recurring ones of both directions, running now, by the strict reading (recurring.ts STRICT) — not money only moved. `today`: YYYY-MM-DD. */
export function recurringFlows(bookings: InBooking[], today: string): { out: Flowing[]; in: Flowing[] } {
  const moved = movedOnly(bookings);
  return {
    out: detectRecurring(bookings, today, STRICT).filter((r) => r.active && !moved.has(r.key)),
    in: detectRecurring(bookings, today, { ...STRICT, incoming: true }).filter((r) => r.active && !moved.has(r.key)),
  };
}

/** Words that say nothing about who it is (a legal form, the bank's own words) — a name shared in them is no match. */
const GENERIC = new Set(["gmbh", "mbh", "ohg", "gbr", "inc", "ltd", "llc", "limited", "online", "service", "services", "deutschland", "germany", "europe", "bank", "zahlung", "überweisung", "ueberweisung", "dauerauftrag", "transfer", "rechnung", "beitrag", "vertrag", "monat", "monthly", "abo", "und", "the", "for", "für"]);
/** The words of a name that tell who it is (four letters at least, not generic). */
const words = (s: string) => recipientKey({ text: s, counterparty: "" }).split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The row and the payment share a name: a word that tells who it is, in both (the row's title, the recipient's name). */
export function sameName(title: string, r: Pick<Recurring, "key" | "name">): boolean {
  const mine = new Set(words(title));
  if (!mine.size) return false;
  return [...words(r.key), ...words(r.name)].some((w) => mine.has(w));
}

/**
 * Which recurring payment a contracts row covers, by the recipient's key: the row the contracts source brought for it, a row
 * whose customer number its bookings carry, a row sharing its name — else a row nobody named about its amount a month (±10 %,
 * the closest; one row one payment: rent paid to a landlord is "Miete" in your list). What no row covers is missing there.
 */
export function matchContracts(items: (Recurring & { bookings?: InBooking[] })[], rows: ContractRow[]): Map<string, Match> {
  const out = new Map<string, Match>();
  const of = (by: MatchBy, r: ContractRow): Match => ({ by, rowId: r.id, dbId: r.dbId, title: r.title });
  for (const it of items) {
    const src = rows.find((r) => r.srcref === `recurring:${it.key}`);
    if (src) {
      out.set(it.key, of("source", src));
      continue;
    }
    const said = squash((it.bookings ?? []).map((b) => `${b.text} ${b.reference ?? ""} ${b.counterparty}`).join(" "));
    const num = rows.find((r) => squash(r.customer).length >= 4 && said.includes(squash(r.customer)));
    if (num) {
      out.set(it.key, of("number", num));
      continue;
    }
    const named = rows.find((r) => sameName(r.title, it));
    if (named) out.set(it.key, of("name", named));
  }
  // By the amount: only rows no payment named, only payments no row named — the closest first, each row once.
  const taken = new Set([...out.values()].map((m) => m.rowId));
  const pairs = items
    .filter((it) => !out.has(it.key))
    .flatMap((it) => rows.filter((r) => !taken.has(r.id) && r.monthly != null && r.monthly > 0 && Math.abs(r.monthly - it.monthly) <= it.monthly * 0.1).map((r) => ({ it, r, off: Math.abs(r.monthly! - it.monthly) })))
    .sort((a, b) => a.off - b.off);
  for (const { it, r } of pairs) {
    if (out.has(it.key) || taken.has(r.id)) continue;
    out.set(it.key, of("amount", r));
    taken.add(r.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cashflow ahead
// ---------------------------------------------------------------------------

export type FlowKind = "income" | "subscription" | "contract" | "debt" | "claim";
/** One movement ahead: + comes in, − goes out. */
export type Flow = { date: string; amount: number; label: string; kind: FlowKind };
/** A debt's (or a claim's) payment ahead, as the plans have it (debts.ts) — with whom, for matching what the bank shows. */
export type PlannedPayment = { date: string; amount: number; label: string; dir: "owe" | "owed" };

const plusDays = addDays;
const cents = (v: number) => Math.round(v * 100) / 100;
const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 } as const;

/** The dates of a recurring payment from its next one until `until` (one overdue but still running: due today). */
export function datesAhead(r: Pick<Recurring, "last" | "next" | "rhythm">, today: string, until: string): string[] {
  const out: string[] = [];
  // From its last payment on (the 31st stays the month's last day — not drifting to the 28th after a February).
  for (let k = 1; k < 200; k++) {
    const d = addMonths(r.last, k * MONTHS[r.rhythm]);
    if (d > until) break;
    out.push(d < today ? today : d);
  }
  return out;
}

/**
 * What moves your account in the days ahead, each thing once: the money coming in regularly (else your income a month as Finances
 * knows it, on the 1st), the subscriptions going out (except those a debt's plan pays — the plan counts, it ends), the contracts
 * rows no booking showed yet (their cost a month, on the 1st — the day isn't known), the debts' payments ahead and what comes back.
 */
export function cashflowFlows(
  input: { incomes: Recurring[]; outgoings: Recurring[]; contracts: ContractRow[]; payments: PlannedPayment[]; income?: { amount: number; label: string } | null },
  today: string,
  days = 90,
): Flow[] {
  const until = plusDays(today, days);
  const flows: Flow[] = [];
  for (const r of input.incomes) for (const date of datesAhead(r, today, until)) flows.push({ date, amount: r.amount, label: r.name, kind: "income" });
  // The 1st of each month ahead (this month's has been).
  const firsts: string[] = [];
  for (let k = 1; ; k++) {
    const d = addMonths(`${today.slice(0, 7)}-01`, k);
    if (d > until) break;
    firsts.push(d);
  }
  const income = input.income;
  if (!input.incomes.length && income && income.amount > 0) for (const date of firsts) flows.push({ date, amount: income.amount, label: income.label, kind: "income" });
  // A subscription a debt's plan pays (the same creditor, or its instalment): the plan's payments count, not the bank's rhythm.
  const owe = input.payments.filter((p) => p.dir === "owe");
  const planRows: ContractRow[] = owe.map((p, i) => ({ id: -1 - i, dbId: 0, title: p.label, monthly: p.amount, srcref: "", customer: "", running: true }));
  const paidByPlan = matchContracts(input.outgoings, planRows);
  const outgoing = input.outgoings.filter((r) => !paidByPlan.has(r.key));
  for (const r of outgoing) for (const date of datesAhead(r, today, until)) flows.push({ date, amount: -r.amount, label: r.name, kind: "subscription" });
  // The contracts rows: those a booking shows are in already (with their real days); the rest a month each.
  const covered = new Set([...matchContracts(input.outgoings, input.contracts).values()].map((m) => m.rowId));
  for (const c of input.contracts) {
    if (!c.running || covered.has(c.id) || !c.monthly || c.monthly <= 0) continue;
    for (const date of firsts) flows.push({ date, amount: -c.monthly, label: c.title, kind: "contract" });
  }
  for (const p of input.payments) {
    if (p.date > until) continue;
    flows.push({ date: p.date < today ? today : p.date, amount: p.dir === "owe" ? -p.amount : p.amount, label: p.label, kind: p.dir === "owe" ? "debt" : "claim" });
  }
  return flows.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

export type Forecast = {
  /** The balance it starts from (null: not known — the weeks are the net only). */
  start: number | null;
  /** A week each from today: what comes and goes in it, the balance at its end. */
  weeks: { from: string; to: string; net: number; balance: number | null }[];
  /** The months touched: in, out, net. */
  months: { month: string; in: number; out: number; net: number }[];
  /** The first day the balance is below 0 — and below the buffer (null: it isn't, or no balance known). */
  firstNegative: { date: string; balance: number } | null;
  firstBelowBuffer: { date: string; balance: number } | null;
  /** The lowest the balance gets (its first day). */
  lowest: { date: string; balance: number } | null;
  end: number | null;
};

/** The balance day by day from `start` (a day's movements together), by the week and the month. */
export function forecast(flows: Flow[], opts: { today: string; days?: number; start: number | null; buffer?: number }): Forecast {
  const days = opts.days ?? 90;
  const until = plusDays(opts.today, days);
  const inside = flows.filter((f) => f.date >= opts.today && f.date <= until);
  const byDay = new Map<string, number>();
  for (const f of inside) byDay.set(f.date, (byDay.get(f.date) ?? 0) + f.amount);
  const buffer = opts.buffer ?? 0;
  let balance = opts.start;
  let firstNegative: Forecast["firstNegative"] = null;
  let firstBelowBuffer: Forecast["firstBelowBuffer"] = null;
  let lowest: Forecast["lowest"] = balance == null ? null : { date: opts.today, balance: cents(balance) };
  const weeks: Forecast["weeks"] = [];
  for (let w = 0; w * 7 <= days; w++) {
    const from = plusDays(opts.today, w * 7);
    const to = w * 7 + 6 >= days ? until : plusDays(from, 6);
    let net = 0;
    for (let d = from; d <= to; d = plusDays(d, 1)) {
      const v = byDay.get(d) ?? 0;
      net += v;
      if (balance == null) continue;
      balance += v;
      const b = cents(balance);
      if (b < 0 && !firstNegative) firstNegative = { date: d, balance: b };
      if (b < buffer && !firstBelowBuffer) firstBelowBuffer = { date: d, balance: b };
      if (lowest && b < lowest.balance) lowest = { date: d, balance: b };
    }
    weeks.push({ from, to, net: cents(net), balance: balance == null ? null : cents(balance) });
  }
  const months = new Map<string, { in: number; out: number }>();
  for (const f of inside) {
    const m = months.get(f.date.slice(0, 7)) ?? { in: 0, out: 0 };
    if (f.amount >= 0) m.in += f.amount;
    else m.out -= f.amount;
    months.set(f.date.slice(0, 7), m);
  }
  return {
    start: opts.start,
    weeks,
    months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({ month, in: cents(m.in), out: cents(m.out), net: cents(m.in - m.out) })),
    firstNegative,
    firstBelowBuffer: buffer > 0 ? firstBelowBuffer : firstNegative,
    lowest,
    end: balance == null ? null : cents(balance),
  };
}
