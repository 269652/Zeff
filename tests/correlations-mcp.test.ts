import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The MCP tool `correlations`: a journal's review agent asks for its Energy by the database's and field's name and gets the computed
 * findings — with n, ρ and the groups — to quote instead of guessing; too few days, an unknown field and one pair asked for are
 * answered plainly.
 */

type Tool = (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

async function tools() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "correlations", "calendar"]) setInstalled(id, true);
  // (ZEFF_CORRELATIONS_EXT=1: against the port — tests/correlations-ext.test.ts)
  await (await import("./correlations-port")).useCorrelationsPort();
  const { registerZeffTools } = await import("@/mcp/server");
  const t: Record<string, Tool> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (t[name] = fn) } as never);
  return async (args: Record<string, unknown>) => {
    const r = await t.correlations(args);
    return { text: r.content.map((c) => c.text).join("\n"), error: !!r.isError };
  };
}

const day = (i: number) => {
  const d = new Date();
  d.setDate(d.getDate() - i);
  return d.toLocaleDateString("sv-SE");
};

async function journal(days: number) {
  const store = await import("@/plugins/workspace/store");
  const { newProperty } = await import("@/plugins/workspace/model");
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const cal = zeffCalendar("Work");
  const db = store.createPage({ title: `Journal ${days}`, kind: "database" });
  const date = newProperty("Date", "date");
  const energy = newProperty("Energy", "number");
  store.updateSchema(db, { ...store.getDatabase(db)!.schema, properties: [date, energy] });
  for (let i = 1; i <= days; i++) {
    const meetings = (i * 7) % 6; // 0 … 5 hours, spread over the days
    if (meetings) addEvent(cal.id, { title: "Meeting", start: `${day(i)}T09:00`, end: `${day(i)}T${String(9 + meetings).padStart(2, "0")}:00` });
    store.addRow(db, { title: day(i), cells: { [date.id]: day(i), [energy.id]: Math.max(1, 5 - Math.round(meetings * 0.7) + (i % 3 === 0 ? 1 : 0)) } });
  }
  return db;
}

test("the review agent asks for the journal's Energy and gets the findings with their numbers", async () => {
  const call = await tools();
  await journal(40);
  const r = await call({ database: "Journal 40", field: "Energy", days: 60 });
  assert.equal(r.error, false, r.text);
  assert.match(r.text, /Correlations of “Journal 40 › Energy”/);
  assert.match(r.text, /values on 40 days/);
  assert.match(r.text, /Rules: at least 14 days/);
  assert.match(r.text, /1\. On days with more Meeting hours, Journal 40 › Energy tends to be lower \(ρ = −0\.\d+, n = 40 days, q = [\d.]+\)\./);
  assert.match(r.text, /on days with more than [\d.]+ h Meeting hours, [\d.]+ otherwise \(\d+ vs \d+ days\)/);
  assert.match(r.text, /not causes/);
});

test("too few days, an unknown field, one pair: said plainly", async () => {
  const call = await tools();
  await journal(8);
  const few = await call({ database: "Journal 8", field: "Energy", days: 30 });
  assert.equal(few.error, false);
  assert.match(few.text, /only 8 days/);
  assert.doesNotMatch(few.text, /^1\./m, "no finding");

  const none = await call({ database: "Journal 8", field: "Mood" });
  assert.equal(none.error, true);
  assert.match(none.text, /no series “Journal 8 › Mood”/i);
  assert.match(none.text, /Journal 8 › Energy/, "it lists what there is");

  const pair = await call({ database: "Journal 40", field: "Energy", other: "Meeting hours", days: 60 });
  assert.match(pair.text, /Meeting hours and Journal 40 › Energy \(same day\): n = 40 days, ρ = −0\.\d+, r = −0\.\d+, p = [\d.]+ — a link that holds/);
  assert.match(pair.text, /Meeting hours \(the day before\) and Journal 40 › Energy: n = \d+ days/);
});
