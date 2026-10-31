import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Widgets about one person: their open todos, everything about them, the promises open both ways — by the name in their
// settings, or by the person's page they stand on.
setupTempData();

test("a person's widgets: todos naming them, all about them, promises both ways — by name, or on their page by themselves", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos"]) setInstalled(p, true);
  const people = await import("@/plugins/people/store");
  const chris = people.createPerson({ name: "Chris Becker", emails: ["chris@example.com"] });
  people.setCircle(chris, "friends", "manual");
  const { addClaim } = await import("@/plugins/people/graph");
  addClaim({ personId: chris, kind: "commitment", text: "Bohrmaschine zurückgeben", direction: "mine", status: "confirmed", due: "2020-01-01" });
  addClaim({ personId: chris, kind: "commitment", text: "schickt die Fotos", direction: "theirs", status: "confirmed" });
  addClaim({ personId: chris, kind: "fact", text: "spielt Gitarre", status: "confirmed" });
  const { addAgentTodo } = await import("@/lib/todos/store");
  addAgentTodo({ ticket: "", text: "Chris wegen Umzug anrufen" });
  addAgentTodo({ ticket: "", text: "Steuer machen" });
  const { widgetData } = await import("@/plugins/workspace/widgets");

  const todos = await widgetData("people.todos", { person: "Chris" });
  assert.equal(todos.kind, "list");
  if (todos.kind !== "list") return;
  assert.deepEqual(todos.items.map((i) => i.text), ["Chris wegen Umzug anrufen"], "only what names them");

  const promises = await widgetData("people.promises", { person: "Chris Becker" });
  if (promises.kind !== "list") return assert.fail("a list");
  assert.deepEqual(promises.items.map((i) => [i.text, i.tone ?? ""]), [["Bohrmaschine zurückgeben", "bad"], ["schickt die Fotos", ""]], "past its day first, both ways");
  const theirs = await widgetData("people.promises", { person: "Chris", who: "theirs" });
  if (theirs.kind !== "list") return assert.fail("a list");
  assert.deepEqual(theirs.items.map((i) => i.text), ["schickt die Fotos"]);

  // On Chris's own page (a row of the People database: srcref person:<id>), with nothing set.
  const store = await import("@/plugins/workspace/store");
  const { newView } = await import("@/plugins/workspace/model");
  const db = store.createPage({ kind: "database", title: "People", schema: { titleName: "Name", properties: [], views: [newView("Alle", "table")] } });
  const row = store.addRow(db, { title: "Chris Becker" });
  // (the People source keeps who a row is in srcref — as its sync writes it)
  (await import("@/db")).getSqlite().prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify({ srcref: `person:${chris}` }), row);
  const overview = await widgetData("people.overview", { __page: row });
  if (overview.kind !== "list") return assert.fail("a list");
  assert.equal(overview.title, "Chris Becker");
  const all = overview.items.map((i) => `${i.text} | ${i.detail ?? ""}`).join("\n");
  for (const want of [/spielt Gitarre/, /Bohrmaschine zurückgeben \| You promised \(1\)/, /schickt die Fotos \| They promised \(1\)/, /Chris wegen Umzug anrufen \| Open todos \(1\)/, /chris@example\.com/]) assert.match(all, want);
  const nobody = await widgetData("people.todos", {});
  if (nobody.kind !== "list") return assert.fail("a list");
  assert.match(String(nobody.empty), /Name a person/);
});

test("the todos widget shows Zeff's todos — also those that are a checklist of the same page (the list goes into it there)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos"]) setInstalled(p, true);
  const people = await import("@/plugins/people/store");
  people.createPerson({ name: "Dora Klein" });
  const w = await import("@/plugins/workspace/store");
  const content = { type: "doc", content: [{ type: "taskList", attrs: { listId: "tdora", title: "", engine: true }, content: [{ type: "taskItem", attrs: { checked: false, itemId: "idora1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Dora wegen Hamburg fragen" }] }] }] }] };
  const pageId = w.createPage({ title: "Dora", content });
  (await import("@/plugins/workspace/task-lists")).syncPageLists(pageId);
  const { addAgentTodo } = await import("@/lib/todos/store");
  addAgentTodo({ ticket: "", text: "Dora das Buch zurückgeben" });
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const on = await widgetData("people.todos", { person: "Dora Klein", __page: pageId });
  assert.deepEqual(on.kind === "list" && on.items.map((i) => i.text).sort(), ["Dora das Buch zurückgeben", "Dora wegen Hamburg fragen"]);
});
