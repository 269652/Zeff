"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { GiroCode } from "@/components/GiroCode";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import type { Direction } from "../own";
import { financesOverviewAction, setIncomeAction, type FinancesOverview } from "../server-actions";
import { AddDebt } from "./AddDebt";
import { BalanceChart } from "./BalanceChart";
import { DebtChart } from "./DebtChart";
import { creditorColors, type CreditorOf } from "./colors";
import { DeleteDebt } from "./DeleteDebt";
import { EditMoney } from "./EditMoney";
import { InlineAmount } from "./InlineAmount";
import { ShareChart } from "./ShareChart";

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
  // The form for a new debt, opened by "+ Debt" beside "Print".
  const [adding, setAdding] = useState(false);
  // Only the latest load counts (a slower one before it doesn't put the old figures back); one that fails is tried once more.
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    const once = (again: boolean): Promise<void> =>
      financesOverviewAction(dir).then(
        (r) => {
          if (n !== seq.current) return;
          if (r.ok) setO(r.overview);
          else setError(r.error);
        },
        (e: unknown) => {
          if (n !== seq.current) return;
          if (again) return new Promise<void>((ok) => setTimeout(ok, 1000)).then(() => once(false));
          toast(e instanceof Error ? e.message : String(e), { tone: "error" });
        },
      );
    void once(true);
  }, [dir]);
  useEffect(load, [load]);
  // Today — fixed when the view opens.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  // The fixed costs counted in (the charts, what is left) — or not; kept in this browser.
  const [withFixed, setWithFixed] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this browser's choice, known once it is shown
      setWithFixed(localStorage.getItem("finances.withFixed") !== "0");
    } catch {
      // (no storage: counted in)
    }
  }, []);
  const toggleFixed = (on: boolean) => {
    setWithFixed(on);
    try {
      localStorage.setItem("finances.withFixed", on ? "1" : "0");
    } catch {
      // (not kept)
    }
  };
  if (!o || o.dir !== dir) return <p className="text-sm text-zinc-400">{error ?? "…"}</p>;

  const owe = dir === "owe";
  const s = o.summary;
  const income = o.income.amount;
  // The fixed costs, when they are counted in (only what you owe: they are yours to pay).
  const fixed = owe && withFixed ? o.fixed.amount : null;
  const left = income != null ? income - s.monthlyRates - (fixed ?? 0) : null;
  // The fixed costs' card beside "open by creditor": when there are any and they are counted in.
  const fixedCard = owe && withFixed && o.fixed.items.length > 0;
  const open = o.debts.reduce((a, d) => a + d.open, 0);
  const total = o.debts.reduce((a, d) => a + (d.total ?? d.open), 0);
  const allRates = o.debts.reduce((a, d) => a + (d.plan.kind === "plan" ? (d.installment ?? 0) : 0), 0);
  const later = Math.round((allRates - s.monthlyRates) * 100) / 100;
  const months = s.debtFree ? (Number(s.debtFree.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(s.debtFree.slice(5, 7)) - Number(today.slice(5, 7)) : null;
  // The income: a click to change, where the figure left after the instalments is shown.
  const incomeField = (
    <span title={o.income.months.map((m) => `${m.month}: ${euro(m.amount)}${m.text ? ` — ${m.text}` : ""}`).join("\n")}>
      {income != null && `${t("Income")} `}
      <InlineAmount
        value={income}
        digits={0}
        empty={t("Enter your income")}
        className={`-mx-0.5 font-medium ${income == null ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-700 dark:text-zinc-200"}`}
        onSave={async (v) => {
          const r = await setIncomeAction(v == null ? null : Number(v));
          if (!r.ok) toast(r.error, { tone: "error" });
          load();
          return r.ok;
        }}
      />
      {income != null && ` ${o.income.source === "manual" ? t("a month (yours)") : t("a month, from the statements")}`}
    </span>
  );
  const tiles: { label: string; value: string; sub: ReactNode; tone?: "good" | "bad" }[] = [
    { label: owe ? t("Open in all") : t("Owed to you in all"), value: euro(open, 0), sub: t("of {amount} in all", { amount: euro(total, 0) }) },
    // What goes out a month: the instalments — and the fixed costs, when they are counted in.
    owe && fixed != null
      ? { label: t("Running costs a month"), value: euro(s.monthlyRates + fixed, 0), sub: t("instalments {a} · fixed costs {b}", { a: euro(s.monthlyRates, 0), b: euro(fixed, 0) }) }
      : { label: owe ? t("Instalments a month") : t("Coming back a month"), value: euro(s.monthlyRates, 0), sub: later > 0 ? t("running now — {amount} more starting later", { amount: euro(later, 0) }) : t("running now") },
    { label: owe ? t("Debt-free") : t("All back"), value: s.debtFree ? monthYear(s.debtFree, true) : "—", sub: s.debtFree ? `${months ? t("in {n} months", { n: months }) : ""}${s.unplanned > 0 ? ` · ${t("{amount} without a plan not in it", { amount: euro(s.unplanned, 0) })}` : ""}` : t("no plan yet") },
    owe
      ? left != null
        ? {
            label: fixed != null ? t("Left after instalments and fixed costs") : t("Left after the instalments"),
            value: euro(left, 0),
            // What it is made of: the income — and the fixed costs, when they are counted in.
            sub: fixed != null ? (
              <>
                {incomeField} · {t("fixed costs {amount}", { amount: euro(fixed, 0) })}
              </>
            ) : (
              incomeField
            ),
            tone: left < 0 ? "bad" : "good",
          }
        : { label: t("Left after the instalments"), value: "—", sub: incomeField }
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
  // Open per contact (several debts with one creditor: one bar).
  const byWhom = new Map<number, { id: number; name: string; amount: number }>();
  for (const d of o.debts) {
    const k = d.creditorId ?? -d.id;
    const x = byWhom.get(k) ?? { id: k, name: d.creditor, amount: 0 };
    byWhom.set(k, { ...x, amount: x.amount + d.open });
  }
  // A colour per creditor, the most open first — the same in both charts; each debt row knows its creditor's.
  const colors = creditorColors([...byWhom.values()].sort((a, b) => b.amount - a.amount).map((x) => x.id));
  const creditorOf: CreditorOf = Object.fromEntries(o.debts.map((d) => [d.id, { key: d.creditorId ?? -d.id, name: d.creditor, color: colors[d.creditorId ?? -d.id] }]));
  const estimated = o.debts.some((d) => d.plan.estimatedStart);
  // What a debt is (its file number or "own", who collects it, what for) — one line.
  const whatOf = (d: FinancesOverview["debts"][number]) => [d.label ? `Az. ${d.label}` : t("own"), d.collector ? t("via {name}", { name: d.collector }) : "", d.title && d.title !== d.creditor ? d.title : ""].filter(Boolean).join(" · ");
  // The share paid off (0…1), when there is a total.
  const paidOff = (d: FinancesOverview["debts"][number]) => (d.total != null && d.total > 0 ? Math.max(0, Math.min(1, 1 - d.open / d.total)) : null);
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
        <button type="button" className="btn btn-sm print:hidden" aria-expanded={adding} onClick={() => setAdding(true)}>
          + {t("Debt")}
        </button>
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
        <AddDebt dir={dir} contacts={o.contacts} suggestions={o.suggestions} onDone={load} hideButton open={adding} onOpenChange={setAdding} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 print:overflow-visible print:rounded-none print:border-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60">
              <th className="px-3 py-2">{owe ? t("Creditor") : t("Debtor")}</th>
              <th className="px-2 py-2 text-right">{t("Total")}</th>
              <th className="px-2 py-2 text-right">{t("Open")}</th>
              <th className="px-2 py-2 text-right">{t("Instalment")}</th>
              <th className="px-2 py-2 whitespace-nowrap">{t("Next due")}</th>
              <th className="px-2 py-2">{t("Plan")}</th>
              <th className="px-2 py-2 whitespace-nowrap">{t("Last payment")}</th>
              <th className="w-px px-3 py-2 print:hidden">
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {o.debts.map((d) => (
              <Fragment key={d.id}>
                <tr className="group align-top transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
                  <td className="max-w-80 min-w-48 px-3 py-3">
                    {/* The creditor's colour, as in the charts below. */}
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: creditorOf[d.id]?.color }} aria-hidden />
                      <button type="button" className="truncate text-left font-medium hover:underline" onClick={() => openRow(d.id)}>
                        {d.creditor}
                      </button>
                    </span>
                    <span className="block truncate pl-4.5 text-xs text-zinc-500 print:whitespace-normal" title={whatOf(d)}>
                      {whatOf(d)}
                    </span>
                    {contactLine(d) && (
                      <span className="block truncate pl-4.5 text-xs text-zinc-400 print:whitespace-normal" title={contactLine(d)}>
                        {contactLine(d)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right text-zinc-500 tabular-nums">
                    <EditMoney readOnly={!d.manual} rowId={d.id} field="total" value={d.total} onSaved={load} />
                  </td>
                  <td className="px-2 py-3 text-right font-semibold tabular-nums">
                    <EditMoney readOnly={!d.manual} rowId={d.id} field="open" value={d.open} onSaved={load} />
                    {/* How much is paid off already, in the creditor's colour. */}
                    {paidOff(d) != null && (
                      <span className="mt-1.5 ml-auto block h-1 w-20 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" title={t("{pct} % paid off", { pct: Math.round(paidOff(d)! * 100) })}>
                        <span className="block h-full rounded-full" style={{ width: `${paidOff(d)! * 100}%`, background: creditorOf[d.id]?.color }} />
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    <EditMoney readOnly={!d.manual} rowId={d.id} field="installment" value={d.installment} onSaved={load} />
                  </td>
                  <td className={`max-w-52 px-2 py-3 ${d.plan.payments.some((p) => p.date < today) ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
                    <EditMoney readOnly={!d.manual} rowId={d.id} field="due" value={d.nextDue} onSaved={load} />
                    {d.nextWhat && (
                      <span className="block truncate text-xs font-normal text-zinc-500" title={d.nextWhat}>
                        {d.nextWhat}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">{planText(d)}</td>
                  <td className="px-2 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                    {d.last ? (
                      <>
                        {day(d.last.date)}
                        <span className="block text-xs text-zinc-500 tabular-nums">{euro(d.last.amount)}</span>
                      </>
                    ) : (
                      <span className="text-zinc-300 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 print:hidden">
                    <span className="flex min-w-24 items-center justify-end gap-1">
                      {owe && d.payment && (
                        <button type="button" className={`btn btn-sm ${paying === d.id ? "" : "btn-primary"}`} onClick={() => setPaying(paying === d.id ? null : d.id)}>
                          {paying === d.id ? t("Close") : t("Pay")}
                        </button>
                      )}
                      {d.manual && (
                        // Taking one out: there when you look at the row, not in every one.
                        <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                          <DeleteDebt rowId={d.id} name={d.creditor} onDone={load} />
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
                {paying === d.id && d.payment && (
                  <tr className="print:hidden">
                    <td colSpan={8} className="px-3 pb-3">
                      <div className="ml-auto max-w-xs">
                        <GiroCode name={d.payment.name} iban={d.payment.iban} bic={d.payment.bic || null} amount={d.payment.amount} purpose={d.payment.purpose} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {o.debts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-zinc-400">
                  {owe ? t("No debts — or not written down yet (+ Debt).") : t("Nobody owes you anything — or it isn't written down yet (+ Debt).")}
                </td>
              </tr>
            )}
          </tbody>
          {o.debts.length > 0 && (
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 align-top font-semibold dark:border-zinc-800 dark:bg-zinc-900/60">
                <td className="px-3 py-2.5">{t("Total")}</td>
                <td className="px-2 py-2.5 text-right text-zinc-500 tabular-nums">{euro(total)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{euro(open)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {euro(allRates)}
                  {later > 0 && <span className="block text-xs font-normal text-zinc-500">{t("running now {amount}", { amount: euro(s.monthlyRates) })}</span>}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {estimated && <p className="-mt-4 text-xs text-zinc-500">* {t("No due day known: the plan is taken to start next month — set the due day for the exact date.")}</p>}

      {s.months.some((m) => m.amount > 0) && (
        <div className={`grid gap-4 ${fixedCard ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          <section className="space-y-2 break-inside-avoid">
            <h2 className="text-sm font-semibold">{owe ? t("Open until debt-free") : t("Owed to you until all is back")}</h2>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <BalanceChart open={open} months={s.months} unplanned={s.unplanned} />
            </div>
          </section>
          <section className="space-y-2 break-inside-avoid">
            <h2 className="text-sm font-semibold">{owe ? t("Open by creditor") : t("Owed by debtor")}</h2>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <ShareChart items={[...byWhom.values()]} colors={colors} />
            </div>
          </section>
          {fixedCard && (
            // The fixed costs, item by item — read from where the type "Fixkosten" says they are; their colours as in the bars.
            <section className="space-y-2 break-inside-avoid">
              <h2 className="text-sm font-semibold">
                {t("Fixed costs")} <span className="font-normal text-zinc-500">· {euro(o.fixed.amount ?? 0, 0)}</span>
              </h2>
              <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <ShareChart items={o.fixed.items.map((x, i) => ({ id: i, name: x.title, amount: x.amount }))} colors={Object.fromEntries(o.fixed.items.map((x, i) => [i, x.color]))} />
                <p className="mt-2 text-xs text-zinc-500">{t("From: {sources}", { sources: [...new Set(o.fixed.items.map((x) => x.source))].join(", ") })}</p>
              </div>
            </section>
          )}
          <section className={`space-y-2 break-inside-avoid ${fixedCard ? "lg:col-span-3" : "lg:col-span-2"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{owe ? t("Monthly payments until debt-free") : t("Coming back a month until all is back")}</h2>
              {owe &&
                (o.fixed.amount != null ? (
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600 print:hidden dark:text-zinc-300">
                    <input type="checkbox" className="accent-indigo-600" checked={withFixed} onChange={(e) => toggleFixed(e.target.checked)} />
                    {t("Count in fixed costs ({amount})", { amount: euro(o.fixed.amount, 0) })}
                  </label>
                ) : (
                  <span className="text-xs text-zinc-400 print:hidden">{t("Fixed costs: publish a sum as “Fixkosten” under a column of a database of yours")}</span>
                ))}
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <DebtChart months={s.months} creditorOf={creditorOf} income={owe ? income : null} fixed={fixed != null ? o.fixed.items.map((x) => ({ key: x.id, name: x.title, color: x.color, amount: x.amount })) : null} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
