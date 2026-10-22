"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import type { Direction } from "../own";
import { financesOverviewAction, setIncomeAction, type FinancesOverview } from "../server-actions";
import { AddDebt } from "./AddDebt";
import { DebtChart } from "./DebtChart";
import { DeleteDebt } from "./DeleteDebt";
import { EditMoney } from "./EditMoney";
import { InlineAmount } from "./InlineAmount";

/**
 * The debts database's overview — two sides: the creditors overview (whom you owe what: open, the instalments running a month,
 * when you are debt-free, what is left of your income) and the debtors overview (who owes you: outstanding, what comes back a
 * month, when it is all back). Each debt with its plan; your own rows' figures a click to change (emptied: gone) and removable,
 * the cases' what their letters say; the months ahead as a chart. Printable.
 */

const euro = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }));
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString() : "—");
const monthYear = (iso: string, long = false) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString(undefined, { month: long ? "long" : "short", year: "numeric" });

export default function DebtsView({ openRow }: AppViewProps) {
  const t = useT();
  const [dir, setDir] = useState<Direction>("owe");
  const [o, setO] = useState<FinancesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const load = useCallback(() => void financesOverviewAction(dir).then((r) => (r.ok ? setO(r.overview) : setError(r.error))), [dir]);
  useEffect(load, [load]);
  // Today — fixed when the view opens.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  if (!o || o.dir !== dir) return <p className="text-sm text-zinc-400">{error ?? "…"}</p>;

  const owe = dir === "owe";
  const s = o.summary;
  const income = o.income.amount;
  const open = o.debts.reduce((a, d) => a + d.open, 0);
  const total = o.debts.reduce((a, d) => a + (d.total ?? d.open), 0);
  const allRates = o.debts.reduce((a, d) => a + (d.plan.kind === "plan" ? (d.installment ?? 0) : 0), 0);
  const later = Math.round((allRates - s.monthlyRates) * 100) / 100;
  const months = s.debtFree ? (Number(s.debtFree.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(s.debtFree.slice(5, 7)) - Number(today.slice(5, 7)) : null;
  const tiles: { label: string; value: string; sub: string; tone?: "good" | "bad" }[] = [
    { label: owe ? t("Open in all") : t("Owed to you in all"), value: euro(open, 0), sub: t("of {amount} in all", { amount: euro(total, 0) }) },
    { label: owe ? t("Instalments a month") : t("Coming back a month"), value: euro(s.monthlyRates, 0), sub: later > 0 ? t("running now — {amount} more starting later", { amount: euro(later, 0) }) : t("running now") },
    { label: owe ? t("Debt-free") : t("All back"), value: s.debtFree ? monthYear(s.debtFree, true) : "—", sub: s.debtFree ? `${months ? t("in {n} months", { n: months }) : ""}${s.unplanned > 0 ? ` · ${t("{amount} without a plan not in it", { amount: euro(s.unplanned, 0) })}` : ""}` : t("no plan yet") },
    owe
      ? income != null
        ? { label: t("Left after the instalments"), value: euro(income - s.monthlyRates, 0), sub: t("of {amount} income a month", { amount: euro(income, 0) }), tone: income - s.monthlyRates < 0 ? "bad" : "good" }
        : { label: t("Left after the instalments"), value: "—", sub: t("income not known yet") }
      : { label: t("Next payment"), value: s.next ? euro(s.next.amount) : "—", sub: s.next ? day(s.next.date) : "", tone: s.next && s.next.date < today ? "bad" : undefined },
  ];
  const planText = (d: FinancesOverview["debts"][number]) => {
    if (d.plan.kind === "none") return <span className="text-amber-700 dark:text-amber-400">{t("no plan")}</span>;
    if (d.plan.kind === "once") return <span>{t("once")}</span>;
    const left = d.plan.payments.length;
    return (
      <span>
        {left === 1 ? t("1 instalment left") : t("{n} instalments left", { n: left })}
        {d.plan.end && (
          <span className="block text-xs text-zinc-500">
            {t("until {month}", { month: monthYear(d.plan.end) })}
            {d.plan.estimatedStart ? " *" : ""}
          </span>
        )}
      </span>
    );
  };
  const estimated = o.debts.some((d) => d.plan.estimatedStart);
  const contactLine = (d: FinancesOverview["debts"][number]) => {
    const c = d.contact.startsWith(d.creditor) ? d.contact.slice(d.creditor.length).replace(/^\s*·\s*/, "") : d.contact;
    return [c, d.iban].filter(Boolean).join(" · ");
  };

  return (
    <div className="space-y-6" data-debts-view>
      <div className="flex flex-wrap items-end gap-4">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 print:hidden dark:bg-zinc-800/70" role="tablist" aria-label={t("Direction")}>
          {(
            [
              ["owe", t("Creditors overview")],
              ["owed", t("Debtors overview")],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={dir === k} className={`rounded-md px-3 py-1 text-sm font-medium transition ${dir === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`} onClick={() => setDir(k)}>
              {label}
            </button>
          ))}
        </div>
        <h2 className="hidden text-xl font-semibold print:block">{owe ? t("Creditors overview") : t("Debtors overview")}</h2>
        <span className="flex-1" />
        {owe && (
          <div className="text-sm" title={o.income.months.map((m) => `${m.month}: ${euro(m.amount)}${m.text ? ` — ${m.text}` : ""}`).join("\n")}>
            <span className="block text-xs text-zinc-500">{t("Monthly income (net)")}</span>
            <InlineAmount
              value={income}
              digits={0}
              className="-mx-1 text-base font-semibold"
              hint={o.income.source === "manual" ? (o.income.derived != null ? t("yours — empty: the statements' {amount}", { amount: euro(o.income.derived, 0) }) : t("yours")) : o.income.source === "knowledge" ? t("from the statements") : t("click to enter")}
              onSave={async (v) => {
                const r = await setIncomeAction(v == null ? null : Number(v));
                if (!r.ok) toast(r.error, { tone: "error" });
                load();
              }}
            />
          </div>
        )}
        <button type="button" className="btn btn-sm print:hidden" onClick={() => window.print()}>
          {t("Print / save as PDF")}
        </button>
      </div>

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
        <AddDebt dir={dir} contacts={o.contacts} suggestions={o.suggestions} onDone={load} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 print:overflow-visible print:rounded-none print:border-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
              <th className="px-3 py-2">{owe ? t("Creditor") : t("Debtor")}</th>
              <th className="px-2 py-2 text-right">{t("Total")}</th>
              <th className="px-2 py-2 text-right">{t("Open")}</th>
              <th className="px-2 py-2 text-right">{t("Instalment")}</th>
              <th className="px-2 py-2">{t("Next due")}</th>
              <th className="px-2 py-2">{t("Plan")}</th>
              <th className="px-3 py-2">{t("Last payment")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {o.debts.map((d) => (
              <tr key={d.id} className="align-top">
                <td className="max-w-80 px-3 py-2.5">
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => openRow(d.id)}>
                    {d.creditor}
                  </button>
                  <span className="block text-xs text-zinc-500">{[d.label ? `Az. ${d.label}` : t("own"), d.collector ? t("via {name}", { name: d.collector }) : "", d.title && d.title !== d.creditor ? d.title : ""].filter(Boolean).join(" · ")}</span>
                  {contactLine(d) && (
                    <span className="block truncate text-xs text-zinc-400 print:whitespace-normal" title={contactLine(d)}>
                      {contactLine(d)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <EditMoney readOnly={!d.manual} rowId={d.id} field="total" value={d.total} onSaved={load} />
                </td>
                <td className="px-2 py-2.5 text-right font-medium tabular-nums">
                  <EditMoney readOnly={!d.manual} rowId={d.id} field="open" value={d.open} onSaved={load} />
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <EditMoney readOnly={!d.manual} rowId={d.id} field="installment" value={d.installment} onSaved={load} />
                </td>
                <td className={`px-2 py-2.5 whitespace-nowrap ${d.plan.payments.some((p) => p.date < today) ? "text-red-600 dark:text-red-400" : ""}`}>
                  <EditMoney readOnly={!d.manual} rowId={d.id} field="due" value={d.nextDue} onSaved={load} />
                  {d.nextWhat && <span className="block text-xs text-zinc-500">{d.nextWhat}</span>}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">{planText(d)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                  <span className="flex items-center justify-between gap-2">
                    {d.last ? `${day(d.last.date)} · ${euro(d.last.amount)}` : "—"}
                    <span className="flex items-center gap-1 print:hidden">
                      {owe && d.payment && (
                        <button type="button" className={`btn btn-sm ${paying === d.id ? "" : "btn-primary"}`} onClick={() => setPaying(paying === d.id ? null : d.id)}>
                          {paying === d.id ? t("Close") : t("Pay")}
                        </button>
                      )}
                      {d.manual && <DeleteDebt rowId={d.id} name={d.creditor} onDone={load} />}
                    </span>
                  </span>
                  {paying === d.id && d.payment && (
                    <div className="mt-2 max-w-xs whitespace-normal">
                      <GiroCode name={d.payment.name} iban={d.payment.iban} bic={d.payment.bic || null} amount={d.payment.amount} purpose={d.payment.purpose} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {o.debts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-zinc-400">
                  {owe ? t("No debts — or not written down yet (+ Debt).") : t("Nobody owes you anything — or it isn't written down yet (+ Debt).")}
                </td>
              </tr>
            )}
          </tbody>
          {o.debts.length > 0 && (
            <tfoot>
              <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
                <td className="px-3 py-2">{t("Total")}</td>
                <td className="px-2 py-2 text-right tabular-nums">{euro(total)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{euro(open)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {euro(allRates)}
                  {later > 0 && <span className="block text-xs font-normal text-zinc-500">{t("running now {amount}", { amount: euro(s.monthlyRates) })}</span>}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {estimated && <p className="-mt-4 text-xs text-zinc-500">* {t("No due day known: the plan is taken to start next month — set the due day for the exact date.")}</p>}

      {s.months.some((m) => m.amount > 0) && (
        <section className="space-y-2 break-inside-avoid">
          <h2 className="text-sm font-semibold">{owe ? t("Monthly payments until debt-free") : t("Coming back a month until all is back")}</h2>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <DebtChart months={s.months} names={Object.fromEntries(o.debts.map((d) => [d.id, d.creditor]))} income={owe ? income : null} />
          </div>
        </section>
      )}
    </div>
  );
}
