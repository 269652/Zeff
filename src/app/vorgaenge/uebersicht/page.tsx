import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { DebtView } from "./DebtView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Debt overview") };
}

/**
 * The overview of the debts — every running case as a creditor: case number, who for, total, open, instalment, next due,
 * last payment, contact — and the next six months against your income. Made to print (or save as a PDF) for a debt
 * counselling appointment.
 */
export default async function DebtOverviewPage() {
  await connection();
  if (!isInstalled("cases")) return <PluginNotInstalled id="cases" />;
  const { debtOverview } = await import("@/plugins/cases/bank");
  // Your income as the knowledge read it off your statements, read again.
  await (await import("@/plugins/cases/income")).refreshIncome();
  const parties = await import("@/plugins/cases/parties");
  parties.assignAllParties();
  const contacts = isInstalled("people") ? (await import("@/plugins/people/store")).listPeople().map((p) => ({ id: p.id, name: p.name, kind: p.kind })) : [];
  const plans = (await import("@/plugins/cases/debts")).debtPlans();
  return <DebtView plans={{ summary: plans.summary, byCase: Object.fromEntries(plans.debts.map((d) => [d.id, { kind: d.plan.kind, end: d.plan.end, estimatedStart: d.plan.estimatedStart, left: d.plan.payments.length }])) }} overview={debtOverview()} today={new Date().toISOString().slice(0, 10)} contacts={contacts} suggestions={parties.debtSuggestions()} />;
}
