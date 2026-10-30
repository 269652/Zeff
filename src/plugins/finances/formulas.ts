import { needPeople } from "@/plugins/people/formulas";
import type { FormulaValue } from "@/plugins/workspace/formula";
import type { FormulaFunction } from "@/plugins/workspace/formula-point";
import { debtPlans, type DebtPlan } from "./debts";
import type { Direction } from "./own";
import { localDay } from "@/lib/dates";

/**
 * The Finances plugin's formula functions (formula-point.ts): =Schulden(@Chris), =SUMME(Schulden(@Freunde)),
 * =Forderungen(@Familie), =Rate(@Sparkasse) — what you owe someone, what they owe you, what you pay them a month. A person
 * gives one number; a circle or a list one per person who has any (so SUMME, MAX, ANZAHL work on it); no argument the
 * total. In € (€/Monat for Rate): they go into the units of the formula. Server only.
 */

const today = () => localDay();

function perPerson(dir: Direction, fn: string, of: (d: DebtPlan) => number) {
  return (args: FormulaValue[]): FormulaValue => {
    const debts = debtPlans(today(), dir).debts;
    const round = (n: number) => Math.round(n * 100) / 100;
    if (!args.length || args[0] === null) return round(debts.reduce((s, d) => s + of(d), 0));
    const who = needPeople(args[0], fn);
    const amount = (p: { id: number; name: string; aliases: string[] }) => {
      const names = [p.name, ...p.aliases].map((x) => x.toLowerCase());
      return round(debts.filter((d) => d.creditorId === p.id || (d.creditorId === null && names.includes(d.creditor.toLowerCase()))).reduce((s, d) => s + of(d), 0));
    };
    if (!who.group) return amount(who.people[0]);
    return who.people.map(amount).filter((x) => x !== 0);
  };
}

const open = (d: DebtPlan) => d.open;
/** What is paid a month: the instalment of a plan that runs. */
const rate = (d: DebtPlan) => (d.plan.kind === "plan" ? (d.installment ?? 0) : 0);

export const FINANCES_FORMULAS: FormulaFunction[] = [
  { name: "Schulden", aliases: ["Debts", "Deudas"], unit: "€", signature: "Schulden(@Person oder @Kreis)", what: "What you owe them, still open — a circle: one number per person; empty: all you owe", call: perPerson("owe", "Schulden", open) },
  { name: "Forderungen", aliases: ["Claims", "Owed"], unit: "€", signature: "Forderungen(@Person oder @Kreis)", what: "What they owe you, still open — a circle: one number per person; empty: all you are owed", call: perPerson("owed", "Forderungen", open) },
  { name: "Rate", aliases: ["Instalment", "Installment"], unit: "€/Monat", signature: "Rate(@Person oder @Kreis)", what: "What you pay them a month (the plans running now)", call: perPerson("owe", "Rate", rate) },
];
