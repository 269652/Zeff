import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The Workspace widget "Correlations": pick a target (a journal's Energy), see the findings that hold in plain sentences with n and a
 * tiny chart of the two groups, each opening the explore page for its pair; too few days or nothing reliable said as such.
 */

const day = (i: number) => {
  const d = new Date();
  d.setDate(d.getDate() - i);
  return d.toLocaleDateString("sv-SE");
};

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "correlations", "calendar"]) setInstalled(id, true);
  // (ZEFF_CORRELATIONS_EXT=1: against the port — tests/correlations-ext.test.ts)
  await (await import("./correlations-port")).useCorrelationsPort();
  await import("@/plugins/contributions");
  return await import("@/plugins/workspace/widgets");
}

async function journal(title: string, days: number) {
  const store = await import("@/plugins/workspace/store");
  const { newProperty } = await import("@/plugins/workspace/model");
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const cal = zeffCalendar("Work");
  const db = store.createPage({ title, kind: "database" });
  const date = newProperty("Date", "date");
  const energy = newProperty("Energy", "number");
  store.updateSchema(db, { ...store.getDatabase(db)!.schema, properties: [date, energy] });
  for (let i = 1; i <= days; i++) {
    const meetings = (i * 7) % 6;
    if (meetings) addEvent(cal.id, { title: "Meeting", start: `${day(i)}T09:00`, end: `${day(i)}T${String(9 + meetings).padStart(2, "0")}:00` });
    store.addRow(db, { title: day(i), cells: { [date.id]: day(i), [energy.id]: Math.max(1, 5 - Math.round(meetings * 0.7) + (i % 3 === 0 ? 1 : 0)) } });
  }
  return { db, energy: `db:${db}:${energy.id}` };
}

test("the widget offers your databases' fields as targets and shows what holds — a sentence with n, two bars, a link to the pair", async () => {
  const w = await world();
  const { energy } = await journal("Journal", 40);
  const def = w.widgetCatalog().find((x) => x.id === "correlations.findings");
  assert.ok(def, "the widget is there");
  const target = def.settings.find((s) => s.key === "target")!;
  assert.ok(target.options!.some((o) => o.value === energy && o.label === "Journal › Energy"), "Journal › Energy can be picked");
  assert.ok(target.options!.some((o) => o.value === "calendar:meeting-hours"), "Zeff's own series too");

  const d = await w.widgetData("correlations.findings", { target: energy, days: 60 });
  assert.equal(d.kind, "list", JSON.stringify(d));
  if (d.kind !== "list") return;
  assert.match(d.title ?? "", /Journal › Energy · 40 days/);
  const item = d.items[0];
  assert.equal(item.text, "Meeting hours");
  assert.match(item.detail ?? "", /tends to be lower \(ρ = −0\.\d+, n = 40 days/);
  assert.equal(item.wrap, true, "the sentence is read whole");
  assert.equal(item.mini?.bars.length, 2, "the two groups' means as bars");
  assert.match(item.href ?? "", /^\/correlations\?y=db%3A\d+%3A.+&x=calendar%3Ameeting-hours&lag=0&days=60$/);
  assert.match(d.footer?.href ?? "", /^\/correlations\?y=/);
});

test("too few days: the widget says so instead of findings", async () => {
  const w = await world();
  const { energy } = await journal("Short", 6);
  const d = await w.widgetData("correlations.findings", { target: energy, days: 30 });
  assert.equal(d.kind, "list");
  if (d.kind !== "list") return;
  assert.equal(d.items.length, 0);
  assert.match(d.empty ?? "", /only 6 days/);
});
