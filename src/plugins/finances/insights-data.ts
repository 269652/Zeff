import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { CONTRACT } from "@/plugins/workspace/contract-fields";
import type { Property } from "@/plugins/workspace/model";
import { addRow, getDatabase, getPage, rawRows } from "@/plugins/workspace/store";
import { refRows, valueSources } from "@/plugins/workspace/values";
import { debtPlans } from "./debts";
import { monthlyIncome } from "./income";
import { cashflowFlows, forecast, matchContracts, recurringFlows, type ContractRow, type Flowing, type Forecast, type InBooking, type PlannedPayment } from "./insights";

/**
 * What the money insights read (the Finances plugin, insights.ts the figures): the bank's bookings of the last two years and a
 * bit, the rows of your contracts databases (the ones publishing "Fixkosten" — Verträge, Monatskosten), the debts' plans. And
 * the one thing they write: a subscription added to Verträge as a row. Server only.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** The bookings since 800 days back (a yearly one shows twice), both directions — none kept (or no bank): none. */
export function readBookings(day = today()): InBooking[] {
  try {
    const from = new Date(Date.parse(day) - 800 * 864e5).toISOString().slice(0, 10);
    return getSqlite().prepare("select date, amount, text, counterparty, coalesce(reference, '') reference from bank_transactions where date >= ? order by date").all(from) as InBooking[];
  } catch {
    return [];
  }
}

/** A text column that holds the customer (or contract) number — by the template's name or one like it. */
const customerProp = (props: Property[]) => props.find((p) => p.type === "text" && /kunden|customer|vertragsnummer|contract no/i.test(p.name));

/** The rows of the databases publishing "Fixkosten", each with its cost a month (the published column), whether it runs. */
export function contractRows(): ContractRow[] {
  if (!isInstalled("workspace")) return [];
  const seen = new Set<number>();
  return valueSources("fixkosten").flatMap((ref) => {
    if (seen.has(ref.dbId)) return [];
    seen.add(ref.dbId);
    const d = getDatabase(ref.dbId);
    if (!d || d.page.archivedAt) return [];
    const cust = customerProp(d.schema.properties);
    const running = new Map(refRows(ref).map((r) => [r.rowId, r.value]));
    return rawRows(ref.dbId).map((r) => {
      const v = r.cells[ref.propId];
      const monthly = running.get(r.id) ?? (typeof v === "number" && Number.isFinite(v) ? v : null);
      return { id: r.id, dbId: ref.dbId, title: r.title, monthly, srcref: String(r.cells.srcref ?? ""), customer: cust ? String(r.cells[cust.id] ?? "") : "", running: running.has(r.id) };
    });
  });
}

/**
 * Where a subscription goes as a row: the contracts database — the template's (its fields of fixed id) first, else one called
 * so, else the first publishing "Fixkosten" — with the column its cost a month is in. Null: none there.
 */
export function contractsTarget(): { dbId: number; title: string; monthlyProp: string } | null {
  if (!isInstalled("workspace")) return null;
  const refs = valueSources("fixkosten").filter((r) => {
    const d = getDatabase(r.dbId);
    return d && !d.page.archivedAt;
  });
  const props = (id: number) => getDatabase(id)?.schema.properties ?? [];
  const ref =
    refs.find((r) => props(r.dbId).some((p) => p.id === CONTRACT.monthly)) ??
    refs.find((r) => /vertr|contract/i.test(getPage(r.dbId)?.title ?? "")) ??
    refs[0];
  return ref ? { dbId: ref.dbId, title: getPage(ref.dbId)?.title || t("Contracts"), monthlyProp: ref.propId } : null;
}

export type Missing = Flowing & { yearly: number };

/** The subscriptions running now that no contracts row covers, the dearest first (by what they cost a month). */
export function missingSubscriptions(day = today()): { items: Missing[]; running: number; rows: number } {
  const { out } = recurringFlows(readBookings(day), day);
  const rows = contractRows();
  const matched = matchContracts(out, rows);
  const items = out
    .filter((r) => !matched.has(r.key))
    .map((r) => ({ ...r, yearly: Math.round(r.monthly * 1200) / 100 }))
    .sort((a, b) => b.monthly - a.monthly);
  return { items, running: out.length, rows: rows.length };
}

/** A select's (or status') option by its name — the first when no name is given. */
const optionId = (p: Property | undefined, name?: string) => (name ? p?.options?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.id : p?.options?.[0]?.id);

/** A subscription (by its recipient's key) added to the contracts database: its name, cost a month, per payment, rhythm, last and next. Its row's id. */
export function addSubscriptionRow(key: string, day = today()): { dbId: number; rowId: number } {
  const target = contractsTarget();
  if (!target) throw new Error(t("There is no contracts database yet (Workspace → templates → Contracts)."));
  const r = recurringFlows(readBookings(day), day).out.find((x) => x.key === key);
  if (!r) throw new Error(t("This payment isn't recurring any more."));
  const d = getDatabase(target.dbId)!;
  const props = d.schema.properties;
  const rhythm = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") }[r.rhythm];
  const status = props.find((p) => p.type === "status");
  const cells: Record<string, unknown> = {
    [target.monthlyProp]: r.monthly,
    // (The template's fields — a database of your own without them just takes the cost.)
    [CONTRACT.amount]: r.amount,
    [CONTRACT.rhythm]: optionId(props.find((p) => p.id === CONTRACT.rhythm), rhythm),
    [CONTRACT.last]: r.last,
    [CONTRACT.next]: r.next,
    ...(status ? { [status.id]: optionId(status) } : {}),
  };
  // A database that follows the recurring source: the row is the one it would bring (its ref) — it isn't brought twice.
  if (props.some((p) => p.id === "srcref") && d.schema.pipeline?.steps.some((s) => s.kind === "source" && s.ext === "recurring")) cells.srcref = `recurring:${r.key}`;
  return { dbId: target.dbId, rowId: addRow(target.dbId, { title: r.name, cells }) };
}

/** The next `days` days of your account: from `start` (the balance today, null: not known) — with what goes into it. */
export function cashflowForecast(opts: { start: number | null; buffer?: number; days?: number }, day = today()): Forecast & { inputs: { incomes: number; subscriptions: number; contracts: number; payments: number } } {
  const days = opts.days ?? 90;
  const flowing = recurringFlows(readBookings(day), day);
  const payments: PlannedPayment[] = (["owe", "owed"] as const).flatMap((dir) =>
    debtPlans(day, dir).debts.flatMap((d) => d.plan.payments.map((p) => ({ date: p.date, amount: p.amount, label: d.creditor, dir }))),
  );
  const income = monthlyIncome().amount;
  const flows = cashflowFlows({ incomes: flowing.in, outgoings: flowing.out, contracts: contractRows(), payments, income: income ? { amount: income, label: t("Income") } : null }, day, days);
  const count = (k: string) => new Set(flows.filter((f) => f.kind === k).map((f) => f.label)).size;
  return {
    ...forecast(flows, { today: day, days, start: opts.start, buffer: opts.buffer }),
    inputs: { incomes: count("income"), subscriptions: count("subscription"), contracts: count("contract"), payments: count("debt") + count("claim") },
  };
}
