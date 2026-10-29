import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Kennzahlen: named numbers every part of Zeff reads — made of table columns (value types), of a formula over others, or given
// by a plugin; read in database formulas (kennzahl("…")), in pages (@…), by agents; a value a day kept, goals and thresholds.
setupTempData();

let made: { db: number; amount: { id: string } } | null = null;
async function setup() {
  const m = await import("@/plugins/workspace/metrics");
  m.forgetMetricValues();
  if (made) return { m, ...made };
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { createPage, addRow, getDatabase } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const amount = newProperty("Betrag", "number");
  const db = createPage({ kind: "database", title: "Einnahmen", schema: { titleName: "Posten", properties: [amount], views: [newView("Alle", "table")] } });
  addRow(db, { title: "Gehalt", cells: { [amount.id]: 3000 } });
  addRow(db, { title: "Nebenjob", cells: { [amount.id]: 500 } });
  const { publishValue } = await import("@/plugins/workspace/values");
  publishValue({ label: "Einkommen", dbId: db, viewId: getDatabase(db)!.schema.views[0].id, propId: amount.id, fn: "sum" });
  const { workspaceMetrics } = await import("@/plugins/workspace/metric-point");
  // A plugin's: "Ausgaben" (as the Finances plugin gives it) — here a fixed number.
  workspaceMetrics.contribute("core", [{ label: "Ausgaben", unit: "€/Monat", what: "Test", read: () => 2800 }]);
  m.forgetMetricValues();
  made = { db, amount };
  return { m, db, amount };
}

test("a Kennzahl from a formula over others (a table's, a plugin's): its value now, live — a bad formula refused, a loop said, not hung", async () => {
  const { m, db, amount } = await setup();
  assert.equal(m.metricValue("Einkommen").value, 3500, "made of a table's column");
  assert.equal(m.metricValue("Ausgaben").value, 2800, "a plugin's");
  m.defineFormulaMetric({ label: "Sparrate %", formula: '(kennzahl("Einkommen") - kennzahl("Ausgaben")) / kennzahl("Einkommen") * 100', unit: "%", what: "Of the income, what didn't go out" });
  assert.equal(m.metricValue("Sparrate %").value, 20);
  const listed = m.getMetric("sparrate")!;
  assert.equal(listed.kind, "formula");
  assert.equal(listed.unit, "%");
  // Live: a row more, another value (after the few seconds a value is kept).
  const { addRow } = await import("@/plugins/workspace/store");
  const bonus = addRow(db, { title: "Bonus", cells: { [amount.id]: 500 } });
  m.forgetMetricValues();
  assert.equal(m.metricValue("Sparrate %").value, 30);
  (await import("@/plugins/workspace/store")).archivePage(bonus);
  m.forgetMetricValues();
  // Refused: a formula that doesn't parse; a name a table's value has; a loop round about.
  assert.throws(() => m.defineFormulaMetric({ label: "Kaputt", formula: "(1 +" }), /The formula/);
  assert.throws(() => m.defineFormulaMetric({ label: "Einkommen", formula: "1" }), /database columns already/);
  m.defineFormulaMetric({ label: "A", formula: "1" });
  m.defineFormulaMetric({ label: "B", formula: 'kennzahl("A") + 1' });
  assert.throws(() => m.defineFormulaMetric({ label: "A", formula: 'kennzahl("B") + 1' }), /reads itself/);
  m.forgetMetricValues();
  assert.equal(m.metricValue("B").value, 2, "the loop wasn't kept: A is still 1");
  assert.match(m.metricValue("Gibt es nicht").error ?? "", /No Kennzahl/);
});

test("yours wins over a plugin's of the same name; kennzahl() in a database's formula column reads the Kennzahl", async () => {
  const { m } = await setup();
  m.defineFormulaMetric({ label: "Ausgaben", formula: "2000" });
  assert.equal(m.metricValue("Ausgaben").value, 2000);
  assert.equal(m.getMetric("Ausgaben")!.kind, "formula");
  m.removeMetric("Ausgaben");
  m.forgetMetricValues();
  assert.equal(m.metricValue("Ausgaben").value, 2800, "removed: the plugin's again");

  const { createPage, addRow, rowsOf } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const share = { ...newProperty("Anteil am Einkommen", "formula"), formula: 'prop("Betrag") / kennzahl("Einkommen") * 100' };
  const amount = newProperty("Betrag", "number");
  const db = createPage({ kind: "database", title: "Abos", schema: { titleName: "Abo", properties: [amount, share], views: [newView("Alle", "table")] } });
  addRow(db, { title: "Streaming", cells: { [amount.id]: 35 } });
  assert.equal(rowsOf(db)!.rows[0].cells[share.id], 1, "35 of 3500 = 1 %");
});

