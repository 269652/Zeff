import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * An app's navigation (the documents' sidebar: inbox, all, the last 7 days, by type) can live in the Workspace tree, under its database
 * — a view's setting. The entries are counted from the rows; one is hidden and shown again, never deleted.
 */
async function seed(nav?: "workspace") {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("documents", true);
  const w = await import("@/plugins/workspace/store");
  const id = w.createPage({
    kind: "database",
    title: "Dokument-Eingang",
    schema: {
      titleName: "Document",
      dataType: "documents",
      properties: [
        { id: "docunread", name: "Unread", type: "checkbox" },
        ...["dockind", "docstatus", "docadded", "docfrom"].map((id) => ({ id, name: id, type: "text" as const })),
      ],
      views: [{ id: "v1", name: "Dokumente", type: "app", app: "documents", filter: { op: "and", rules: [] }, sorts: [], hidden: [], ...(nav ? { nav } : {}) }],
    },
  });
  const now = new Date().toISOString();
  w.addRow(id, { title: "a.pdf", cells: { docunread: true, dockind: "pdf", docstatus: "ready", docadded: now, docfrom: "x@y.de" } });
  w.addRow(id, { title: "b.png", cells: { docunread: false, dockind: "image", docstatus: "ready", docadded: "2020-01-01T00:00:00Z" } });
  return id;
}

test("a database keeps its navigation in the view until its view says otherwise", async () => {
  await seed();
  const { appNavs } = await import("@/plugins/workspace/app-nav");
  assert.deepEqual(Object.keys(await appNavs()), []);
});

test("in the tree: its entries with counts; hidden ones marked, not removed; moving it there and back", async () => {
  const id = await seed();
  const { appNavs } = await import("@/plugins/workspace/app-nav");
  const { setNavHidden, setNavPlace } = await import("@/plugins/workspace/app-nav-store");
  setNavPlace(id, "v1", "workspace");
  const nav = (await appNavs())[id];
  assert.ok(nav, "the database has a navigation in the tree");
  const by = (e: string) => nav.entries.find((x) => x.id === e)!;
  assert.equal(by("inbox").n, 1);
  assert.equal(by("all").n, 2);
  assert.equal(by("week").n, 1);
  assert.equal(by("mail").n, 1);
  assert.equal(by("kind:pdf").n, 1);
  assert.equal(by("kind:image").n, 1);
  assert.equal(nav.entries.some((x) => x.id === "kind:audio"), false, "a type without documents has no entry");
  setNavHidden(id, nav.viewId, "kind:image", true);
  assert.equal((await appNavs())[id].entries.find((x) => x.id === "kind:image")!.hidden, true);
  assert.equal((await appNavs())[id].entries.length, nav.entries.length, "hidden is not deleted");
  setNavHidden(id, nav.viewId, "kind:image", false);
  assert.equal((await appNavs())[id].entries.find((x) => x.id === "kind:image")!.hidden, false);
  setNavPlace(id, "v1", "view");
  assert.deepEqual(Object.keys(await appNavs()), [], "back in the view");
  // No sidebar at all: kept with the view, not in the tree either.
  setNavPlace(id, "v1", "off");
  const { getDatabase } = await import("@/plugins/workspace/store");
  assert.equal(getDatabase(id)!.schema.views.find((v) => v.id === "v1")!.nav, "off");
  assert.deepEqual(Object.keys(await appNavs()), []);
});

test("a view drawn from a template with a <nav>: its entries in the tree — a row's opens its page, a state's picks it in the view", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const template = [
    "<nav title=\"Journal\">",
    "<entry label=\"Alle\" icon=\"📓\" state=\"mood\" value=\"\"/>",
    "{{#each rows | sort('Date', 'desc') | limit(2)}}<entry label=\"{{ title }}\" group=\"Neueste\"/>{{/each}}",
    "</nav>",
    "<list source=\"rows\">{{ title }}</list>",
  ].join("\n");
  const id = w.createPage({
    kind: "database",
    title: "Einträge",
    schema: { titleName: "Name", properties: [{ id: "d", name: "Date", type: "date" }], views: [{ id: "v1", name: "Journal", type: "app", app: "template", template, filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] },
  });
  const rows = ["2026-10-20", "2026-10-22", "2026-10-21"].map((d) => w.addRow(id, { title: `Tag ${d}`, cells: { d } }));
  const { appNavs, hasNav } = await import("@/plugins/workspace/app-nav");
  const { setNavPlace } = await import("@/plugins/workspace/app-nav-store");
  assert.equal(await hasNav("template", template), true);
  assert.equal((await appNavs())[id], undefined, "beside the view until it says otherwise");
  setNavPlace(id, "v1", "workspace");
  const nav = (await appNavs())[id];
  assert.deepEqual(nav.entries.map((e) => [e.label, e.group ?? "", e.href ?? ""]), [
    ["Alle", "", ""],
    ["Tag 2026-10-22", "Neueste", `/workspace/${rows[1]}`],
    ["Tag 2026-10-21", "Neueste", `/workspace/${rows[2]}`],
  ]);
});
