import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import { DEBTS_VIEW } from "../src/plugins/finances/view-template.meta";
import { debtsAppData } from "../src/plugins/finances/view-data";
import type { FinancesOverview } from "../src/plugins/finances/server-actions";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const plan = (payments: { date: string; amount: number }[], kind: "plan" | "once" | "none" = "plan", end: string | null = null) => ({ kind, payments, end, estimatedStart: false });
const debt = (id: number, creditor: string, open: number, over: Record<string, unknown> = {}) => ({
  id, dir: "owe", caseId: null, title: creditor, label: "", creditor, creditorId: id * 10, collector: "", manual: true, total: open * 2, open, installment: 100, nextDue: "2026-11-15", day: 15, nextWhat: "", last: null, contact: "", iban: "", payment: null,
  plan: plan([{ date: "2026-11-15", amount: 100 }], "plan", "2027-06"), ...over,
});
const overview = (dir: "owe" | "owed"): FinancesOverview =>
  ({
    dir,
    debts: [debt(1, "SKP", 26000), debt(2, "Sparkasse", 3618.13, { manual: false, label: "DR II 1121/26", collector: "Ulrike Nathanael", payment: { name: "OGV", iban: "DE00", bic: "", amount: 300, purpose: "x" } }), debt(3, "Chris", 80, { plan: plan([{ date: "2028-02-01", amount: 80 }], "once") })],
    summary: { monthlyRates: 1603, debtFree: "2035-04", unplanned: 0, next: { date: "2026-10-15", amount: 11.52 }, months: [{ month: "2026-11", amount: 1603 }] },
    income: { amount: 3552, source: "statements", months: [] },
    fixed: { amount: 940, agg: "sum", items: [{ id: "1:1", title: "Miete", amount: 600, source: "Verträge", color: "#c4b5fd" }, { id: "1:2", title: "Strom", amount: 80, source: "Verträge", color: "#fcd34d" }] },
    contacts: [],
    suggestions: [],
  }) as unknown as FinancesOverview;

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const draw = (dir: "owe" | "owed", state: Record<string, string> = { dir, fixed: "true" }) =>
  renderView(DEBTS_VIEW.defaultTemplate(t), { rows: [], props: [], titleName: "Name", state, app: debtsAppData(overview(dir), { t, withFixed: state.fixed === "true", today: "2026-10-22", locale: "de-DE" }), db: { id: 1, title: "Schulden" }, locale: "de-DE" }, { parts: DEBTS_VIEW.parts, actions: DEBTS_VIEW.actions });

test("the debts overview's default template draws without an error — both sides, the fixed costs counted in or not", () => {
  for (const [dir, fixed] of [["owe", "true"], ["owe", ""], ["owed", "true"]] as const) {
    const r = draw(dir, { dir, fixed });
    assert.deepEqual(r.errors, [], `${dir} ${fixed}`);
  }
});

test("built of the language: tiles with the figures, a table of the debts in their creditors' colours, the charts; parts where it takes more", () => {
  const r = draw("owe");
  const tiles = find(r.nodes, "tile");
  assert.deepEqual(tiles.map((x) => x.a.label), ["Open in all", "Running costs a month", "Debt-free", "Left after instalments and fixed costs"]);
  assert.equal(tiles[0].a.value, "29.698 €");
  assert.equal(tiles[1].a.value, "2.543 €", "instalments + fixed costs");
  assert.equal(tiles[3].a.value, "1.009 €");
  assert.equal(tiles[3].a.tone, "good");
  assert.equal(find(tiles[3].c, "part")[0].a.name, "debts.income");
  const table = find(r.nodes, "datatable")[0];
  assert.equal(table.c.length, 3, "a line per debt");
  assert.deepEqual(find(r.nodes, "dot").map((d) => d.a.color.startsWith("#")), [true, true, true]);
  assert.match(vnodeToString(table.c[1]), /Az\. DR II 1121\/26 · via Ulrike Nathanael/);
  assert.deepEqual(find(r.nodes, "part").filter((p) => p.a.name === "debts.pay").map((p) => p.a.debt), ["2"], "pay where there is an account");
  assert.deepEqual(find(r.nodes, "chart").length, 2, "by creditor, the fixed costs");
  assert.ok(find(r.nodes, "toggle")[0].a.label.includes("940 €"));
  const owed = draw("owed");
  assert.deepEqual(find(owed.nodes, "tile").map((x) => x.a.label), ["Owed to you in all", "Coming back a month", "All back", "Next payment"]);
});