test("a Kennzahl in a page: [[metric:key|Label]] in and out of Markdown, its live value for the chip", async () => {
  await setup();
  const { markdownToDoc, docToMarkdown, docRefs } = await import("@/plugins/workspace/doc");
  const doc = markdownToDoc("Diesen Monat [[metric:einkommen|Einkommen]] — gut.");
  const ref = docRefs(doc)[0];
  assert.deepEqual(ref, { kind: "metric", ref: "einkommen", label: "Einkommen" });
  assert.match(docToMarkdown(doc), /\[\[metric:einkommen\|Einkommen\]\]/);
  const { mentionStateAction, mentionSearchAction } = await import("@/plugins/workspace/actions");
  const state = await mentionStateAction([{ kind: "metric", ref: "einkommen" }]);
  assert.equal(state["metric:einkommen"].value, "3.500");
  assert.ok((await mentionSearchAction("einko")).some((i) => i.kind === "metric" && i.ref === "einkommen"), "the @ menu offers it");
});

test("once a day: each value into its history; beyond a threshold a todo, once per crossing; a goal's progress", async () => {
  const { m } = await setup();
  m.setMetricMeta("Ausgaben", { alert: { above: 2500 }, goal: { target: 2500, dir: "atMost" } });
  const day1 = new Date("2026-11-02T08:00:00");
  const r1 = await m.snapshotMetrics(day1);
  assert.ok(r1.taken >= 2);
  assert.deepEqual(r1.alerts, ["ausgaben"]);
  assert.equal((await m.snapshotMetrics(day1)).taken, 0, "once a day");
  const { listTodos } = await import("@/lib/boards/store");
  assert.equal(listTodos({ status: "open" }).filter((t) => /Ausgaben/.test(t.text)).length, 1);
  // The next day still beyond: no second todo.
  assert.deepEqual((await m.snapshotMetrics(new Date("2026-11-03T08:00:00"))).alerts, []);
  assert.deepEqual(m.metricHistory("Ausgaben").map((h) => h.day), ["2026-11-02", "2026-11-03"]);
  assert.deepEqual(m.goalProgress(m.getMetric("Ausgaben")!), { reached: false, gap: 300 });
  assert.equal(m.beyond(2400, { above: 2500 }), null);
  assert.throws(() => m.setMetricMeta("Ausgaben", { goal: { target: Number.NaN, dir: "atLeast" } }), /A goal/);
});

test("agents: metric_list, metric_get (with history), metric_define", async () => {
  await setup();
  const { registerWorkspaceTools } = await import("@/plugins/workspace/mcp");
  type R = { content: { text: string }[]; isError?: boolean };
  const tools: Record<string, (a: Record<string, unknown>) => Promise<R>> = {};
  const ok = (text: string): R => ({ content: [{ text }] });
  const fail = (text: string): R => ({ content: [{ text }], isError: true });
  registerWorkspaceTools({ registerTool: (name: string, _m: unknown, fn: never) => void (tools[name] = fn) } as never, { run: async (fn: () => unknown) => fn(), ok, fail } as never);
  const text = (r: R) => r.content.map((c) => c.text).join("\n");
  assert.match(text(await tools.metric_list({})), /Einkommen = 3\.500/);
  assert.match(text(await tools.metric_get({ name: "Ausgaben" })), /Ausgaben = 2\.800 €\/Monat/);
  assert.match(text(await tools.metric_define({ name: "Puffer", formula: 'kennzahl("Einkommen") - kennzahl("Ausgaben")', unit: "€" })), /Kennzahl "Puffer" made: 700 €/);
  assert.equal((await tools.metric_get({ name: "Nichts" })).isError, true);
});

