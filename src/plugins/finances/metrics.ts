import type { MetricProvider } from "@/plugins/workspace/metric-point";
import { debtPlans, debtsDbId } from "./debts";
import { fixedCosts } from "./fixed";
import { monthlyIncome } from "./income";
import { bookingsBetween, creditPayments, lastThreeMonths, markedAccounts, type AccountKind } from "./accounts";
import { movedOnly } from "./insights";
import { recipientKey } from "./recurring";
import { localDay } from "@/lib/dates";

/**
 * The Finances plugin's Kennzahlen (metric-point.ts): what its overview shows, by name — kennzahl("Tilgungsrate") in a
 * formula, @Schuldenstand in a page. Read now, from the debts, the income, the fixed costs and the bank statements.
 */

const today = () => localDay();
const href = () => {
  const db = debtsDbId();
  return db ? `/workspace/${db}` : undefined;
};
/** Where you mark your own accounts (what spending leaves out). */
const accountsHref = () => "/settings/finances#accounts";

/**
 * What was spent a month — the bank statements' outgoing amounts over the last three whole months, on average. Money only
 * moved is no spending: to a pocket or savings account and back (movedOnly: the bank lists both legs), to an account you
 * marked as yours — your own or a credit account you pay into (Settings → Finances, accounts.ts). Null: none read.
 */
export function monthlySpending(day = today(), marked: Record<string, AccountKind> = markedAccounts()): number | null {
  const { from, to } = lastThreeMonths(day);
  const rows = bookingsBetween(from, to);
  if (!rows?.length) return null;
  const moved = movedOnly(rows);
  const out = rows.filter((b) => b.amount < 0 && !moved.has(recipientKey(b)) && !marked[recipientKey(b)]).reduce((s, b) => s - b.amount, 0);
  return Math.round((out / 3) * 100) / 100;
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
  { label: "Ausgaben", unit: "€/Monat", what: "What was spent a month — the last three whole months of your bank statements, on average; money only moved (pockets, savings, the accounts you marked as yours) left out", read: () => monthlySpending(), href: accountsHref },
  { label: "Auf Kreditkonten", unit: "€/Monat", what: "What went to the accounts you marked as credit accounts a month — the last three whole months on average", read: () => creditPayments(today(), markedAccounts()), href: accountsHref },
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
