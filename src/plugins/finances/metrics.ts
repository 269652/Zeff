import { getSqlite } from "@/db";
import type { MetricProvider } from "@/plugins/workspace/metric-point";
import { debtPlans, debtsDbId } from "./debts";
import { fixedCosts } from "./fixed";
import { monthlyIncome } from "./income";

/**
 * The Finances plugin's Kennzahlen (metric-point.ts): what its overview shows, by name — kennzahl("Tilgungsrate") in a
 * formula, @Schuldenstand in a page. Read now, from the debts, the income, the fixed costs and the bank statements.
 */

const today = () => new Date().toISOString().slice(0, 10);
const href = () => {
  const db = debtsDbId();
  return db ? `/workspace/${db}` : undefined;
};

/** What went out a month — the bank statements' outgoing amounts over the last three whole months, on average. Null: none read. */
export function monthlySpending(day = today()): number | null {
  const d = new Date(`${day}T00:00:00Z`);
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
  try {
    const r = getSqlite().prepare("select count(*) n, coalesce(-sum(case when amount < 0 then amount end), 0) out from bank_transactions where date >= ? and date < ?").get(from, to) as { n: number; out: number };
    return r.n ? Math.round((r.out / 3) * 100) / 100 : null;
  } catch {
    return null; // no statements read
  }
}

const open = (dir: "owe" | "owed") => debtPlans(today(), dir).debts.reduce((s, d) => s + d.open, 0);
const rates = () => debtPlans(today(), "owe").summary.monthlyRates;
const income = () => monthlyIncome().amount;

/** Months from now to a day (whole, rounded up) — null without one. */
const monthsUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const a = new Date(), b = new Date(iso);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() > a.getDate() ? 1 : 0));
};

export const FINANCES_METRICS: MetricProvider[] = [
  { label: "Schuldenstand", unit: "€", what: "What you owe in all, still open", read: () => open("owe"), href },
  { label: "Tilgungsrate", unit: "€/Monat", what: "The instalments you pay a month (the plans running now)", read: rates, href },
  { label: "Schuldenfrei in", unit: "Monate", what: "Months until the last debt with a plan is paid off", read: () => monthsUntil(debtPlans(today(), "owe").summary.debtFree), href },
  { label: "Forderungen", unit: "€", what: "What others owe you, still open", read: () => open("owed"), href },
  { label: "Nettoeinkommen", unit: "€/Monat", what: "Your net income a month (set by hand, or read off your statements)", read: income, href },
  { label: "Ausgaben", unit: "€/Monat", what: "What went out a month — the last three whole months of your bank statements, on average", read: () => monthlySpending(), href },
  {
    label: "Frei im Monat",
    unit: "€/Monat",
    what: "What is left of your income after the instalments and the fixed costs",
    read: () => {
      const i = income();
      return i === null ? null : i - rates() - (fixedCosts().amount ?? 0);
    },
    href,
  },
  {
    label: "Sparquote",
    unit: "%",
    what: "Of your income, the part that didn't go out: (Nettoeinkommen − Ausgaben) / Nettoeinkommen",
    read: () => {
      const i = income();
      const s = monthlySpending();
      return i && s !== null ? ((i - s) / i) * 100 : null;
    },
    href,
  },
  {
    label: "Schuldendienstquote",
    unit: "%",
    what: "Of your income, the part the instalments take: Tilgungsrate / Nettoeinkommen",
    read: () => {
      const i = income();
      return i ? (rates() / i) * 100 : null;
    },
    href,
  },
];