test("what the numbers count: a meeting is set up by someone else (not a todo, not a day block), spending leaves money only moved out, a table's unit comes from its columns", async () => {
  const { isMeeting } = await import("@/plugins/workspace/metrics-core");
  const cal = (name: string, todos = false) => ({ name, todos });
  const at = (h: number, len: number) => ({ start: `2026-10-27T${String(h).padStart(2, "0")}:00:00Z`, end: new Date(Date.parse(`2026-10-27T${String(h).padStart(2, "0")}:00:00Z`) + len * 36e5).toISOString() });
  const me = ["max mustermann"];
  assert.equal(isMeeting({ ...at(9, 0.5), organizer: "Sarah Klein", calendar: cal("Outlook") }, me), true, "set up by someone else");
  assert.equal(isMeeting({ ...at(9, 8), organizer: "Sarah Klein", calendar: cal("Outlook") }, me), false, "a day block");
  assert.equal(isMeeting({ ...at(9, 8), organizer: "max@example.com", calendar: cal("max@example.com") }, me), false, "your own Google entry (Arbeit)");
  assert.equal(isMeeting({ ...at(22, 2), organizer: "max@example.com", calendar: cal("max@example.com") }, me), false, "your own evening (Tatort)");
  assert.equal(isMeeting({ ...at(23, 3), organizer: "Sleep as Android", calendar: cal("Sleep as Android") }, me), false, "an app's own calendar");
  assert.equal(isMeeting({ ...at(12, 1), organizer: "", calendar: cal("Outlook") }, me), false, "a reminder of your own");
  assert.equal(isMeeting({ ...at(12, 1), organizer: "Sarah Klein", todoId: 4, calendar: cal("Outlook") }, me), false, "a todo planned in");
  assert.equal(isMeeting({ ...at(12, 1), organizer: "Laura", calendar: cal("Privat", true) }, me), false, "Zeff's todo calendar");
  assert.equal(isMeeting({ ...at(14, 1), organizer: "Max Mustermann", online: true, calendar: cal("Outlook") }, me), true, "your own online meeting");
  assert.equal(isMeeting({ ...at(14, 1), organizer: "Max Mustermann", calendar: cal("Outlook") }, me), false, "your own entry");

  const { getSqlite } = await import("@/db");
  getSqlite().exec("create table if not exists bank_transactions (id text primary key, account text not null, date text not null, amount real not null, currency text not null default 'EUR', text text not null default '', counterparty text not null default '', iban text not null default '', reference text not null default '', imported_at text not null, case_id integer, todo_id integer, matched_at text)");
  const ins = getSqlite().prepare("insert into bank_transactions (id, account, date, amount, text, counterparty, imported_at) values (?, 'Bank', ?, ?, ?, ?, '2026-10-01')");
  let n = 0;
  for (const month of ["2026-07", "2026-08", "2026-09"]) {
    ins.run(String(n++), `${month}-03`, -600, "Miete", "Vermieter");
    ins.run(String(n++), `${month}-05`, -300, "Um EUR Essen von EUR einzustecken", "");
    ins.run(String(n++), `${month}-20`, 250, "Um EUR Essen von EUR einzustecken", "");
    ins.run(String(n++), `${month}-10`, -500, "To Max Mustermann", "Max Mustermann");
    ins.run(String(n++), `${month}-28`, 3000, "Gehalt", "Firma");
  }
  const { monthlySpending } = await import("@/plugins/finances/metrics");
  assert.equal(monthlySpending("2026-10-15", ["Max Mustermann"]), 600, "the rent only: the pocket and your own account are money moved");
  assert.equal(monthlySpending("2026-10-15", []), 1100, "without your name the transfer to yourself counts");

  const { db } = await setup();
  const { valueUnit } = await import("@/plugins/workspace/values");
  assert.equal(valueUnit("Einkommen"), "", "a plain number column: no unit");
  const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
  const d = getDatabase(db)!;
  updateSchema(db, { ...d.schema, properties: d.schema.properties.map((p) => ({ ...p, format: "euro" as const })) });
  assert.equal(valueUnit("Einkommen"), "€", "euro columns: €");
});
