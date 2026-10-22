"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { DebtOverview } from "@/plugins/cases/bank";
import { setIncomeAction } from "@/plugins/cases/block-actions";
import type { DebtSuggestion } from "@/plugins/cases/parties";
import type { PlanSummary, Schedule } from "@/plugins/cases/plans";
import { AddDebt } from "@/plugins/cases/ui/AddDebt";
import { DebtChart } from "@/plugins/cases/ui/DebtChart";
import { DeleteDebt } from "@/plugins/cases/ui/DeleteDebt";
import { EditMoney } from "@/plugins/cases/ui/EditMoney";
import { InlineAmount } from "@/plugins/cases/ui/InlineAmount";
import type { ContactOption } from "@/plugins/cases/ui/ContactField";

const euro = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }));
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("de-DE") : "—");
const monthYear = (iso: string, long = false) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString("de-DE", { month: long ? "long" : "short", year: "numeric" });

export type DebtPlansProp = { summary: PlanSummary; byCase: Record<number, Pick<Schedule, "kind" | "end" | "estimatedStart"> & { left: number }> };

/**
 * The debt overview (to print for a debt counselling appointment): what is open, the instalments running now (your fixed costs
 * for the debts), when you are debt-free with the plans, what is left of your income — then every debt with its plan (its
 * amounts a click to change), the totals, and the months ahead until debt-free as a chart.
 */
