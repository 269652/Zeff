"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import { toast } from "@/components/Toaster";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import type { Direction } from "../own";
import { financesOverviewAction, setIncomeAction, type FinancesOverview } from "../server-actions";
import { debtsAppData } from "../view-data";
import { AddDebt } from "./AddDebt";
import { BalanceChart } from "./BalanceChart";
import { creditorColors, type CreditorOf } from "./colors";
import { DebtChart } from "./DebtChart";
import { DeleteDebt } from "./DeleteDebt";
import { EditMoney } from "./EditMoney";
import { EditSide } from "./EditSide";
import { InlineAmount } from "./InlineAmount";

/**
 * The debts overview, client side: what its template reads as app.* (the overview of the direction shown — read again when the rows
 * change), and the parts it is built of where the language's tags aren't enough.
 */

/** The overview of the direction the template's state says (state.dir), worked out for the template (view-data.ts). */
function useDebtsData(props: AppViewProps, state: Record<string, string>) {
  const t = useT();
  const dir: Direction = state.dir === "owed" ? "owed" : "owe";
  const [o, setO] = useState<FinancesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  // Only the latest load counts; one that fails is tried once more.
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
          setError(e instanceof Error ? e.message : String(e));
        },
      );
    void once(true);
  }, [dir]);
  // Read again when the database's rows change (a debt made, one changed in its page).
  const rowsKey = JSON.stringify(props.rows.map((r) => [r.id, r.title, r.cells]));
  useEffect(load, [load, rowsKey]);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const withFixed = state.fixed === "true";
  const data = useMemo(
    () => (o && o.dir === dir ? debtsAppData(o, { t, withFixed, today, locale: typeof navigator !== "undefined" ? navigator.language : undefined }) : { loading: true, error, owe: dir === "owe" }),
    [o, dir, t, withFixed, today, error],
  );
  return { data, reload: load };
}

const overviewOf = (p: PartProps) => (p.app.overview as FinancesOverview | undefined) ?? null;
const debtOf = (p: PartProps) => overviewOf(p)?.debts.find((d) => d.id === Number(p.attrs.debt)) ?? null;

/** The form for a new debt and the promises to write down — opened by the toolbar's New (and the debts.new action). */
function AddPart(p: PartProps) {
  const o = overviewOf(p);
  const { onNew, setState } = p;
  useEffect(() => {
    onNew?.(() => setState("adding", "true"));
    return () => onNew?.(null);
  }, [onNew, setState]);
  if (!o) return null;
  return (
    <div className="print:hidden">
      <AddDebt dir={o.dir} contacts={o.contacts} suggestions={o.suggestions} onDone={p.reloadApp} hideButton open={p.state.adding === "true"} onOpenChange={(v) => p.setState("adding", v ? "true" : "")} />
    </div>
  );
}

/** Your income a month: a click to change. */
function IncomePart(p: PartProps) {
  const t = useT();
  const o = overviewOf(p);
  if (!o) return null;
  const income = o.income.amount;
  const euro = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "EUR" });
  return (
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
          p.reloadApp();
          return r.ok;
        }}
      />
      {income != null && ` ${o.income.source === "manual" ? t("a month (yours)") : t("a month, from the statements")}`}
    </span>
  );
}

/** A debt's figure: changed in place for your own, as the letters say for a case's. */
function MoneyPart(p: PartProps) {
  const d = debtOf(p);
  const field = p.attrs.field;
  if (!d || !["total", "open", "installment", "due"].includes(field)) return null;
  const value = field === "total" ? d.total : field === "open" ? d.open : field === "installment" ? d.installment : d.nextDue;
  return <EditMoney readOnly={!d.manual} rowId={d.id} field={field as "total" | "open" | "installment" | "due"} value={value} onSaved={p.reloadApp} />;
}

/** Who is on a debt's other side, changed in place. */
function SidePart(p: PartProps) {
  const o = overviewOf(p);
  const d = debtOf(p);
  if (!o || !d) return null;
  return <EditSide rowId={d.id} value={d.creditorId} contacts={o.contacts} onSaved={p.reloadApp} />;
}

/** Pay: the debt's GiroCode, shown under the button. */
function PayPart(p: PartProps) {
  const t = useT();
  const d = debtOf(p);
  const [open, setOpen] = useState(false);
  if (!d?.payment) return null;
  return (
    <span className="relative print:hidden">
      <button type="button" className={`btn btn-sm ${open ? "" : "btn-primary"}`} onClick={() => setOpen(!open)}>
        {open ? t("Close") : t("Pay")}
      </button>
      {open && (
        <span className="absolute top-full right-0 z-20 mt-1 block w-72 rounded-xl border border-zinc-200 bg-white p-2 text-left shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <GiroCode name={d.payment.name} iban={d.payment.iban} bic={d.payment.bic || null} amount={d.payment.amount} purpose={d.payment.purpose} />
        </span>
      )}
    </span>
  );
}

/** Remove one of your own debts — there when the row is pointed at. */
function DeletePart(p: PartProps) {
  const d = debtOf(p);
  if (!d?.manual) return null;
  return (
    <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      <DeleteDebt rowId={d.id} name={d.creditor} onDone={p.reloadApp} />
    </span>
  );
}

function BalancePart(p: PartProps) {
  const o = overviewOf(p);
  if (!o) return null;
  return <BalanceChart open={o.debts.reduce((a, d) => a + d.open, 0)} months={o.summary.months} unplanned={o.summary.unplanned} />;
}

/** The payments a month, stacked by creditor (their colours as in the table), the fixed costs under them when counted in. */
function MonthlyPart(p: PartProps) {
  const o = overviewOf(p);
  if (!o) return null;
  const owe = o.dir === "owe";
  const byWhom = new Map<number, number>();
  for (const d of o.debts) byWhom.set(d.creditorId ?? -d.id, (byWhom.get(d.creditorId ?? -d.id) ?? 0) + d.open);
  const colors = creditorColors([...byWhom.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]));
  const creditorOf: CreditorOf = Object.fromEntries(o.debts.map((d) => [d.id, { key: d.creditorId ?? -d.id, name: d.creditor, color: colors[d.creditorId ?? -d.id] }]));
  const fixedOn = owe && p.state.fixed === "true" && o.fixed.amount != null;
  return <DebtChart months={o.summary.months} creditorOf={creditorOf} income={owe ? o.income.amount : null} fixed={fixedOn ? o.fixed.items.map((x) => ({ key: x.id, name: x.title, color: x.color, amount: x.amount })) : null} />;
}

const view: ViewAppModule = {
  parts: {
    "debts.add": AddPart,
    "debts.income": IncomePart,
    "debts.money": MoneyPart,
    "debts.side": SidePart,
    "debts.pay": PayPart,
    "debts.delete": DeletePart,
    "debts.balance-chart": BalancePart,
    "debts.monthly-chart": MonthlyPart,
  },
  useAppData: useDebtsData,
  actions: { "debts.new": (env) => env.setState("adding", "true") },
};
export default view;
