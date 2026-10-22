import { isInstalled } from "@/plugins/state";
import { getPage } from "@/plugins/workspace/store";
import { refRows, valueAggregate, valueSources, type CalcFn } from "@/plugins/workspace/values";
import { rollup } from "@/plugins/workspace/model";

/**
 * Your monthly fixed costs (the Finances plugin): the value type "Fixkosten" of the Workspace — it only says where they are
 * (columns of your databases: Monatskosten, Verträge, Abos …); the rows are read here, from there: each item with its amount,
 * where it is from and a colour (lighter ones than the creditors', so a fixed cost is never taken for a debt). The amount is
 * the type's aggregate over all of them (sum by default). None made: none. Server only.
 */

export type FixedItem = { id: string; title: string; amount: number; source: string; color: string };
export type FixedCosts = { amount: number | null; agg: CalcFn | null; items: FixedItem[] };

const PALETTE = ["#c4b5fd", "#fcd34d", "#6ee7b7", "#fca5a5", "#7dd3fc", "#f9a8d4", "#bef264", "#fdba74", "#99f6e4", "#d8b4fe", "#cbd5e1", "#fde68a"];

export function fixedCosts(): FixedCosts {
  if (!isInstalled("workspace")) return { amount: null, agg: null, items: [] };
  const refs = valueSources("fixkosten");
  if (!refs.length) return { amount: null, agg: null, items: [] };
  const agg = valueAggregate("fixkosten") ?? "sum";
  const items = refs.flatMap((ref) => {
    const source = getPage(ref.dbId)?.title || "?";
    return refRows(ref).map((r) => ({ id: `${ref.dbId}:${r.rowId}`, title: r.title, amount: r.value, source }));
  });
  // The largest first, a colour each.
  const colored = [...items].sort((a, b) => b.amount - a.amount).map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
  const total = rollup(agg, undefined, items.map((x) => x.amount));
  return { amount: typeof total === "number" && Number.isFinite(total) ? Math.round(total * 100) / 100 : null, agg, items: items.map((x) => colored.find((c) => c.id === x.id)!) };
}
