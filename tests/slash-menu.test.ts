import assert from "node:assert/strict";
import test from "node:test";

test("slash menu: a bare slash lists the main items, a picker its own, and a search finds every item (the ones in pickers too)", async () => {
  const { slashItems, filterItems } = await import("@/plugins/workspace/ui/slash");
  const t = ((s: string) => s) as Parameters<typeof slashItems>[0];
  const widget = { key: "widget:people.todos", title: "Todos with a person", hint: "Open todos that name someone", icon: "☑", group: "Widgets", under: "widget", keywords: ["widget", "people", "todos", "todos", "with", "person"], run: () => {} };
  const all = [...slashItems(t), widget];
  const top = filterItems(all, "");
  assert.ok(top.length <= 40, `the bare menu has ${top.length} items`);
  assert.ok(!top.some((i) => i.under), "nothing of a picker in the bare menu");
  // Nothing is out of reach: each item is in the bare menu or in a picker the bare menu has.
  const pickers = new Set(top.filter((i) => i.opens).map((i) => i.opens));
  for (const i of all) assert.ok(!i.under || pickers.has(i.under) || i.under === "ai" || i.under === "formula", `${i.key} is reachable`);
  for (const i of all) assert.ok(filterItems(all, i.title.toLowerCase().replace(/ …$/, "")).includes(i), `a search for "${i.title}" finds it`);
  assert.equal(filterItems(all, "ticket ").length, 11, "the ticket picker has the 11 modules");
  assert.deepEqual(filterItems(all, "ticket chat").map((i) => i.key), ["module-chat"]);
  assert.deepEqual(filterItems(all, "embed ").map((i) => i.key).sort(), ["embed", "linked-db", "subpage-inline", "todo-embed"]);
  assert.ok(filterItems(all, "widget ").includes(widget), "the widget picker has the widgets");
  assert.ok(filterItems(all, "todos").includes(widget), "/todos still finds the widget");
  assert.equal(top.filter((i) => i.key.startsWith("ai")).length, 1, "one AI item");
  assert.equal(top.filter((i) => i.key.startsWith("formula")).length, 1, "one formula item");
});
