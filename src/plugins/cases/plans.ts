/**
 * The debts' payment plans (the Cases plugin): for each debt its payments to come — the instalment every month from its next due
 * day (later ones on the plan's day of the month), the rest last, until nothing is open; a debt with a due day but no instalment
 * is one payment; one with neither has no plan. Together: the monthly fixed costs, when you are debt-free with the plans, what
 * has no plan, the months ahead. Pure — client-safe.
 */

export type PlanInput = { open: number | null; installment: number | null; nextDue: string | null; /** The plan's day of the month (else the next due day's). */ day?: number | null };
export type Payment = { date: string; amount: number };
export type Schedule = {
  kind: "plan" | "once" | "none";
  /** What is open. */
  open: number;
  payments: Payment[];
  /** The last payment's day — debt-free of this one then. */
  end: string | null;
  /** No due day known: the plan is taken to start next month on the 1st. */
  estimatedStart: boolean;
};

const MAX = 240; // 20 years of instalments at most
const iso = (y: number, m: number, d: number) => {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, m, Math.min(d, last)));
  return dt.toISOString().slice(0, 10);
};
const cents = (v: number) => Math.round(v * 100) / 100;

export function schedule(p: PlanInput, today: string): Schedule {
  const open = cents(p.open ?? 0);
  if (open <= 0) return { kind: p.installment ? "plan" : "none", open: 0, payments: [], end: null, estimatedStart: false };
  if (!p.installment || p.installment <= 0) return p.nextDue ? { kind: "once", open, payments: [{ date: p.nextDue, amount: open }], end: p.nextDue, estimatedStart: false } : { kind: "none", open, payments: [], end: null, estimatedStart: false };
  const estimatedStart = !p.nextDue;
  const [ty, tm] = today.split("-").map(Number);
  const first = p.nextDue ?? iso(ty, tm, 1); // next month (tm is 1-based: tm as a 0-based month is the next one)
  const [fy, fm, fd] = first.split("-").map(Number);
  const day = p.day && p.day >= 1 && p.day <= 31 ? p.day : fd;
  const payments: Payment[] = [];
  let left = open;
  for (let i = 0; left > 0.004 && i < MAX; i++) {
    const amount = cents(Math.min(p.installment, left));
    payments.push({ date: i === 0 ? first : iso(fy, fm - 1 + i, day), amount });
    left = cents(left - amount);
  }
  return { kind: "plan", open, payments, end: payments.at(-1)?.date ?? null, estimatedStart };
}

export type PlanSummary = {
  /** The instalments running in the current month (or starting next month) — your fixed costs a month for the debts. */
  monthlyRates: number;
  /** The last payment of all plans — debt-free with them then (null: no plan). */
  debtFree: string | null;
  /** What is open without a plan (no instalment, no due day) — not in the debt-free day. */
  unplanned: number;
  /** Due before today and not paid. */
  overdue: number;
  /** The next payment (the earliest due, overdue ones first). */
  next: { id: number; date: string; amount: number } | null;
  /** The months ahead (from next month until debt-free, 60 at most): what is to be paid in each. */
  months: { month: string; amount: number; by: { id: number; amount: number }[] }[];
};

export function summarize(plans: (Schedule & { id: number })[], today: string): PlanSummary {
  const thisMonth = today.slice(0, 7);
  const [ty, tm] = today.split("-").map(Number);
  const nextMonth = iso(ty, tm, 1).slice(0, 7);
  // The fixed costs: the instalments of the plans running this month or next (a plan starting later counts from then).
  const monthlyRates = cents(
    plans
      .filter((p) => p.kind === "plan" && p.payments.some((x) => x.date.slice(0, 7) <= nextMonth) && (p.end ?? "") >= `${thisMonth}-01`)
      .reduce((s, p) => s + Math.max(...p.payments.map((x) => x.amount)), 0),
  );
  const ends = plans.filter((p) => p.end && p.kind !== "none").map((p) => p.end!);
  const debtFree = ends.length ? ends.sort().at(-1)! : null;
  const unplanned = cents(plans.filter((p) => p.kind === "none").reduce((s, p) => s + p.open, 0));
  const overdue = cents(plans.flatMap((p) => p.payments.filter((x) => x.date < today)).reduce((s, x) => s + x.amount, 0));
  const all = plans.flatMap((p) => p.payments.map((x) => ({ id: p.id, ...x }))).sort((a, b) => a.date.localeCompare(b.date));
  const next = all[0] ? { id: all[0].id, date: all[0].date, amount: all[0].amount } : null;
  const last = (debtFree ?? nextMonth).slice(0, 7);
  const months: PlanSummary["months"] = [];
  for (let i = 0; i < 60; i++) {
    const month = iso(ty, tm + i, 1).slice(0, 7);
    if (month > last) break;
    const by = new Map<number, number>();
    for (const x of all) if (x.date.slice(0, 7) === month) by.set(x.id, cents((by.get(x.id) ?? 0) + x.amount));
    months.push({ month, amount: cents([...by.values()].reduce((s, v) => s + v, 0)), by: [...by].map(([id, amount]) => ({ id, amount })) });
  }
  return { monthlyRates, debtFree, unplanned, overdue, next, months };
}
