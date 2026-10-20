"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { DebtOverview } from "@/plugins/cases/bank";
import { setIncomeAction } from "@/plugins/cases/block-actions";

const euro = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "—");

/** The debts as a table to print, the totals, and the months ahead with what is left of your income. */
export function DebtView({ overview: o, today }: { overview: DebtOverview; today: string }) {
  const t = useT();
  const router = useRouter();
  const [income, setIncome] = useState(o.income != null ? String(o.income).replace(".", ",") : "");
  const saveIncome = async () => {
    const n = income.trim() ? Number(income.replace(/\./g, "").replace(",", ".")) : null;
    if (n != null && !Number.isFinite(n)) return void toast(t("Not an amount — e.g. 11,52"), { tone: "error" });
    const r = await setIncomeAction(n);
    if (!r.ok) toast(r.error, { tone: "error" });
    router.refresh();
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 print:p-0" data-debt-overview>
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t("Debt overview")}</h1>
          <p className="text-sm text-zinc-500">{t("As of {date} — every running case with its creditor, what is open and what is due.", { date: day(today) })}</p>
        </div>
        <label className="text-sm print:hidden">
          <span className="label">{t("Monthly income (net)")}</span>
          <input className="input w-36" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} onBlur={() => void saveIncome()} placeholder="0,00" />
        </label>
        <button type="button" className="btn print:hidden" onClick={() => window.print()}>
          {t("Print / save as PDF")}
        </button>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left text-xs text-zinc-500 dark:border-zinc-700">
            <th className="py-1.5 pr-2">{t("Creditor")}</th>
            <th className="py-1.5 pr-2">{t("Case number")}</th>
            <th className="py-1.5 pr-2 text-right">{t("Total")}</th>
            <th className="py-1.5 pr-2 text-right">{t("Open")}</th>
            <th className="py-1.5 pr-2 text-right">{t("Instalment")}</th>
            <th className="py-1.5 pr-2">{t("Next due")}</th>
            <th className="py-1.5 pr-2">{t("Last payment")}</th>
            <th className="py-1.5">{t("Contact")}</th>
          </tr>
        </thead>
        <tbody>
          {o.rows.map((r) => (
            <tr key={r.caseId} className="border-b border-zinc-200 align-top dark:border-zinc-800">
              <td className="py-1.5 pr-2">{r.creditor}</td>
              <td className="py-1.5 pr-2 font-mono text-xs whitespace-nowrap">{r.caseNumber}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{euro(r.total)}</td>
              <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{euro(r.open)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{euro(r.installment)}</td>
              <td className={`py-1.5 pr-2 whitespace-nowrap ${r.nextDue && r.nextDue < today ? "text-red-600 dark:text-red-400" : ""}`}>
                {day(r.nextDue)}
                {r.nextWhat ? <span className="block text-xs text-zinc-500">{r.nextWhat}</span> : null}
              </td>
              <td className="py-1.5 pr-2 whitespace-nowrap">{r.last ? `${day(r.last.date)} · ${euro(r.last.amount)}` : "—"}</td>
              <td className="py-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                {r.contact || "—"}
                {r.iban ? <span className="block font-mono">{r.iban}</span> : null}
              </td>
            </tr>
          ))}
          {o.rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-3 text-zinc-400">
                {t("No case running.")}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="py-1.5 pr-2" colSpan={2}>
              {t("Total")}
            </td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{euro(o.totals.total)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{euro(o.totals.open)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{euro(o.totals.installments)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("The months ahead")}</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {o.months.map((m) => (
            <div key={m.month} className="rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">{new Date(`${m.month}-01`).toLocaleDateString("de-DE", { month: "short", year: "numeric" })}</div>
              <div className="text-sm tabular-nums">{t("Instalments {amount}", { amount: euro(m.installments) })}</div>
              {m.left != null && <div className={`text-sm font-medium tabular-nums ${m.left < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{t("Left {amount}", { amount: euro(m.left) })}</div>}
            </div>
          ))}
        </div>
        {o.income == null && <p className="text-xs text-zinc-500 print:hidden">{t("Enter your monthly income above — the months then show what is left after the instalments.")}</p>}
      </section>
    </div>
  );
}
