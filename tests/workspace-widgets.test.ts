import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Widgets: a block of a page (or the dashboard) that a plugin supplies — live data you would otherwise open another app for, with an
 * action right there. A plugin gives its widgets a name, a few settings and a function for the data; the Workspace draws them all alike
 * (a list, or a figure) and keeps the data a moment. Only what shows live data with a way to act is worth one.
 */
async function on() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return await import("@/plugins/workspace/widgets");
}

test("the registry: the widgets of the installed plugins, each with what it is and what it can be set to", async () => {
  const x = await on();
  const { workspaceWidgets } = await import("@/plugins/workspace/widget-point");
  let calls = 0;
  workspaceWidgets.contribute("todos", [
    {
      id: "test.list",
      label: "Test list",
      icon: "🧪",
      description: "A list for the tests.",
      settings: [
        { key: "limit", label: "How many", kind: "number", default: 3, min: 1, max: 10 },
        { key: "mode", label: "Mode", kind: "select", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
      ],
      ttl: 60,
      data: (config) => {
        calls++;
        return { kind: "list", items: Array.from({ length: Number(config.limit) }, (_, i) => ({ id: String(i), text: `Eintrag ${i + 1} (${config.mode})`, actions: [{ id: "done", label: "Done" }] })) };
      },
      act: async (action, payload) => {
        if (action !== "done") throw new Error("unknown action");
        return { kind: "list", items: [{ id: payload.id, text: "erledigt", done: true }] };
      },
    },
  ]);
  const list = x.widgetCatalog();
  assert.ok(list.some((w) => w.id === "test.list" && w.label === "Test list" && w.plugin === "todos"));
  assert.deepEqual(x.widgetCatalog().find((w) => w.id === "test.list")!.settings.map((s) => s.key), ["limit", "mode"]);

  // the data: settings checked against their definition, kept for its ttl
  const d1 = await x.widgetData("test.list", { limit: "99", mode: "zzz" });
  assert.equal(d1.kind, "list");
  assert.equal(d1.kind === "list" ? d1.items.length : 0, 10, "a number is held to its range");
  assert.match(d1.kind === "list" ? d1.items[0].text : "", /\(a\)/, "a choice that is none is the default");
  await x.widgetData("test.list", { limit: "99", mode: "zzz" });
  assert.equal(calls, 1, "the same data twice within its ttl: computed once");
  await x.widgetData("test.list", { limit: "2" });
  assert.equal(calls, 2, "other settings, other data");
  await assert.rejects(() => x.widgetData("gibt.es.nicht", {}), /no such widget/i);
});

test("an action on a widget: the plugin's act runs, the data of the widget is read again afterwards — an unknown action is refused", async () => {
  const x = await on();
  const done = await x.widgetAct("test.list", "done", { id: "7" }, { limit: "2" });
  assert.equal(done.kind === "list" ? done.items[0].text : "", "erledigt");
  await assert.rejects(() => x.widgetAct("test.list", "explode", {}, {}), /unknown action/i);
  const { workspaceWidgets } = await import("@/plugins/workspace/widget-point");
  workspaceWidgets.contribute("todos", [{ id: "test.static", label: "Static", icon: "📌", description: "no actions", data: () => ({ kind: "figure", value: "42", caption: "answers" }) }]);
  await assert.rejects(() => x.widgetAct("test.static", "x", {}, {}), /no actions|unknown action/i);
});

test("a widget that fails does not break the page: its data is an error line", async () => {
  const x = await on();
  const { workspaceWidgets } = await import("@/plugins/workspace/widget-point");
  workspaceWidgets.contribute("todos", [{ id: "test.broken", label: "Broken", icon: "💥", description: "fails", data: () => { throw new Error("die Quelle antwortet nicht"); } }]);
  const d = await x.widgetData("test.broken", {});
  assert.equal(d.kind, "error");
  assert.match(d.kind === "error" ? d.message : "", /antwortet nicht/);
});

test("the widget block in a page: its widget and its settings kept; what is not a widget block or has no widget is dropped", async () => {
  const { sanitizeDoc } = await import("@/plugins/workspace/doc");
  const doc = sanitizeDoc({
    type: "doc",
    content: [
      { type: "zeffWidget", attrs: { widget: "news.top", config: '{"limit":5}', evil: 1 } },
      { type: "zeffWidget", attrs: { widget: "", config: "{}" } },
      { type: "zeffWidget", attrs: { widget: "x.y", config: "not json" } },
    ],
  }) as { content: { type: string; attrs: Record<string, unknown> }[] };
  assert.deepEqual(doc.content.map((n) => n.attrs.widget), ["news.top", "x.y"], "one without a widget is dropped");
  assert.deepEqual(doc.content[0].attrs, { widget: "news.top", config: '{"limit":5}', title: "" });
  assert.equal(doc.content[1].attrs.config, "{}", "a config that is no JSON object is an empty one");
});

test("the Dashboard template: a page of widget blocks in flex boxes — only the widgets of installed plugins", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos", "people", "news", "outlook-mail", "mail-client"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  assert.ok(templateMetas().some((m) => m.key === "dashboard" && m.kind === "page"));
  const id = fromTemplate("dashboard", null);
  const text = JSON.stringify(w.getPage(id)!.content);
  for (const widget of ["mail.unread", "people.upcoming", "news.top", "work.runs", "workspace.routines"]) assert.ok(text.includes(`"${widget}"`), `${widget} is on the dashboard`);
  assert.ok(text.includes('"flexBox"'), "laid out in boxes");
  setInstalled("news", false);
  const without = JSON.stringify(w.getPage(fromTemplate("dashboard", null))!.content);
  assert.ok(!without.includes('"news.top"'), "a plugin that is off has no widget on it");
  setInstalled("news", true);
});
