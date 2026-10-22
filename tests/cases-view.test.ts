import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import { CASES_VIEW } from "../src/plugins/cases/view-template.meta";
import { casesAppData } from "../src/plugins/cases/view-data";
import type { CasesOverview } from "../src/plugins/cases/block-actions";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
type Case = CasesOverview["cases"][number];
const kase = (id: number, over: Partial<Case> = {}): Case => ({
  id, rowId: id * 100, title: `Fall ${id}`, label: `DR ${id}/26`, person: "", creditor: "", collector: "", open: 120.5, nextDue: "2026-11-15", nextWhat: "Rate", payment: null, summed: true, ...over,
});
const payment = { name: "OGV", iban: "DE00", bic: "", amount: 300, purpose: "DR 2/26" };
const overview = (cases: Case[], debtsDb: number | null = 7): CasesOverview => ({ figures: { open: 3618.13, dueSoon: 300, overdue: 1, running: cases.length }, cases, debtsDb });
const CASES = [
  kase(1, { creditor: "Sparkasse", collector: "Ulrike Nathanael", nextDue: "2026-10-01", payment }),
  kase(2, { nextDue: null, summed: false, person: "Chris", rowId: null }),
  kase(3, { nextDue: null, open: null, nextWhat: "" }),
];

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const draw = (app: Record<string, unknown>, state: Record<string, string> = {}) =>
  renderView(CASES_VIEW.defaultTemplate(t), { rows: [], props: [], titleName: "Name", state, app, db: { id: 1, title: "Vorgänge" }, locale: "de-DE" }, { parts: CASES_VIEW.parts, actions: CASES_VIEW.actions });
const data = (o: CasesOverview, paying = "") => casesAppData(o, { t, today: "2026-10-22", paying, locale: "de-DE" });

test("the cases overview's default template draws without an error — loading, empty, cases, one being paid", () => {
  assert.deepEqual(draw({ loading: true, error: null }).errors, []);
  assert.deepEqual(draw(data(overview([], null))).errors, []);
  assert.deepEqual(draw(data(overview(CASES))).errors, []);
  assert.deepEqual(draw(data(overview(CASES), "1"), { paying: "1" }).errors, []);
});

test("while loading: the error or …, nothing else", () => {
  assert.equal(vnodeToString({ t: "x", a: {}, c: draw({ loading: true, error: null }).nodes }).includes("…"), true);
  const r = draw({ loading: true, error: "Boom" });
  assert.match(vnodeToString({ t: "x", a: {}, c: r.nodes }), /Boom/);
  assert.equal(find(r.nodes, "tile").length, 0);
});

test("built of the language: the bank, the link to the creditors, four figures, a list of the cases", () => {
  const r = draw(data(overview(CASES)));
  assert.equal(find(r.nodes, "part")[0].a.name, "cases.bank");
  const link = find(r.nodes, "button").find((b) => b.a.action === "url");
  assert.equal(link?.a.href, "/workspace/7");
  const tiles = find(r.nodes, "tile");
  assert.deepEqual(tiles.map((x) => x.a.label), ["Open in all", "Due in 30 days", "Running cases", "Overdue"]);
  assert.deepEqual(tiles.map((x) => x.a.value), ["3.618,13 €", "300,00 €", "3", "1"]);
  assert.equal(tiles[3].a.tone, "bad");
  const list = find(r.nodes, "list")[0];
  assert.equal(list.c.length, 3, "an item per case");
  const [a, b, c] = list.c.map((x) => vnodeToString(x as VNode));
  assert.match(a, /DR 1\/26/);
  assert.match(a, /Fall 1 · via Ulrike Nathanael/);
  assert.match(a, /Overdue since 1\.10\.2026 · Rate/);
  assert.match(a, /120,50 €/);
  assert.match(b, /Not summed up yet/);
  assert.match(b, /Chris/);
  assert.match(b, /No account known/);
  assert.match(c, /Nothing due\./);
  assert.match(c, /—/);
  // The creditor opens the case's row; no row, no button.
  const opens = find(r.nodes, "button").filter((x) => x.a.action === "open");
  assert.deepEqual(opens.map((x) => [x.a.row, x.a.label]), [["100", "Sparkasse"], ["300", "Fall 3"]]);
  // Pay where there is an account — its GiroCode only once opened.
  const pay = find(r.nodes, "button").filter((x) => x.a.action === "state");
  assert.deepEqual(pay.map((x) => [x.a.label, x.a.value, x.a.variant]), [["Pay with GiroCode", "1", "primary"]]);
  assert.equal(find(r.nodes, "part").filter((p) => p.a.name === "cases.girocode").length, 0);
});

test("a case being paid: Close, and its GiroCode under it", () => {
  const r = draw(data(overview(CASES), "1"), { paying: "1" });
  const pay = find(r.nodes, "button").filter((x) => x.a.action === "state");
  assert.deepEqual(pay.map((x) => [x.a.label, x.a.value]), [["Close", ""]]);
  assert.deepEqual(find(r.nodes, "part").filter((p) => p.a.name === "cases.girocode").map((p) => p.a.case), ["1"]);
});

test("no case running, no debts database: the empty list's text, no link, no overdue in red", () => {
  const o = overview([], null);
  o.figures = { open: 0, dueSoon: 0, overdue: 0, running: 0 };
  const r = draw(data(o));
  assert.equal(find(r.nodes, "list")[0].a.empty, "No case running.");
  assert.equal(find(r.nodes, "button").filter((b) => b.a.action === "url").length, 0);
  assert.equal(find(r.nodes, "tile")[3].a.tone, "plain");
  assert.deepEqual(find(r.nodes, "tile").map((x) => x.a.value), ["0,00 €", "0,00 €", "0", "0"]);
});
