import { getSqlite } from "@/db";
import { myNames } from "@/plugins/people/pulse";
import type { MetricProvider } from "@/plugins/workspace/metric-point";
import { debtPlans, debtsDbId } from "./debts";
import { fixedCosts } from "./fixed";
import { monthlyIncome } from "./income";
import { movedOnly, type InBooking } from "./insights";
import { recipientKey } from "./recurring";

/**
 * The Finances plugin's Kennzahlen (metric-point.ts): what its overview shows, by name — kennzahl("Tilgungsrate") in a
 * formula, @Schuldenstand in a page. Read now, from the debts, the income, the fixed costs and the bank statements.
 */

const today = () => new Date().toISOString().slice(0, 10);
const href = () => {
  const db = debtsDbId();
  return db ? `/workspace/${db}` : undefined;
};

/**
 * What was spent a month — the bank statements' outgoing amounts over the last three whole months, on average. Money only
 * moved is no spending: to a pocket or savings account and back (movedOnly: the bank lists both legs), to an account of your
 * own (a transfer to your own name). Null: none read.
 */
export function monthlySpending(day = today(), me: string[] = ownNames()): number | null {
  const d = new Date(`${day}T00:00:00Z`);
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
  let rows: InBooking[];
  try {
    rows = getSqlite().prepare("select date, amount, text, counterparty from bank_transactions where date >= ? and date < ?").all(from, to) as InBooking[];
  } catch {
    return null; // no statements read
  }
  if (!rows.length) return null;
  const moved = movedOnly(rows);
  const mine = new Set(me.map((n) => recipientKey({ text: n, counterparty: "" })).filter((k) => k.length >= 5));
  const out = rows.filter((b) => b.amount < 0 && !moved.has(recipientKey(b)) && !mine.has(recipientKey(b))).reduce((s, b) => s - b.amount, 0);
  return Math.round((out / 3) * 100) / 100;
}

/** Your own names (People: the one you set, your Jira name, the name your mails go out under) — a transfer to them is yours still. */
function ownNames(): string[] {
  try {
    return myNames();
  } catch {
    return [];
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
  { label: "Ausgaben", unit: "€/Monat", what: "What was spent a month — the last three whole months of your bank statements, on average; money only moved (pockets, savings, your own accounts) left out", read: () => monthlySpending(), href },
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
