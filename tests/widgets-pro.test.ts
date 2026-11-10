import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

const DATA = setupTempData();

/**
 * Widgets grown up: flows only as allowed, what the widgets on a page share, values published for the whole of Zeff (a Kennzahl
 * too, a view's outputs.<name>, a table poured into a database), a block's versions, packages that move widgets with their
 * databases, flows and shared values, a page saved as a plugin whose app is offered as a template.
 */

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  return { store, m };
}

test("wants and grants know flows; a flow runs only when allowed", async () => {
  const { wantsOf, missing, flowsOf } = await import("@/lib/widgets/bridge");
  assert.deepEqual(wantsOf("12", false, "Block.X.Search, bad name, block.x.search"), { writes: [12], flows: ["block.x.search"] });
  assert.deepEqual(flowsOf(["a.b", "a b", "c"]), ["a.b", "c"]);
  assert.deepEqual(missing({ writes: [], flows: ["a", "b"] }, { dbs: [], flows: ["a"] }), { writes: [], flows: ["b"] });

  await setup();
  const fstore = await import("@/plugins/workspace/flows/store");
  fstore.createFlow({ name: "calc.double", inputs: [{ name: "n", type: "number" }], nodes: [{ id: "r", kind: "return", value: "{{ input.n * 2 }}" }] });
  const { widgetCall, grantWidget, revokeWidget, widgetGrant } = await import("@/plugins/workspace/widget-bridge");
  const { widgetKey } = await import("@/lib/widgets/bridge");
  const key = widgetKey("<p>flows</p>");
  await assert.rejects(() => widgetCall(key, "flow.run", { flow: "calc.double", input: { n: 21 } }), /Not allowed: this widget may not run the flow "calc.double"/);
  grantWidget(key, { dbs: [], flows: ["calc.double"] });
  const r = (await widgetCall(key, "flow.run", { flow: "calc.double", input: { n: 21 } })) as { status: string; output: unknown };
  assert.deepEqual([r.status, r.output], ["done", 42]);
  const list = (await widgetCall(key, "flow.list", {})) as { name: string; inputs: { name: string }[] }[];
  assert.deepEqual(list.map((f) => [f.name, f.inputs.map((i) => i.name)]), [["calc.double", ["n"]]]);
  revokeWidget(key, { flow: "calc.double" });
  assert.deepEqual(widgetGrant(key)?.flows ?? [], []);
});

test("what the widgets on a page share is kept with the page", async () => {
  const { store } = await setup();
  const page = store.createPage({ title: "Lab" });
  const { pageState, setPageState } = await import("@/plugins/workspace/widget-bridge");
  setPageState(page, "selected", { id: 3, name: "Cortex" });
  setPageState(page, "n", 7);
  assert.deepEqual(pageState(page), { n: 7, selected: { id: 3, name: "Cortex" } });
  assert.equal(pageState(page, "n"), 7);
  setPageState(page, "n", null);
  assert.equal(pageState(page, "n"), null);
  assert.throws(() => setPageState(page, "big", "x".repeat(60000)), /Too much/);
});

