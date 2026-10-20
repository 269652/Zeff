import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { getPref } from "@/lib/prefs";
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
  const income = getPref<number | null>("cases.income", null);
  return <DebtView overview={debtOverview({ income })} today={new Date().toISOString().slice(0, 10)} />;
}
