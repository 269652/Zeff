"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { casesOverviewAction, type CasesOverview } from "../block-actions";
import { AddDebt } from "./AddDebt";
import { BankBar } from "./BankBar";
import { EditMoney } from "./EditMoney";

/**
 * The cases database's overview: what is open in all, what is due in 30 days, what is overdue — then the running cases by
 * what is due first, each with its GiroCode a click away (the instalment, else what is open, as amount) and its page.
 */

const euro = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "EUR" }));

export default function CasesView({ openRow }: AppViewProps) {
  const t = useT();
  const [o, setO] = useState<CasesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const load = () => void casesOverviewAction().then((r) => (r.ok ? setO(r.overview) : setError(r.error)));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
  useEffect(load, []);
  if (!o) return <p className="text-sm text-zinc-400">{error ?? "…"}</p>;
  const today = new Date().toISOString().slice(0, 10);
  const tiles = [
    { label: t("Open in all"), value: euro(o.figures.open), bad: false },
    { label: t("Due in 30 days"), value: euro(o.figures.dueSoon), bad: false },
    { label: t("Running cases"), value: String(o.figures.running), bad: false },
    { label: t("Overdue"), value: String(o.figures.overdue), bad: o.figures.overdue > 0 },
    { label: o.figures.incomeSource === "manual" ? t("Income a month (yours)") : t("Income a month"), value: o.figures.income != null ? euro(o.figures.income) : t("not known yet"), bad: false },
  ];
  return (
    <div className="space-y-4" data-cases-view>
      <BankBar onChanged={load} />
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500">{x.label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${x.bad ? "text-red-600 dark:text-red-400" : ""}`}>{x.value}</dd>
          </div>
        ))}
      </dl>
      <AddDebt contacts={o.contacts} suggestions={o.suggestions} onDone={load} />
      {o.cases.length === 0 ? (
        <p className="text-sm text-zinc-400">{t("No case running.")}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {o.cases.map((c) => {
            const overdue = !!c.nextDue && c.nextDue < today;
            return (
              <li key={c.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {c.manual ? <span className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("Own debt")}</span> : <span className="font-mono text-xs text-zinc-500">{c.label}</span>}
                  <span className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" disabled={!c.rowId} onClick={() => c.rowId && openRow(c.rowId)}>
                      {c.creditor || c.title}
                    </button>
                    {(c.creditor || c.collector) && (
                      <span className="block truncate text-xs text-zinc-500">
                        {c.creditor ? c.title : ""}
                        {c.collector ? `${c.creditor ? " · " : ""}${t("via {name}", { name: c.collector })}` : ""}
                      </span>
                    )}
                  </span>
                  {!c.creditor && c.person && <span className="text-xs text-zinc-500">{c.person}</span>}
                  <EditMoney caseId={c.id} field="open" value={c.open} onSaved={load} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {c.nextDue ? (
                    <span className={overdue ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}>
                      {overdue ? t("Overdue since {date}", { date: new Date(c.nextDue).toLocaleDateString() }) : new Date(c.nextDue).toLocaleDateString()}
                      {c.nextWhat ? ` · ${c.nextWhat}` : ""}
                    </span>
                  ) : (
                    <span className="text-zinc-400">{c.summed ? t("Nothing due.") : t("Not summed up yet")}</span>
                  )}
                  <span className="ml-auto">
                    {c.payment ? (
                      <button type="button" className={`btn btn-sm ${paying === c.id ? "" : "btn-primary"}`} onClick={() => setPaying(paying === c.id ? null : c.id)}>
                        {paying === c.id ? t("Close") : t("Pay with GiroCode")}
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-400">{t("No account known")}</span>
                    )}
                  </span>
                </div>
                {paying === c.id && c.payment && (
                  <div className="max-w-sm pt-1">
                    <GiroCode name={c.payment.name} iban={c.payment.iban} bic={c.payment.bic || null} amount={c.payment.amount} purpose={c.payment.purpose} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