test("published values: kinds, owners, a Kennzahl, a view's outputs, a table poured into a database", async () => {
  const { store, m } = await setup();
  const o = await import("@/plugins/workspace/widget-outputs");
  o.publishOutput("Monthly total", 1234.5, { owner: "b:aaaaaaaa1", widget: "Budget", unit: "€" });
  o.publishOutput("results", [{ title: "Run 1", Score: 0.8 }, { title: "Run 2", Score: 0.9 }], { owner: "b:aaaaaaaa1" });
  assert.equal(o.getOutput("monthly-total")?.kind, "number");
  assert.equal(o.getOutput("Results")?.kind, "table");
  assert.throws(() => o.publishOutput("Monthly total", 1, { owner: "b:other0001" }), /published by another widget/);
  // A Kennzahl — and so a formula's kennzahl().
  await import("@/plugins/workspace/server");
  const { metricValue, listMetrics } = await import("@/plugins/workspace/metrics");
  assert.equal(metricValue("Monthly total").value, 1234.5);
  assert.ok(listMetrics().some((x) => x.label === "Monthly total" && x.unit === "€"));
  // A view reads it.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { vnodeToString } = await import("@/plugins/workspace/card-template");
  const r = renderView('{{ outputs.monthly_total }} / {{ [outputs.Monthly total] }} <datatable source="outputs.results"><column label="T">{{ title }}</column></datatable>', { rows: [], props: [], titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" }, outputs: o.outputsByKey() });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /1234\.5 \/ 1234\.5/);
  assert.match(vnodeToString(r.nodes), /Run 1.*Run 2/);
  // Poured into a database over the MCP.
  const db = store.createPage({ kind: "database", title: "Runs", schema: { titleName: "Name", properties: [{ id: "sc", name: "Score", type: "number" }], views: [m.newView("Table")] } });
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const { registerWorkspaceTools } = await import("@/plugins/workspace/mcp");
  const ok = (text: string) => ({ content: [{ type: "text", text }] });
  const fail = (text: string) => ({ content: [{ type: "text", text }], isError: true });
  registerWorkspaceTools({ registerTool: (n: string, _d: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(n, h) } as never, { run: async (fn: () => unknown) => fn(), ok, fail } as never);
  const res = (await handlers.get("workspace_output_to_database")!({ name: "results", database: db }, {})) as { content: { text: string }[]; isError?: boolean };
  assert.ok(!res.isError, res.content[0].text);
  assert.deepEqual(store.rawRows(db).map((x) => [x.title, x.cells.sc]), [["Run 1", 0.8], ["Run 2", 0.9]]);
  const listed = (await handlers.get("workspace_widget_outputs")!({}, {})) as { content: { text: string }[] };
  assert.match(listed.content[0].text, /monthly-total.*number \(€\), from „Budget“/);
});

test("a block's versions: kept, the same code not twice, the requests so far", async () => {
  await setup();
  const v = await import("@/plugins/workspace/widget-versions");
  const wid = v.newWid();
  assert.ok(v.isWid(wid));
  v.addVersion(wid, { source: "first", html: "<p>1</p>", title: "A" });
  v.addVersion(wid, { source: "ai", prompt: "make it blue", html: "<p>2</p>", title: "A" });
  v.addVersion(wid, { source: "ai", prompt: "again", html: "<p>2</p>", title: "A" });
  v.addVersion(wid, { source: "fix", prompt: "TypeError x", html: "<p>3</p>", title: "A" });
  assert.deepEqual(v.listVersions(wid).map((x) => [x.n, x.source]), [[3, "fix"], [2, "ai"], [1, "first"]]);
  assert.equal(v.getVersion(wid, 2)?.html, "<p>2</p>");
  assert.deepEqual(v.requestsSoFar(wid), ["make it blue", "(fix) TypeError x"]);
});

test("a package moves a page's widgets with its databases, flows and shared values; a copy gets versions of its own", async () => {
  const { store, m } = await setup();
  const app = store.createPage({ title: "Contacts app" });
  const db = store.createPage({ kind: "database", parentId: app, title: "Contacts", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  const outside = store.createPage({ kind: "database", title: "Elsewhere", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  const html = `<div id="f"></div><script>ZeffKit.form("#f", { db: ${db} }); zeff.db.rows(${db}); zeff.db.rows(${outside});</script>`;
  store.updatePage(app, { content: { type: "doc", content: [{ type: "zeffApp", attrs: { title: "Form", prompt: "", html, libs: "", writes: `${db},${outside}`, ai: false, flows: "contacts.enrich", wid: "abcdefgh1234", state: "" } }] } });
  const fstore = await import("@/plugins/workspace/flows/store");
  fstore.createFlow({ name: "contacts.enrich", nodes: [{ id: "r", kind: "return", value: "ok" }], permissions: { web: ["example.org"] } }, app);
  const { setPageState, pageState } = await import("@/plugins/workspace/widget-bridge");
  setPageState(app, "filter", "A");
  const { exportPackage, installPackage } = await import("@/plugins/workspace/packages");
  const pkg = exportPackage(app, { name: "Contacts app" });
  const appItem = pkg.items.find((i) => i.title === "Contacts app")!;
  const w = appItem.content!.content![0].attrs as Record<string, string>;
  assert.match(w.html, /db: __zeffdb_i\d+__/, "a database of the package as a placeholder");
  assert.match(w.html, new RegExp(`zeff\\.db\\.rows\\(${outside}\\)`), "one outside it as it was");
  assert.equal(w.wid, "");
  assert.deepEqual(appItem.widgetState, { filter: "A" });
  assert.ok(pkg.items.some((i) => (i.flow as { name?: string } | undefined)?.name === "contacts.enrich"));
  // Installed elsewhere — after the original flow is gone (its name free again).
  fstore.deleteFlow(fstore.flowByName("contacts.enrich")!.pageId);
  const { rootId, ids } = installPackage(pkg, null);
  const newDb = ids.find((id) => store.getPage(id)?.kind === "database")!;
  const node = store.getPage(rootId)!.content.content[0];
  assert.equal(node.type, "zeffApp");
  const a = node.attrs as Record<string, string>;
  assert.match(a.html, new RegExp(`db: ${newDb}\\b`));
  assert.match(a.html, new RegExp(`zeff\\.db\\.rows\\(${newDb}\\)`));
  assert.equal(a.writes, String(newDb), "writes: the new database; the one outside left out");
  assert.deepEqual(pageState(rootId), { filter: "A" });
  const f = fstore.flowByName("contacts.enrich")!;
  assert.ok(f && ids.includes(f.pageId), "the flow came along");
  assert.deepEqual(f.permissions, {}, "its permissions granted again by whoever installs it");
  // A copy of a page: its widget's versions start anew.
  const copy = store.duplicatePage(app);
  assert.equal((store.getPage(copy)!.content.content[0].attrs as Record<string, string>).wid, "");
});

test("a page saved as a plugin: its app offered as a template while the plugin is on", async () => {
  const { store } = await setup();
  process.env.ZEFF_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
  const page = store.createPage({ title: "Brain Lab", icon: "🧠" });
  store.updatePage(page, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] } });
  const { savePageAsPluginAction } = await import("@/plugins/workspace/actions");
  const r = await savePageAsPluginAction(page);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.ok && r.id, "app-brain-lab");
  const again = await savePageAsPluginAction(page);
  assert.equal(again.ok && again.version, "1.0.1");
  const { scanPlugins, setEnabled } = await import("@/lib/ext/registry");
  const found = scanPlugins(true);
  assert.deepEqual(found.problems, []);
  assert.deepEqual(found.plugins[0].manifest.contributes.workspacePackages, ["app.json"]);
  await import("@/plugins/workspace/server");
  const { listPackages } = await import("@/plugins/workspace/packages");
  assert.ok(!listPackages().some((p) => p.name === "Brain Lab"), "off: not offered");
  setEnabled("app-brain-lab", true);
  assert.ok(listPackages().some((p) => p.name === "Brain Lab" && p.icon === "🧠"), "on: under New → templates");
  void DATA;
});
