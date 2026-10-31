import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * A person's page starts with a good layout: a short intro line, then their todos, what is coming up, the facts and your rhythm
 * — only on a page with nothing of its own (never over what is written). An existing page that is (nearly) empty gets it on a
 * click. And one form per thing: "All about a person" leaves out what the detail widgets on the same page show already.
 */
setupTempData();

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const widget = (id: string, config: Record<string, unknown> = {}) => ({ type: "zeffWidget", attrs: { widget: id, config: JSON.stringify(config), title: "", header: "" } });

async function peopleDb() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos"]) setInstalled(p, true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const db = w.createPage({ kind: "database", title: "People", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], dataType: "people" } });
  return { w, db };
}

const widgetsOf = (doc: { content?: { type: string; attrs?: Record<string, unknown> }[] }) => (doc.content ?? []).filter((n) => n.type === "zeffWidget").map((n) => [n.attrs?.widget, n.attrs?.header]);

test("a new person's page starts with the default layout — only when it has nothing of its own", async () => {
  const { w, db } = await peopleDb();
  const { ensureRowView } = await import("@/plugins/workspace/row-views");
  const ada = w.addRow(db, { title: "Ada" });
  assert.equal(ensureRowView(ada), true);
  const doc = w.getPage(ada)!.content as never as { content: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[] };
  assert.equal(doc.content[0].type, "rowView", "the view first");
  assert.equal(doc.content[1].type, "paragraph");
  assert.ok(doc.content[1].content?.length, "a short intro line");
  assert.deepEqual(widgetsOf(doc), [["people.todos", "hide"], ["people.coming", "hide"], ["people.facts", "hide"], ["people.rhythm", "hide"]], "the person widgets, each without header");
  for (const n of doc.content.filter((n) => n.type === "zeffWidget")) assert.equal(n.attrs?.config, "{}", "they take the page's person by themselves");

  // A page with text of its own: the view, the text — no layout over it.
  const bob = w.addRow(db, { title: "Bob" });
  w.updatePage(bob, { content: { type: "doc", content: [para("Meine Notiz zu Bob")] } });
  assert.equal(ensureRowView(bob), true);
  assert.deepEqual((w.getPage(bob)!.content.content ?? []).map((n) => n.type), ["rowView", "paragraph"], "his text kept, nothing added");

  // Not for a database without a person view.
  const m = await import("@/plugins/workspace/model");
  const other = w.createPage({ kind: "database", title: "Aufgaben", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  const task = w.addRow(other, { title: "T" });
  assert.equal(ensureRowView(task), false);
  assert.deepEqual(widgetsOf(w.getPage(task)!.content as never), []);
});

test("Use the default layout: on an existing person page that is (nearly) empty, its own lines kept — not on one with more", async () => {
  const { w, db } = await peopleDb();
  const { applyRowLayout, rowLayoutFits } = await import("@/plugins/workspace/row-views");
  // A page made before the layout existed: just the view block and a short line.
  const cleo = w.addRow(db, { title: "Cleo" });
  w.updatePage(cleo, { content: { type: "doc", content: [{ type: "rowView" }, para("Kollegin")] } });
  assert.equal(rowLayoutFits(cleo), true);
  assert.equal(applyRowLayout(cleo), true);
  const doc = w.getPage(cleo)!.content as never as { content: { type: string }[] };
  assert.equal(doc.content[0].type, "rowView");
  assert.deepEqual(widgetsOf(doc).map(([id]) => id), ["people.todos", "people.coming", "people.facts", "people.rhythm"]);
  assert.match((await import("@/plugins/workspace/doc")).docText(doc as never), /Kollegin/, "her line kept");
  assert.equal(rowLayoutFits(cleo), false, "it has widgets now");
  assert.equal(applyRowLayout(cleo), false, "not twice");

  // A page with a widget of its own, or with much text: no.
  const dan = w.addRow(db, { title: "Dan" });
  w.updatePage(dan, { content: { type: "doc", content: [{ type: "rowView" }, widget("people.news")] } });
  assert.equal(rowLayoutFits(dan), false);
  const eve = w.addRow(db, { title: "Eve" });
  w.updatePage(eve, { content: { type: "doc", content: [{ type: "rowView" }, para("x".repeat(400))] } });
  assert.equal(rowLayoutFits(eve), false);
  assert.equal(applyRowLayout(eve), false);
  assert.deepEqual(widgetsOf(w.getPage(eve)!.content as never), [], "nothing written");
});

test("All about a person leaves out what the detail widgets on the same page show (about the same person)", async () => {
  const { w, db } = await peopleDb();
  const people = await import("@/plugins/people/store");
  const fritz = people.createPerson({ name: "Fritz Vogel", emails: ["fritz@example.com"] });
  const other = people.createPerson({ name: "Gerda Huhn" });
  const { addClaim } = await import("@/plugins/people/graph");
  addClaim({ personId: fritz, kind: "commitment", text: "Leiter zurückbringen", direction: "mine", status: "confirmed" });
  addClaim({ personId: fritz, kind: "fact", text: "segelt gern", status: "confirmed" });
  const { addAgentTodo } = await import("@/lib/todos/store");
  addAgentTodo({ ticket: "", text: "Fritz Vogel wegen Garten fragen" });
  const row = w.addRow(db, { title: "Fritz Vogel" });
  (await import("@/db")).getSqlite().prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify({ srcref: `person:${fritz}` }), row);
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const shown = async () => {
    const d = await widgetData("people.overview", { __page: row });
    if (d.kind !== "list") return assert.fail("a list");
    return d.items.map((i) => `${i.text} | ${i.detail ?? ""}`).join("\n");
  };
  const set = (content: unknown[]) => w.updatePage(row, { content: { type: "doc", content: [widget("people.overview"), ...content] } as never });

  set([]);
  for (const want of [/segelt gern/, /Leiter zurückbringen/, /Garten fragen/, /fritz@example\.com/]) assert.match(await shown(), want, "alone on the page: all of it");

  // The detail widgets on the page (one in a column): their sections go from the overview.
  set([{ type: "flexBox", attrs: { dir: "row", gap: "lg" }, content: [{ type: "flexBox", attrs: { dir: "col", gap: "md", span: null }, content: [widget("people.todos")] }] }, widget("people.facts"), widget("people.promises")]);
  const all = await shown();
  for (const gone of [/segelt gern/, /Leiter zurückbringen/, /Garten fragen/]) assert.doesNotMatch(all, gone);
  assert.match(all, /fritz@example\.com/, "what no widget shows stays");

  // A detail widget about someone else doesn't count.
  set([widget("people.todos", { person: "Gerda Huhn", personId: other })]);
  assert.match(await shown(), /Garten fragen/);
});
