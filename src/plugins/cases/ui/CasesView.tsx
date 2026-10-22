"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { casesOverviewAction, type CasesOverview } from "../block-actions";
import { BankBar } from "./BankBar";

/**
 * The cases database's overview: what the running cases hold in all, what is due in 30 days, what is overdue — then the cases
 * by what is due first, each with its creditor, who collects it, the next step and its GiroCode. The debts themselves — plans,
 * fixed costs, when you are debt-free — are the Finances plugin's (its creditors overview, a link away).
 */

const euro = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "EUR" }));
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString() : "—");

export default function CasesView({ openRow }: AppViewProps) {
  const t = useT();
  const [o, setO] = useState<CasesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const load = () => void casesOverviewAction().then((r) => (r.ok ? setO(r.overview) : setError(r.error)));
  useEffect(load, []);
  // Today — fixed when the view opens.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  if (!o) return <p className="text-sm text-zinc-400">{error ?? "…"}</p>;
  const tiles = [
    { label: t("Open in all"), value: euro(o.figures.open), bad: false },
    { label: t("Due in 30 days"), value: euro(o.figures.dueSoon), bad: false },
    { label: t("Running cases"), value: String(o.figures.running), bad: false },
    { label: t("Overdue"), value: String(o.figures.overdue), bad: o.figures.overdue > 0 },
  ];
  return (
    <div className="space-y-5" data-cases-view>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <BankBar onChanged={load} />
        {o.debtsDb && (
          <Link href={`/workspace/${o.debtsDb}`} className="btn btn-sm">
            {t("Creditors overview")} →
          </Link>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <dt className="text-xs font-medium text-zinc-500">{x.label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold tracking-tight tabular-nums ${x.bad ? "text-red-600 dark:text-red-400" : ""}`}>{x.value}</dd>
          </div>
        ))}
      </dl>
      {o.cases.length === 0 ? (
        <p className="text-sm text-zinc-400">{t("No case running.")}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {o.cases.map((c) => {
            const overdue = !!c.nextDue && c.nextDue < today;
            return (
              <li key={c.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-mono text-xs text-zinc-500">{c.label}</span>
                  <span className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" disabled={!c.rowId} onClick={() => c.rowId && openRow(c.rowId)}>
                      {c.creditor || c.title}
                    </button>
                    <span className="block truncate text-xs text-zinc-500">{[c.creditor ? c.title : "", c.collector ? t("via {name}", { name: c.collector }) : "", !c.creditor ? c.person : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="tabular-nums" title={t("From the case's letters and mails")}>
                    {euro(c.open)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {c.nextDue ? (
                    <span className={overdue ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}>
                      {overdue ? t("Overdue since {date}", { date: day(c.nextDue) }) : day(c.nextDue)}
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
