import { caseStanding } from "./bank";
import { partiesOf } from "./parties";
import { casePayment, type CasePayment } from "./payments";
import { schedule, summarize, type PlanSummary, type Schedule } from "./plans";
import { caseTitle } from "./shared";
import { listCases } from "./store";

/**
 * Your debts with their payment plans (the Cases plugin): every running case that is a debt — to whom, who collects it, what is
 * open (after the payments the bank shows), the instalment and its plan — and the plans together (fixed costs a month, when you
 * are debt-free, what has no plan, the months ahead). Server only.
 */

export type DebtPlan = {
  id: number;
  label: string;
  title: string;
  creditor: string;
  creditorId: number | null;
  collector: string;
  manual: boolean;
  total: number | null;
  open: number;
  installment: number | null;
  nextDue: string | null;
  nextWhat: string;
  payment: CasePayment | null;
  plan: Schedule;
};

export function debtPlans(today = new Date().toISOString().slice(0, 10)): { debts: DebtPlan[]; summary: PlanSummary } {
  const debts: DebtPlan[] = listCases()
    .filter((c) => c.status === "open" && !c.compiled?.done)
    .flatMap((c) => {
      const s = c.compiled;
      const open = caseStanding(c.id).open ?? s?.open ?? null;
      // A case without money open is no debt (a matter only).
      if (!s || open == null || open <= 0) return [];
      const parties = partiesOf(c.id);
      return [
        {
          id: c.id,
          label: c.label,
          title: caseTitle(c),
          creditor: parties.creditor?.name || s.creditor || s.party || caseTitle(c),
          creditorId: parties.creditor?.personId ?? null,
          collector: parties.collector?.name ?? "",
          manual: !!s.manual,
          total: s.total,
          open,
          installment: s.installment,
          nextDue: s.nextDue,
          nextWhat: s.nextWhat,
          payment: casePayment(c.id),
          plan: schedule({ open, installment: s.installment, nextDue: s.nextDue, day: s.installmentDay ?? null }, today),
        },
      ];
    });
  return { debts, summary: summarize(debts.map((d) => ({ id: d.id, ...d.plan })), today) };
}

/** What you owe one contact: the open debts where they are the creditor, in all. */
export function owedTo(personId: number): { amount: number; count: number } {
  const mine = debtPlans().debts.filter((d) => d.creditorId === personId);
  return { amount: Math.round(mine.reduce((s, d) => s + d.open, 0) * 100) / 100, count: mine.length };
}
