import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Tool = (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

async function tools() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { registerZeffTools } = await import("@/mcp/server");
  const t: Record<string, Tool> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (t[name] = fn) } as never);
  const text = async (name: string, args: Record<string, unknown>) => {
    const r = await t[name](args);
    return { text: r.content.map((c) => c.text).join("\n"), error: !!r.isError };
  };
  return { t, text };
}

test("agents write and read the workspace: pages by Markdown, search, append — and what they write is found by everyone", async () => {
  const { text } = await tools();
  const made = await text("workspace_create_page", { title: "Release 5.2 decisions", markdown: "## Decided\n\n- Ship on Thursday\n- [ ] Tell Anna\n\n| who | what |\n| --- | --- |\n| Rico | tests |\n" });
  assert.equal(made.error, false);
  const id = /page (\d+)/.exec(made.text)![1];
  const read = await text("workspace_read_page", { page: Number(id) });
  assert.match(read.text, /# Release 5\.2 decisions/);
  assert.match(read.text, /- Ship on Thursday/);
  assert.match(read.text, /- \[ \] Tell Anna/);
  assert.match(read.text, /\| who \| what \|/);
  // By its title, too.
  assert.match((await text("workspace_read_page", { page: "release 5.2" })).text, /Ship on Thursday/);
  await text("workspace_append", { page: id, markdown: "Update: moved to Friday." });
  assert.match((await text("workspace_read_page", { page: id })).text, /Update: moved to Friday\./);
  assert.match((await text("workspace_read_page", { page: id })).text, /Ship on Thursday/, "the old text stays");
  const found = await text("workspace_search", { query: "Thursday" });
  assert.match(found.text, new RegExp(`\\[${id}\\]`));
  assert.match((await text("workspace_search", { query: "Kubernetes Zertifikat" })).text, /Nothing found/);
  assert.equal((await text("workspace_read_page", { page: "no such page anywhere" })).error, true);

  // A locked page is the user's: agents leave it alone.
  const store = await import("@/plugins/workspace/store");
  store.updatePage(Number(id), { locked: true });
  assert.equal((await text("workspace_append", { page: id, markdown: "nope" })).error, true);

  // The search of everything Zeff keeps finds pages too.
  const { retrieve } = await import("@/lib/rag");
  const r = await retrieve([{ query: "Thursday decided", where: ["pages"] }]);
  assert.match(r.text, new RegExp(`\\[page:${id}\\]`));
});

test("agents work with databases: rows by property names — options made on the way, computed ones refused", async () => {
  const { text } = await tools();
  const store = await import("@/plugins/workspace/store");
  const { newProperty } = await import("@/plugins/workspace/model");
  const db = store.createPage({ title: "Bugs", kind: "database" });
  const sev = { ...newProperty("Severity", "select"), options: [{ id: "s1", name: "High", color: "red" }] };
  const eff = newProperty("Hours", "number");
  const cost = { ...newProperty("Cost", "formula"), formula: 'prop("Hours") * 80' };
  store.updateSchema(db, { ...store.getDatabase(db)!.schema, properties: [sev, eff, cost] });
  const added = await text("workspace_add_row", { database: "Bugs", title: "Login fails", values: { severity: "High", Hours: 2, Cost: 5, Nope: 1 }, markdown: "Steps: open the page." });
  assert.equal(added.error, false);
  assert.match(added.text, /ignored: "Cost" is computed; no property "Nope"/);
  await text("workspace_add_row", { database: db, title: "Typo", values: { Severity: "Low", Hours: "1,5" } });
  const q = await text("workspace_query_database", { database: "Bugs" });
  assert.match(q.text, /2 rows/);
  assert.match(q.text, /Login fails \| High \| 2 \| 160/);
  assert.match(q.text, /Typo \| Low \| 1\.5 \| 120/, "a new option was made, the text number fitted, the formula computed");
  assert.match((await text("workspace_query_database", { database: "Bugs", contains: "login" })).text, /1 rows|— 1 rows/);
  const sorted = await text("workspace_query_database", { database: "Bugs", sortBy: "Hours", descending: true });
  assert.ok(sorted.text.indexOf("Login fails") < sorted.text.indexOf("Typo"));
  // A row is a page: its body is there.
  const rowId = /\[(\d+)\] Login fails/.exec(q.text)![1];
  assert.match((await text("workspace_read_page", { page: rowId })).text, /Steps: open the page\./);
});

test("today's page: made once under Daily notes, with the todos that are due as links", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("todos", true);
  const { addManualTodo, listTodos } = await import("@/lib/todos/store");
  const { getDb, schema } = await import("@/db");
  const todo = addManualTodo({ ticket: "", text: "Call the printer" });
  getDb().update(schema.todos).set({ due: "2020-01-01" } as never).run();
  assert.ok(listTodos({ status: "open" }).length >= 1);
  const { todayPageAction } = await import("@/plugins/workspace/actions");
  const first = await todayPageAction();
  const second = await todayPageAction();
  assert.equal(first.ok && second.ok && first.id === second.id, true, "the same page the second time");
  const store = await import("@/plugins/workspace/store");
  const page = store.getPage((first as { id: number }).id)!;
  assert.match(page.title, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(store.breadcrumbs(page.id).map((c) => c.title).join(), "Daily notes");
  assert.match(JSON.stringify(page.content), /"kind":"todo"/);
  assert.deepEqual(store.pagesMentioning("todo", todo.id).map((p) => p.id), [page.id]);
});
