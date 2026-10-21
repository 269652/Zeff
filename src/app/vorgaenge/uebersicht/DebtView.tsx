"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { DebtOverview } from "@/plugins/cases/bank";
import { setIncomeAction } from "@/plugins/cases/block-actions";
import type { DebtSuggestion } from "@/plugins/cases/parties";
import { AddDebt } from "@/plugins/cases/ui/AddDebt";
import { EditMoney } from "@/plugins/cases/ui/EditMoney";
import type { ContactOption } from "@/plugins/cases/ui/ContactField";

const euro = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "—");

/** The debts as a table to print, the totals, and the months ahead with what is left of your income. */
export function DebtView({ overview: o, today, contacts, suggestions }: { overview: DebtOverview; today: string; contacts: ContactOption[]; suggestions: DebtSuggestion[] }) {
  const t = useT();
  const router = useRouter();
  const info = o.incomeInfo;
  // Your own figure (empty: the statements').
  const [income, setIncome] = useState(info.source === "manual" && o.income != null ? String(o.income).replace(".", ",") : "");
  const saveIncome = async (v: string) => {
    const n = v.trim() ? Number(v.replace(/\./g, "").replace(",", ".")) : null;
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
        <div className="text-sm">
          <span className="label">{t("Monthly income (net)")}</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{euro(o.income)}</span>
            <span className="text-xs text-zinc-500" title={info.months.map((m) => `${m.month}: ${euro(m.amount)}${m.text ? ` — ${m.text}` : ""}`).join("\n")}>
              {info.source === "manual" ? t("set by you") : info.source === "none" ? t("no statements yet") : ""}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 print:hidden">
            <input className="input w-32 py-1 text-sm" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} onBlur={() => void saveIncome(income)} placeholder={info.derived != null ? euro(info.derived) : t("your own figure")} aria-label={t("Your own figure")} />
            {info.source === "manual" && info.derived != null && (
              <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => (setIncome(""), void saveIncome(""))}>
                {t("use the statements ({amount})", { amount: euro(info.derived) })}
              </button>
            )}
          </div>
        </div>
        <button type="button" className="btn print:hidden" onClick={() => window.print()}>
          {t("Print / save as PDF")}
        </button>
      </header>

      <div className="print:hidden">
        <AddDebt contacts={contacts} suggestions={suggestions} onDone={() => router.refresh()} />
      </div>

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
              <td className="py-1.5 pr-2">
                {r.creditor}
                {r.collector && <span className="block text-xs text-zinc-500">{t("via {name}", { name: r.collector })}</span>}
              </td>
              <td className="py-1.5 pr-2 font-mono text-xs whitespace-nowrap">{r.caseNumber}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                <EditMoney caseId={r.caseId} field="total" value={r.total} onSaved={() => router.refresh()} />
              </td>
              <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                <EditMoney caseId={r.caseId} field="open" value={r.open} onSaved={() => router.refresh()} />
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                <EditMoney caseId={r.caseId} field="installment" value={r.installment} onSaved={() => router.refresh()} />
              </td>
              <td className={`py-1.5 pr-2 whitespace-nowrap ${r.nextDue && r.nextDue < today ? "text-red-600 dark:text-red-400" : ""}`}>
                <EditMoney caseId={r.caseId} field="due" value={r.nextDue} onSaved={() => router.refresh()} />
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
