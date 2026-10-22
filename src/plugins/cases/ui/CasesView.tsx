"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { casesOverviewAction, type CasesOverview } from "../block-actions";
import { AddDebt } from "./AddDebt";
import { BankBar } from "./BankBar";
import { DebtChart } from "./DebtChart";
import { DeleteDebt } from "./DeleteDebt";
import { EditMoney } from "./EditMoney";

/**
 * The cases database's overview — your debts at a glance: what is open, what the plans cost a month (your fixed costs for the
 * debts), when you are debt-free with them, the next payment; the months ahead as a chart; each debt with its plan (instalment,
 * what is left, until when, how far paid), its amounts a click to change and its GiroCode; the debts without a plan apart; the
 * other cases (no money open) at the end.
 */

type Debt = CasesOverview["plans"]["debts"][number];

const euro = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }));
const monthYear = (iso: string) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

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

  const { debts, summary: s } = o.plans;
  const planned = debts.filter((d) => d.plan.kind !== "none");
  const unplanned = debts.filter((d) => d.plan.kind === "none");
  const others = o.cases.filter((c) => !debts.some((d) => d.id === c.id));
  const names = Object.fromEntries(debts.map((d) => [d.id, d.creditor]));
  const open = debts.reduce((a, d) => a + d.open, 0);
  const months = s.debtFree ? Math.max(0, (Number(s.debtFree.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(s.debtFree.slice(5, 7)) - Number(today.slice(5, 7))) : null;
  const next = s.next ? debts.find((d) => d.id === s.next!.id) : null;
  const income = o.figures.income;
  const tiles: { label: string; value: string; sub?: string; tone?: "bad" }[] = [
    { label: t("Open in all"), value: euro(open, 0), sub: t("{n} debts", { n: debts.length }) },
    { label: t("Instalments a month"), value: euro(s.monthlyRates, 0), sub: income != null ? t("{amount} left of your income", { amount: euro(income - s.monthlyRates, 0) }) : t("your fixed costs for the debts") },
    { label: t("Debt-free"), value: s.debtFree ? monthYear(s.debtFree) : "—", sub: s.debtFree ? (s.unplanned > 0 ? t("with the plans — {amount} without one", { amount: euro(s.unplanned, 0) }) : months ? t("in {n} months", { n: months }) : "") : t("no plan yet") },
    { label: t("Next payment"), value: s.next ? euro(s.next.amount) : "—", sub: s.next ? `${day(s.next.date)}${next ? ` · ${next.creditor}` : ""}` : "", tone: s.next && s.next.date < today ? "bad" : undefined },
  ];

  const row = (d: Debt) => {
    const paid = d.total && d.total > d.open ? Math.min(100, Math.round(((d.total - d.open) / d.total) * 100)) : 0;
    const overdue = d.plan.payments.some((p) => p.date < today);
    const left = d.plan.payments.length;
    return (
      <li key={d.id} className="py-3 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <button type="button" className="block max-w-full truncate text-left font-medium hover:underline disabled:no-underline" disabled={!d.rowId} onClick={() => d.rowId && openRow(d.rowId)}>
              {d.creditor}
            </button>
            <p className="truncate text-xs text-zinc-500">
              {d.manual ? t("Own debt") : d.label}
              {d.collector ? ` · ${t("via {name}", { name: d.collector })}` : ""}
              {d.title && d.title !== d.creditor ? ` · ${d.title}` : ""}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-x-4 text-sm sm:grid-cols-[repeat(3,minmax(5.5rem,auto))]">
            <div>
              <dt className="text-xs text-zinc-500">{t("Open")}</dt>
              <dd className="font-medium">
                <EditMoney readOnly={!d.manual} caseId={d.id} field="open" value={d.open} onSaved={load} className="-mx-1" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">{d.plan.kind === "once" ? t("Once") : t("Instalment")}</dt>
              <dd>
                <EditMoney readOnly={!d.manual} caseId={d.id} field="installment" value={d.installment} onSaved={load} className="-mx-1" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">{t("Next due")}</dt>
              <dd className={overdue ? "text-red-600 dark:text-red-400" : ""}>
                <EditMoney readOnly={!d.manual} caseId={d.id} field="due" value={d.nextDue} onSaved={load} className="-mx-1" />
              </dd>
            </div>
          </dl>
          <div className="flex shrink-0 items-center gap-2">
            {d.manual && <DeleteDebt caseId={d.id} name={d.creditor} onDone={load} />}
            {d.payment ? (
              <button type="button" className={`btn btn-sm ${paying === d.id ? "" : "btn-primary"}`} onClick={() => setPaying(paying === d.id ? null : d.id)}>
                {paying === d.id ? t("Close") : t("Pay")}
              </button>
            ) : (
              <span className="text-xs text-zinc-400" title={t("No account known — add the IBAN to the creditor's details")}>
                {t("No account")}
              </span>
            )}
          </div>
        </div>
        {d.plan.kind === "plan" && (
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
            <div className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={paid} aria-valuemin={0} aria-valuemax={100} aria-label={t("Paid")}>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paid}%` }} />
            </div>
            <span>
              {paid > 0 ? `${t("{n} % paid", { n: paid })} · ` : ""}
              {left === 1 ? t("1 instalment left") : t("{n} instalments left", { n: left })}
              {d.plan.end ? ` · ${t("until {month}", { month: monthYear(d.plan.end) })}` : ""}
              {d.plan.estimatedStart ? ` · ${t("start taken as next month — set the due day")}` : ""}
            </span>
          </div>
        )}
        {paying === d.id && d.payment && (
          <div className="mt-3 max-w-sm">
            <GiroCode name={d.payment.name} iban={d.payment.iban} bic={d.payment.bic || null} amount={d.payment.amount} purpose={d.payment.purpose} />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-5" data-cases-view>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <BankBar onChanged={load} />
        <Link href="/vorgaenge/uebersicht" className="btn btn-sm">
          {t("Print view")} ↗
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <dt className="text-xs font-medium text-zinc-500">{x.label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold tracking-tight tabular-nums ${x.tone === "bad" ? "text-red-600 dark:text-red-400" : ""}`}>{x.value}</dd>
            {x.sub && <dd className="mt-0.5 truncate text-xs text-zinc-500" title={x.sub}>{x.sub}</dd>}
          </div>
        ))}
      </dl>

      {(s.overdue > 0 || unplanned.length > 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {s.overdue > 0 && <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-700 ring-1 ring-red-200 ring-inset dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">⚠ {t("{amount} overdue", { amount: euro(s.overdue) })}</span>}
          {unplanned.length > 0 && <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-800 ring-1 ring-amber-200 ring-inset dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">{t("{n} debts ({amount}) without a plan — not in the debt-free date", { n: unplanned.length, amount: euro(s.unplanned, 0) })}</span>}
        </div>
      )}

      {s.months.length > 0 && (
        <Card title={t("Monthly payments until debt-free")} aside={<span className="text-xs text-zinc-500">{t("hover a month for who gets what")}</span>}>
          <DebtChart months={s.months} names={names} income={income} />
        </Card>
      )}

      <Card title={t("Payment plans")} aside={<AddDebt contacts={o.contacts} suggestions={[]} onDone={load} />}>
        {planned.length ? <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{planned.map(row)}</ul> : <p className="text-sm text-zinc-400">{t("No plan yet — set an instalment on a debt below.")}</p>}
      </Card>

      {unplanned.length > 0 && (
        <Card title={t("Without a plan")} aside={<span className="text-xs text-zinc-500">{t("set an instalment or a due day: a click on the dash")}</span>}>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{unplanned.map(row)}</ul>
        </Card>
      )}

      {o.suggestions.length > 0 && <AddDebt contacts={o.contacts} suggestions={o.suggestions} onDone={load} hideButton />}

      {others.length > 0 && (
        <details className="rounded-xl border border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-semibold select-none">
            {t("Other cases")} <span className="font-normal text-zinc-400">{others.length}</span>
          </summary>
          <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {others.map((c) => (
              <li key={c.id} className="flex items-baseline gap-3 py-1.5">
                <span className="font-mono text-xs text-zinc-500">{c.label}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" disabled={!c.rowId} onClick={() => c.rowId && openRow(c.rowId)}>
                  {c.creditor || c.title}
                </button>
                <span className="text-xs text-zinc-500">{c.nextDue ? day(c.nextDue) : c.summed ? t("Nothing due.") : t("Not summed up yet")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
