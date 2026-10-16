import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * A database opens to receive tickets: its landing column is set. A row sent from another database (a board, a derived one,
 * a locked synced one) arrives there, linked: what the source changes the copy follows (its title, the fields of the same
 * name, its text while the copy's text is untouched) — never the copy's own column. Unlinked, it is a plain copy.
 */
setupTempData();

const text = (p: { content: unknown }) => JSON.stringify(p.content);

async function boards() {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const status = (id: string): import("@/plugins/workspace/model").Property => ({
    id,
    name: "Status",
    type: "status",
    options: [
      { id: "o_in", name: "Eingang", color: "gray", group: "todo" },
      { id: "o_go", name: "Läuft", color: "blue", group: "doing" },
      { id: "o_ok", name: "Fertig", color: "green", group: "done" },
    ],
  });
  const lage = w.createPage({
    kind: "database",
    title: "Lage",
    schema: {
      titleName: "Ticket",
      properties: [{ ...status("p_st"), options: [{ id: "s_a", name: "Neu", color: "gray", group: "todo" }, { id: "s_b", name: "In Umsetzung", color: "blue", group: "doing" }] }, { id: "p_lead", name: "Lage", type: "text" }, { id: "p_prio", name: "Priorität", type: "number" }],
      views: [m.newView("Table")],
    },
  });
  const agents = w.createPage({
    kind: "database",
    title: "Aufträge",
    schema: { titleName: "Auftrag", properties: [status("a_st"), { id: "a_lead", name: "Lage", type: "text" }, { id: "a_own", name: "Eigenes", type: "text" }], views: [m.newView("Board")], receive: { prop: "a_st", value: "o_in" } },
  });
  return { w, m, lage, agents };
}

test("send a row to a receiving database: it lands in the landing column, linked, with title and same-named fields", async () => {
  const { w, lage, agents } = await boards();
  const { sendRow, linkOf } = await import("@/plugins/workspace/links");
  const t = w.addRow(lage, { title: "PROJ-501 Footer", cells: { p_st: "s_b", p_lead: "Wartet auf Freigabe", p_prio: 2 } });
  const r = sendRow(t, agents);
  assert.equal(r.existing, false);
  const copy = w.getPage(r.row)!;
  assert.equal(copy.dbId, agents);
  assert.equal(copy.title, "PROJ-501 Footer");
  assert.equal(copy.props.a_st, "o_in", "in the column incoming rows land in — not the source's own status");
  assert.equal(copy.props.a_lead, "Wartet auf Freigabe", "the field of the same name");
  assert.equal(copy.props.a_own, undefined);
  assert.deepEqual(linkOf(r.row), { source: t, sourceTitle: "PROJ-501 Footer", sourceDb: "Lage" });

  const again = sendRow(t, agents);
  assert.deepEqual([again.existing, again.row], [true, r.row], "sent once: the same copy");
  assert.equal(w.rawRows(agents).length, 1);
});

test("a database that doesn't receive can't be sent to", async () => {
  const { w, lage } = await boards();
  const { sendRow, receivingDatabases } = await import("@/plugins/workspace/links");
  const t = w.addRow(lage, { title: "X" });
  assert.throws(() => sendRow(t, lage), /doesn't receive|empfängt/i);
  assert.ok(!receivingDatabases().some((d) => d.id === lage), "not offered either");
});

test("the source changes, the copy follows — its own column and what it has itself stay", async () => {
  const { w, lage, agents } = await boards();
  const { sendRow } = await import("@/plugins/workspace/links");
  const t = w.addRow(lage, { title: "PROJ-502", cells: { p_lead: "alt" } });
  w.updatePage(t, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Beschreibung eins" }] }] } });
  const { row } = sendRow(t, agents);
  w.setCell(row, "a_own", "meine Notiz");
  w.setCell(row, "a_st", "o_go"); // moved on its board

  w.setCell(t, "p_lead", "neu");
  w.setCell(t, "p_st", "s_a"); // the source's own status: not for the copy
  w.updatePage(t, { title: "PROJ-502 umbenannt" });
  const copy = w.getPage(row)!;
  assert.equal(copy.title, "PROJ-502 umbenannt");
  assert.equal(copy.props.a_lead, "neu", "the field follows");
  assert.equal(copy.props.a_own, "meine Notiz", "its own field untouched");
  assert.equal(copy.props.a_st, "o_go", "the copy's column is its own: the source's status doesn't move it");

  // The text follows while the copy's text is as it was sent …
  w.updatePage(t, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Beschreibung zwei" }] }] } });
  assert.match(text(w.getPage(row)!), /Beschreibung zwei/);
  // … not once the copy has been written in.
  w.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Meine Ergänzung" }] }] } });
  w.updatePage(t, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Beschreibung drei" }] }] } });
  assert.match(text(w.getPage(row)!), /Meine Ergänzung/, "the copy's own text isn't overwritten");
  w.setCell(t, "p_lead", "noch neuer");
  assert.equal(w.getPage(row)!.props.a_lead, "noch neuer", "its fields keep following");
});

test("unlinked, the copy is a plain row: the source's changes don't reach it any more", async () => {
  const { w, lage, agents } = await boards();
  const { sendRow, linkOf, unlink } = await import("@/plugins/workspace/links");
  const t = w.addRow(lage, { title: "PROJ-503", cells: { p_lead: "eins" } });
  const { row } = sendRow(t, agents);
  assert.equal(unlink(row), true);
  assert.equal(linkOf(row), null);
  w.setCell(t, "p_lead", "zwei");
  assert.equal(w.getPage(row)!.props.a_lead, "eins", "a copy now");
  assert.equal(unlink(row), false, "nothing left to unlink");
  // It can be sent again (a new copy).
  assert.notEqual(sendRow(t, agents).row, row);
});

test("the receiving setting is kept only for a column that exists", async () => {
  const m = await import("@/plugins/workspace/model");
  const props = [{ id: "st", name: "Status", type: "status" as const, options: [{ id: "o1", name: "Eingang", color: "gray", group: "todo" as const }] }];
  assert.deepEqual(m.normalizeSchema({ titleName: "N", properties: props, views: [], receive: { prop: "st", value: "o1" } }).receive, { prop: "st", value: "o1" });
  assert.equal(m.normalizeSchema({ titleName: "N", properties: props, views: [], receive: { prop: "st", value: "gone" } }).receive, undefined, "no such column");
  assert.equal(m.normalizeSchema({ titleName: "N", properties: props, views: [], receive: { prop: "nope", value: "o1" } }).receive, undefined, "no such property");
});

test("a copy carries the original's ticket key (so the Lage, todos and context of that ticket show), and follows it", async () => {
  const { w, m, agents } = await boards();
  const { sendRow } = await import("@/plugins/workspace/links");
  const { rowKey } = await import("@/plugins/workspace/collections");
  const lage = w.createPage({
    kind: "database",
    title: "Lage mit Key",
    schema: { titleName: "Ticket", properties: [{ id: "ticketkey", name: "Key", type: "text" }], views: [m.newView("Table")] },
  });
  const t = w.addRow(lage, { title: "Kategoriebäume", cells: { ticketkey: "proj-777" } });
  const { row } = sendRow(t, agents);
  const target = w.getDatabase(agents)!.schema.properties.find((p) => p.id === "ticketkey");
  assert.ok(target, "the receiving database got a Key property for it");
  assert.equal(rowKey({ id: row, cells: w.getPage(row)!.props }), "PROJ-777", "the copy is the ticket now, not WS-<id>");
  w.setCell(t, "ticketkey", "PROJ-778");
  assert.equal(rowKey({ id: row, cells: w.getPage(row)!.props }), "PROJ-778", "and follows a changed key");
});

test("linkedSource: what the original says — its board, its fields, its key — for the copy's detail view", async () => {
  const { w, m, agents } = await boards();
  const { sendRow, linkedSource } = await import("@/plugins/workspace/links");
  const lage = w.createPage({
    kind: "database",
    title: "Lage 2",
    schema: { titleName: "Ticket", properties: [{ id: "ticketkey", name: "Key", type: "text" }, { id: "p_lead", name: "Lage", type: "text" }, { id: "p_x", name: "Nur dort", type: "text" }, { id: "srcref", name: "Source", type: "text" }], views: [m.newView("Table")] },
  });
  const t = w.addRow(lage, { title: "Footer", cells: { ticketkey: "PROJ-9", p_lead: "Wartet", p_x: "Nur im Original", srcref: "PROJ-9" } });
  const { row } = sendRow(t, agents);
  const s = linkedSource(row)!;
  assert.equal(s.sourceId, t);
  assert.equal(s.sourceDb, "Lage 2");
  assert.equal(s.sourceDbId, lage);
  assert.equal(s.key, "PROJ-9");
  assert.deepEqual(s.fields.map((f) => [f.name, f.text]), [["Lage", "Wartet"], ["Nur dort", "Nur im Original"]], "its fields, also those the copy has no property for; not the system ones");
  assert.equal(linkedSource(t), null, "a row that isn't a copy");
});

test("a receiving database's detail view shows the linked ticket, then what Zeff knows of it", async () => {
  const { agents, w } = await boards();
  const { detailModules } = await import("@/plugins/workspace/model");
  const d = w.getDatabase(agents)!;
  const mods = detailModules(d.schema, null);
  assert.deepEqual(mods.slice(0, 2), ["properties", "source"]);
  for (const x of ["briefing", "todos", "context", "page"]) assert.ok(mods.includes(x as never), x);
  assert.ok(!detailModules({ ...d.schema, receive: undefined }, null).includes("source" as never), "a database that doesn't receive: no such module");
});