export function DebtView({ overview: o, today, contacts, suggestions, plans }: { overview: DebtOverview; today: string; contacts: ContactOption[]; suggestions: DebtSuggestion[]; plans: DebtPlansProp }) {
  const t = useT();
  const router = useRouter();
  const info = o.incomeInfo;
  const s = plans.summary;
  const refresh = () => router.refresh();
  const allRates = o.rows.reduce((a, r) => a + (r.installment ?? 0), 0);
  const later = Math.round((allRates - s.monthlyRates) * 100) / 100;
  const months = s.debtFree ? (Number(s.debtFree.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(s.debtFree.slice(5, 7)) - Number(today.slice(5, 7)) : null;
  const tiles: { label: string; value: string; sub: string; tone?: "good" | "bad" }[] = [
    { label: t("Open in all"), value: euro(o.totals.open, 0), sub: t("of {amount} in all", { amount: euro(o.totals.total, 0) }) },
    { label: t("Instalments a month"), value: euro(s.monthlyRates, 0), sub: later > 0 ? t("running now — {amount} more starting later", { amount: euro(later, 0) }) : t("running now") },
    { label: t("Debt-free"), value: s.debtFree ? monthYear(s.debtFree, true) : "—", sub: s.debtFree ? `${months ? t("in {n} months", { n: months }) : ""}${s.unplanned > 0 ? ` · ${t("{amount} without a plan not in it", { amount: euro(s.unplanned, 0) })}` : ""}` : t("no plan yet") },
    o.income != null
      ? { label: t("Left after the instalments"), value: euro(o.income - s.monthlyRates, 0), sub: t("of {amount} income a month", { amount: euro(o.income, 0) }), tone: o.income - s.monthlyRates < 0 ? "bad" : "good" }
      : { label: t("Left after the instalments"), value: "—", sub: t("income not known yet") },
  ];
  const plan = (id: number) => {
    const p = plans.byCase[id];
    if (!p || p.kind === "none") return <span className="text-amber-700 dark:text-amber-400">{t("no plan")}</span>;
    if (p.kind === "once") return <span>{t("once")}</span>;
    return (
      <span>
        {p.left === 1 ? t("1 instalment left") : t("{n} instalments left", { n: p.left })}
        {p.end && <span className="block text-xs text-zinc-500">{t("until {month}", { month: monthYear(p.end) })}{p.estimatedStart ? " *" : ""}</span>}
      </span>
    );
  };
  const estimated = Object.values(plans.byCase).some((p) => p.estimatedStart);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 print:max-w-none print:p-0" data-debt-overview>
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Debt overview")}</h1>
          <p className="text-sm text-zinc-500">{t("As of {date}", { date: day(today) })}</p>
        </div>
        <div className="text-sm" title={info.months.map((m) => `${m.month}: ${euro(m.amount)}${m.text ? ` — ${m.text}` : ""}`).join("\n")}>
          <span className="block text-xs text-zinc-500">{t("Monthly income (net)")}</span>
          <InlineAmount
            value={o.income}
            digits={0}
            className="-mx-1 text-base font-semibold"
            hint={info.source === "manual" ? (info.derived != null ? t("yours — empty: the statements' {amount}", { amount: euro(info.derived, 0) }) : t("yours")) : info.source === "knowledge" ? t("from the statements") : t("click to enter")}
            onSave={async (v) => {
              const r = await setIncomeAction(v == null ? null : Number(v));
              if (!r.ok) toast(r.error, { tone: "error" });
              router.refresh();
            }}
          />
        </div>
        <button type="button" className="btn btn-sm print:hidden" onClick={() => window.print()}>
          {t("Print / save as PDF")}
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <dt className="text-xs font-medium text-zinc-500">{x.label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold tracking-tight tabular-nums ${x.tone === "bad" ? "text-red-600 dark:text-red-400" : x.tone === "good" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{x.value}</dd>
            <dd className="mt-0.5 text-xs text-zinc-500">{x.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="print:hidden">
        <AddDebt contacts={contacts} suggestions={suggestions} onDone={refresh} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 print:overflow-visible print:rounded-none print:border-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
              <th className="px-3 py-2">{t("Creditor")}</th>
              <th className="px-2 py-2 text-right">{t("Total")}</th>
              <th className="px-2 py-2 text-right">{t("Open")}</th>
              <th className="px-2 py-2 text-right">{t("Instalment")}</th>
              <th className="px-2 py-2">{t("Next due")}</th>
              <th className="px-2 py-2">{t("Plan")}</th>
              <th className="px-3 py-2">{t("Last payment")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {o.rows.map((r) => (
              <tr key={r.caseId} className="align-top">
                <td className="max-w-80 px-3 py-2.5">
                  <span className="font-medium">{r.creditor}</span>
                  <span className="block text-xs text-zinc-500">
                    {[r.caseNumber ? `Az. ${r.caseNumber}` : t("own debt"), r.collector ? t("via {name}", { name: r.collector }) : ""].filter(Boolean).join(" · ")}
                  </span>
                  {(() => {
                    // How to reach them — without the creditor's name again when it leads the contact.
                    const contact = r.contact.startsWith(r.creditor) ? r.contact.slice(r.creditor.length).replace(/^\s*·\s*/, "") : r.contact;
                    const line = [contact, r.iban].filter(Boolean).join(" · ");
                    return line ? (
                      <span className="block truncate text-xs text-zinc-400 print:whitespace-normal" title={line}>
                        {line}
                      </span>
                    ) : null;
                  })()}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <EditMoney readOnly={!r.manual} caseId={r.caseId} field="total" value={r.total} onSaved={refresh} />
                </td>
                <td className="px-2 py-2.5 text-right font-medium tabular-nums">
                  <EditMoney readOnly={!r.manual} caseId={r.caseId} field="open" value={r.open} onSaved={refresh} />
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <EditMoney readOnly={!r.manual} caseId={r.caseId} field="installment" value={r.installment} onSaved={refresh} />
                </td>
                <td className={`px-2 py-2.5 whitespace-nowrap ${r.nextDue && r.nextDue < today ? "text-red-600 dark:text-red-400" : ""}`}>
                  <EditMoney readOnly={!r.manual} caseId={r.caseId} field="due" value={r.nextDue} onSaved={refresh} />
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">{plan(r.caseId)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                  <span className="flex items-center justify-between gap-2">
                    {r.last ? `${day(r.last.date)} · ${euro(r.last.amount)}` : "—"}
                    {r.manual && <DeleteDebt caseId={r.caseId} name={r.creditor} onDone={refresh} />}
                  </span>
                </td>
              </tr>
            ))}
            {o.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-zinc-400">
                  {t("No case running.")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
              <td className="px-3 py-2">{t("Total")}</td>
              <td className="px-2 py-2 text-right tabular-nums">{euro(o.totals.total)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{euro(o.totals.open)}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {euro(allRates)}
                {later > 0 && <span className="block text-xs font-normal text-zinc-500">{t("running now {amount}", { amount: euro(s.monthlyRates) })}</span>}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      {estimated && <p className="-mt-4 text-xs text-zinc-500">* {t("No due day known: the plan is taken to start next month — set the due day for the exact date.")}</p>}

      {s.months.length > 0 && (
        <section className="space-y-2 break-inside-avoid">
          <h2 className="text-sm font-semibold">{t("Monthly payments until debt-free")}</h2>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <DebtChart months={s.months} names={Object.fromEntries(o.rows.map((r) => [r.caseId, r.creditor]))} income={o.income} />
          </div>
        </section>
      )}
    </div>
  );
}
