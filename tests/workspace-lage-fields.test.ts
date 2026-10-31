import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// The Board-Lage as the Workspace's AI review: a board gets the Lage fields (attention — one of the Lage's —, lead,
// summary) and the review fills them; the cards' stripe and lead come from them. Fake Claude CLI: no cost.
setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");

const setup = async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace", "todos"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
};

test("ensureLageFields: a board gets attention, lead, summary as AI fields and the review — once, out of its views", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { ATTENTIONS } = await import("@/lib/runs/shared");
  const { ensureLageFields, LAGE_FIELDS } = await import("@/plugins/workspace/lage-fields");
  const status = m.newProperty("Status", "status");
  const dbId = w.createPage({ kind: "database", title: "Board", schema: { titleName: "Name", properties: [status], views: [{ ...m.newView("Board", "board"), groupBy: status.id }, m.newView("Table")] } });
  ensureLageFields(dbId);
  const s = w.getDatabase(dbId)!.schema;
  const att = s.properties.find((p) => p.id === LAGE_FIELDS.attention)!;
  assert.equal(att.type, "ai");
  assert.deepEqual(att.aiChoices, [...ATTENTIONS]);
  assert.ok(s.properties.some((p) => p.id === LAGE_FIELDS.lead) && s.properties.some((p) => p.id === LAGE_FIELDS.summary));
  assert.deepEqual(s.review, { on: true, skipBriefed: true, openOnly: true, recentDays: 30 }, "as the Board-Lage read: open cards moved lately");
  for (const v of s.views) assert.ok([LAGE_FIELDS.attention, LAGE_FIELDS.lead, LAGE_FIELDS.summary].every((id) => v.hidden.includes(id)), `hidden in ${v.name}: the card shows them its way`);
  ensureLageFields(dbId);
  assert.equal(w.getDatabase(dbId)!.schema.properties.filter((p) => p.id === LAGE_FIELDS.attention).length, 1, "once");
});

test("the review skips what the Ticket-Lage read; the card's stripe and lead come from the fields", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { getDb, schema } = await import("@/db");
  const { ensureLageFields, LAGE_FIELDS } = await import("@/plugins/workspace/lage-fields");
  const { reviewDatabase } = await import("@/plugins/workspace/review");
  const a = await import("@/plugins/workspace/actions");
  const status = m.newProperty("Status", "status");
  const dbId = w.createPage({ kind: "database", title: "Board 2", schema: { titleName: "Name", properties: [status, { ...m.newProperty("Key", "text"), id: "ticketkey" }], views: [{ ...m.newView("Board", "board"), groupBy: status.id }] } });
  ensureLageFields(dbId);
  const own = w.addRow(dbId, { title: "Eigene Karte" });
  const briefed = w.addRow(dbId, { title: "Gelesen", cells: { ticketkey: "PROJ-5" } });
  // The last Ticket-Lage run analyzed PROJ-5.
  getDb().insert(schema.boardRuns).values({ status: "ok", jql: "", startedAt: new Date().toISOString(), tickets: JSON.stringify([{ key: "PROJ-5", analyzed: true }]), result: JSON.stringify({ tickets: [] }) } as never).run();

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: own, values: { [LAGE_FIELDS.attention]: "blocked", [LAGE_FIELDS.lead]: "Wartet auf Antwort.", [LAGE_FIELDS.summary]: "Seit Tagen offen." } }] });
  const r = await reviewDatabase(dbId);
  assert.equal(r.reviewed, 1, "the card the Ticket-Lage read isn't reviewed again");
  assert.equal(w.getPage(briefed)!.props[LAGE_FIELDS.attention], undefined);

  const loaded = await a.loadDatabaseAction(dbId);
  assert.ok(loaded.ok);
  const key = loaded.data.extras.keys[own];
  assert.equal(loaded.data.extras.tickets[key]?.attention, "blocked", "the stripe from the field");
  assert.equal(loaded.data.extras.tickets[key]?.lead, "Wartet auf Antwort.");
  assert.equal(loaded.data.extras.tickets[key]?.summary, "Seit Tagen offen.");
});

/** The Ticket-Lage writes what it says about a ticket into the Lage fields of every row with its key — the cards read only fields. */
test("applyTicketLage: a Lage run's attention, lead, summary into the rows with the key (fields made where missing)", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { LAGE_FIELDS, applyTicketLage } = await import("@/plugins/workspace/lage-fields");
  const { startRun, finishRun } = await import("@/lib/runs/store");
  const status = m.newProperty("Status", "status");
  const board = () => ({ titleName: "Name", properties: [status, { ...m.newProperty("Key", "text"), id: "ticketkey" }], views: [{ ...m.newView("Board", "board"), groupBy: status.id }] });
  const one = w.createPage({ kind: "database", title: "Jira A", schema: board() });
  const two = w.createPage({ kind: "database", title: "Mine", schema: board() });
  const a = w.addRow(one, { title: "T", cells: { ticketkey: "PROJ-7" } });
  const b = w.addRow(two, { title: "T", cells: { ticketkey: "PROJ-7" } });
  const other = w.addRow(two, { title: "U", cells: { ticketkey: "PROJ-8" } });

  const n = applyTicketLage([{ key: "proj-7", attention: "feedback", lead: "Rückfrage an Anna offen.", summary: "Seit 03.10." }, { key: "PROJ-9", attention: "active", lead: "x", summary: "" }]);
  assert.equal(n, 2, "both rows with the key");
  for (const r of [a, b]) {
    assert.equal(w.getPage(r)!.props[LAGE_FIELDS.attention], "feedback");
    assert.equal(w.getPage(r)!.props[LAGE_FIELDS.lead], "Rückfrage an Anna offen.");
  }
  assert.equal(w.getPage(other)!.props[LAGE_FIELDS.attention], undefined);
  assert.ok(w.getDatabase(one)!.schema.properties.some((p) => p.id === LAGE_FIELDS.summary), "the fields made where missing");

  // A finished run does it on its own.
  const id = startRun("project = PROJ", null);
  finishRun(id, { status: "ok", tickets: [], result: { lede: "", tickets: [{ key: "PROJ-8", attention: "blocked", lead: "Wartet.", summary: "", happened: [], todos: [], resolved: [], flags: [] }] as never, left: [] } as never });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.getPage(other)!.props[LAGE_FIELDS.attention], "blocked");
});
