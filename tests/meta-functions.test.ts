import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { setupTempData } from "./helpers";

// The meta API (code makes and changes Zeff's structure, each kind behind a permission) in its three ways in — Notebook cells, widgets,
// flows — and the server functions of external plugins. Python runs on this computer here (ZNB_TEST_MODE=docker: in containers).
setupTempData();
process.env.ZEFF_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
const MODE = process.env.ZNB_TEST_MODE === "docker" ? "docker" : "host";

after(async () => {
  (await import("@/plugins/notebook/sessions")).endAllSessions();
  fs.rmSync(process.env.ZEFF_PLUGINS_DIR!, { recursive: true, force: true });
});

test("meta: pages and databases are made, read, changed, trashed and deleted — and each operation names its permission", async () => {
  const { metaRun, metaAccess } = await import("@/plugins/workspace/meta");
  const store = await import("@/plugins/workspace/store");
  const a = metaRun("page.create", { title: "Meta Seite", markdown: "# Hallo\n\nText" }) as { id: number };
  assert.equal(store.getPage(a.id)?.title, "Meta Seite");
  metaRun("page.update", { id: a.id, title: "Neu", markdown: "Nur Text" });
  assert.equal(store.getPage(a.id)?.title, "Neu");
  const tree = metaRun("tree", {}) as { id: number; title: string }[];
  assert.ok(tree.some((x) => x.id === a.id && x.title === "Neu"));
  assert.throws(() => metaRun("page.update", { id: a.id }), /Nothing to change/);

  const db = metaRun("database.create", { title: "Meta Kunden", properties: [{ name: "Betrag", type: "number" }], views: [{ name: "Tabelle", type: "table" }] }) as { id: number };
  metaRun("database.alter", { database: "Meta Kunden", ops: [{ op: "add_property", name: "Ort", type: "text" }] });
  const schema = metaRun("schema", { database: db.id }) as { properties: { name: string }[]; views: { name: string }[] };
  assert.deepEqual(schema.properties.map((p) => p.name), ["Betrag", "Ort"], "given properties replace the defaults; the new one is there");
  assert.deepEqual(schema.views.map((v) => v.name), ["Tabelle"]);
  assert.throws(() => metaRun("database.alter", { database: db.id, ops: [] }), /No operations/);

  assert.equal(metaAccess("page.create", {}).key, "meta:pages");
  assert.equal(metaAccess("database.create", {}).key, "meta:databases");
  assert.equal(metaAccess("database.alter", { database: db.id }).key, `meta:schema:${db.id}`, "fields and views are allowed per database");
  assert.equal(metaAccess("tree", {}).key, "meta:read");
  assert.equal(metaAccess("page.delete", {}).key, "meta:delete");
  assert.throws(() => metaAccess("nope", {}), /no meta operation/);

  metaRun("page.archive", { id: a.id });
  assert.ok(store.getPage(a.id)?.archivedAt, "archived: in the trash, not gone");
  metaRun("page.delete", { id: db.id });
  assert.equal(store.getDatabase(db.id), null, "deleted for good");
});

test("meta: blocks, flows and plugins — what code makes is inert (a flow has no permissions, a bad plugin is not kept)", async () => {
  const { metaRun } = await import("@/plugins/workspace/meta");
  const flows = await import("@/plugins/workspace/flows/store");
  // A block is checked like any block.
  assert.deepEqual(metaRun("block.save", { block: { name: "meta.hallo", description: "Hallo", params: [], template: "<callout>Hallo</callout>" } }), { name: "meta.hallo" });
  assert.ok((metaRun("blocks.list", {}) as { name: string }[]).some((b) => b.name === "meta.hallo"));
  assert.deepEqual(await (metaRun("block.delete", { name: "meta.hallo" }) as Promise<unknown>), { gone: true });
  // A flow made by code cannot give itself permissions; changing it keeps the ones it has.
  const made = metaRun("flow.save", { flow: { name: "meta-test", nodes: [], permissions: { ai: true, send: true, meta: ["pages"] } } }) as { id: number };
  assert.deepEqual(flows.getFlow(made.id)?.permissions, {}, "no permissions came with it");
  flows.saveFlow(made.id, { ...flows.getFlow(made.id)!, permissions: { web: ["example.com"] } });
  metaRun("flow.save", { page: made.id, flow: { name: "meta-test", nodes: [], permissions: { ai: true } } });
  assert.deepEqual(flows.getFlow(made.id)?.permissions, { web: ["example.com"] }, "what the user granted stays; the code's ask is ignored");
  assert.ok((metaRun("flows.list", {}) as { name: string }[]).some((f) => f.name === "meta-test"));
  metaRun("flow.delete", { page: made.id });
  assert.equal(flows.getFlow(made.id), null);

  // A plugin is written, checked, listed — and a plugin that does not pass is not kept.
  const saved = metaRun("plugin.save", { id: "Meta Demo", manifest: { name: "Meta demo", apiVersion: 1, permissions: ["prompt"], contributes: { workerRules: ["rules.md"] } }, files: { "rules.md": "Be kind." } }) as { id: string; version: string };
  assert.equal(saved.id, "meta-demo");
  assert.equal(fs.readFileSync(path.join(process.env.ZEFF_PLUGINS_DIR!, "meta-demo", "rules.md"), "utf8"), "Be kind.");
  assert.ok((metaRun("plugins.list", {}) as { id: string }[]).some((p) => p.id === "meta-demo"));
  assert.throws(() => metaRun("plugin.save", { id: "meta-demo", manifest: { name: "Broken", apiVersion: 999 }, files: {} }), /does not pass the check|apiVersion|Invalid/i);
  assert.ok(JSON.parse(fs.readFileSync(path.join(process.env.ZEFF_PLUGINS_DIR!, "meta-demo", "zeff-plugin.json"), "utf8")).name === "Meta demo", "the plugin that was there stays as it was");
  assert.throws(() => metaRun("plugin.save", { id: "evil", manifest: { name: "E", apiVersion: 1 }, files: { "../x.txt": "no" } }), /Not a path inside the plugin/);
  assert.equal(fs.existsSync(path.join(process.env.ZEFF_PLUGINS_DIR!, "evil")), false, "nothing is left of a plugin that was refused");
  metaRun("plugin.delete", { id: "meta-demo" });
  assert.equal(fs.existsSync(path.join(process.env.ZEFF_PLUGINS_DIR!, "meta-demo")), false);
});

test("meta in widgets: refused until the user allows that kind for this widget's code; reading and changing are apart", async () => {
  const { widgetCall, grantWidget } = await import("@/plugins/workspace/widget-bridge");
  const store = await import("@/plugins/workspace/store");
  const key = "w0123456789abcd";
  await assert.rejects(() => widgetCall(key, "meta.run", { op: "page.create", args: { title: "Von Widget" } }), /Not allowed/);
  grantWidget(key, { dbs: [], meta: ["pages"] });
  const r = (await widgetCall(key, "meta.run", { op: "page.create", args: { title: "Von Widget" } })) as { id: number };
  assert.equal(store.getPage(r.id)?.title, "Von Widget");
  await assert.rejects(() => widgetCall(key, "meta.read", { op: "tree" }), /Not allowed/, "pages is not read");
  await assert.rejects(() => widgetCall(key, "meta.read", { op: "page.create", args: { title: "x" } }), /meta.read is for reading/);
  grantWidget(key, { dbs: [], meta: ["read"] });
  assert.ok(Array.isArray(await widgetCall(key, "meta.read", { op: "tree" })));
  await assert.rejects(() => widgetCall(key, "meta.run", { op: "page.delete", args: { id: r.id } }), /Not allowed/, "deleting for good is its own kind");
});

test("meta in flows: the meta actions need the flow's permission for that kind; a dry run changes nothing", async () => {
  const { metaRun } = await import("@/plugins/workspace/meta");
  const flows = await import("@/plugins/workspace/flows/store");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const store = await import("@/plugins/workspace/store");
  const made = metaRun("flow.save", { flow: { name: "meta-flow", nodes: [{ kind: "action", action: "meta.run", input: { op: "page.create", args: { title: "Aus Flow" } } }] } }) as { id: number };
  const refused = await runFlow("meta-flow", {});
  assert.equal(refused.status, "failed");
  assert.match(String(refused.error), /may not .*pages/i);
  assert.equal(store.tree().some((x) => x.title === "Aus Flow"), false);
  // The user (the Studio) grants it.
  flows.saveFlow(made.id, { ...flows.getFlow(made.id)!, permissions: { meta: ["pages"] } });
  const dry = await runFlow("meta-flow", {}, { dry: true });
  assert.equal(dry.status, "done");
  assert.equal(store.tree().some((x) => x.title === "Aus Flow"), false, "a dry run writes nothing");
  const done = await runFlow("meta-flow", {});
  assert.equal(done.status, "done", String(done.error));
  assert.equal(store.tree().some((x) => x.title === "Aus Flow"), true);
});

async function runAsking(sessions: typeof import("@/plugins/notebook/sessions"), input: { session: string; language: string; code: string }, answers: Record<string, string>) {
  const ex = sessions.startExecution(input);
  const t0 = Date.now();
  for (;;) {
    const r = sessions.readExecution(ex.id);
    for (const q of r.permissions ?? []) sessions.answerPermission(ex.id, q.id, answers[q.key] ?? "deny");
    if (r.status && !["queued", "running"].includes(r.status)) return { ex, r: sessions.readExecution(ex.id) };
    if (Date.now() - t0 > 60000) throw new Error("cell did not finish");
    await new Promise((res) => setTimeout(res, 25));
  }
}
const textOf = (o: unknown) => ((o as { output_type: string; text?: string }[]) ?? []).filter((x) => x.output_type === "stream").map((x) => x.text).join("");

test("meta in Notebook cells: each kind asks apart — pages yes, deleting for good refused — and what was made is there", { timeout: 120000 }, async (t) => {
  const sessions = await import("@/plugins/notebook/sessions");
  const rt = await import("@/plugins/notebook/runtimes");
  const grants = await import("@/plugins/notebook/grants");
  const store = await import("@/plugins/workspace/store");
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  const host = store.createPage({ title: "Meta Notebook" });
  const session = `page-${host}`;
  const a = await runAsking(sessions, { session, language: "python", code: "i = zeff.meta.page_create('Aus Code', markdown='Hallo')\nprint(i)\ntree = zeff.meta.tree()\nprint(any(x['title'] == 'Aus Code' for x in tree))" }, { "meta:pages": "page", "meta:read": "page" });
  assert.equal(a.r.status, "ok", JSON.stringify(sessions.readExecution(a.ex.id).outputs));
  const id = Number(textOf(sessions.readExecution(a.ex.id).outputs).split("\n")[0]);
  assert.equal(store.getPage(id)?.title, "Aus Code");
  assert.match(textOf(sessions.readExecution(a.ex.id).outputs), /True/);
  assert.equal(grants.isGranted(host, "meta:pages"), true);
  assert.equal(grants.isGranted(host, "meta:delete"), false, "making pages does not allow deleting them");
  const d = await runAsking(sessions, { session, language: "python", code: `try:\n    zeff.meta.page_delete(${id})\nexcept PermissionError:\n    print('refused')` }, {});
  assert.match(textOf(sessions.readExecution(d.ex.id).outputs), /refused/);
  assert.ok(store.getPage(id), "still there");
});

test("functions of a plugin: called with arguments, refused what they were not granted, granted what they need; a cell calls one with its own permission", { timeout: 180000 }, async (t) => {
  const sessions = await import("@/plugins/notebook/sessions");
  const rt = await import("@/plugins/notebook/runtimes");
  const grants = await import("@/plugins/notebook/grants");
  const store = await import("@/plugins/workspace/store");
  const { metaRun } = await import("@/plugins/workspace/meta");
  const { setEnabled } = await import("@/lib/ext/registry");
  const { callFunction, listFunctions } = await import("@/plugins/notebook/functions");
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  metaRun("plugin.save", {
    id: "fn-demo",
    manifest: { name: "Fn demo", apiVersion: 1, contributes: { functions: [{ name: "double", runtime: "python", file: "fn/double.py" }, { name: "kennzahlen", runtime: "python", file: "fn/m.py", needs: ["metrics"], timeoutSeconds: 30 }] } },
    files: { "fn/double.py": "return inputs['x'] * 2", "fn/m.py": "m = zeff.metrics()\nreturn isinstance(m, dict)" },
  });
  assert.equal(listFunctions().length, 0, "a plugin that is not on brings no functions");
  setEnabled("fn-demo", true);
  assert.deepEqual(listFunctions().map((f) => f.name).sort(), ["double", "kennzahlen"]);

  const r1 = await callFunction("fn-demo", "double", { x: 21 });
  assert.equal(r1.ok && r1.value, 42, JSON.stringify(r1));
  const nope = await callFunction("fn-demo", "missing", {});
  assert.equal(nope.ok, false);
  assert.match(nope.ok ? "" : nope.error, /There is no function/);
  // Nobody to ask: refused, until it is granted in advance.
  const r2 = await callFunction("fn-demo", "kennzahlen", {});
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? "" : r2.error, /grant it under Settings → Notebook/);
  grants.addGrant("fn:fn-demo", "metrics");
  assert.equal(grants.isGranted("fn:fn-demo", "metrics"), true);
  assert.equal(grants.isGranted("fn:other", "metrics"), false, "per plugin");
  assert.equal(grants.isGranted("fn:fn-demo", "write:outputs"), false, "only what was granted");
  const r3 = await callFunction("fn-demo", "kennzahlen", {});
  assert.equal(r3.ok && r3.value, true, JSON.stringify(r3));

  // A cell calls it — a permission of its own for that function.
  const host = store.createPage({ title: "Ruft Funktion" });
  const c = await runAsking(sessions, { session: `page-${host}`, language: "python", code: "print(zeff.call('fn-demo', 'double', x=4))" }, { "call:fn-demo.double": "page" });
  assert.equal(c.r.status, "ok", JSON.stringify(sessions.readExecution(c.ex.id).outputs));
  assert.equal(textOf(sessions.readExecution(c.ex.id).outputs).trim(), "8");
  assert.equal(grants.isGranted(host, "call:fn-demo.double"), true);
});

test("a function's manifest is checked: a file that is not there, a name twice", async () => {
  const { metaRun } = await import("@/plugins/workspace/meta");
  assert.throws(() => metaRun("plugin.save", { id: "fn-bad", manifest: { name: "Bad", apiVersion: 1, contributes: { functions: [{ name: "x", runtime: "python", file: "nope.py" }] } }, files: {} }), /does not pass the check/);
  assert.throws(() => metaRun("plugin.save", { id: "fn-bad2", manifest: { name: "Bad", apiVersion: 1, contributes: { functions: [{ name: "x", runtime: "python", file: "a.py" }, { name: "x", runtime: "node", file: "b.js" }] } }, files: { "a.py": "1", "b.js": "1" } }), /used twice|does not pass/);
});

test("functions in widgets and flows: a widget needs that function allowed for its code; a plugin's flow action calls its function, with the flow's permission", { timeout: 180000 }, async (t) => {
  const rt = await import("@/plugins/notebook/runtimes");
  const { metaRun } = await import("@/plugins/workspace/meta");
  const { setEnabled } = await import("@/lib/ext/registry");
  const { widgetCall, grantWidget } = await import("@/plugins/workspace/widget-bridge");
  const { flowActions } = await import("@/plugins/workspace/flows/actions");
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  metaRun("plugin.save", {
    id: "fa-demo",
    manifest: {
      name: "Fa demo",
      apiVersion: 1,
      contributes: {
        functions: [{ name: "triple", runtime: "python", file: "fn/triple.py" }],
        flowActions: [{ name: "triple", label: "Triple a number", summary: "Times three.", function: "triple", input: [{ name: "x", type: "number", required: true }], output: "the number times three" }],
      },
    },
    files: { "fn/triple.py": "return inputs['x'] * 3" },
  });
  // A flow action that names a function the plugin does not have is refused when the plugin is written.
  assert.throws(() => metaRun("plugin.save", { id: "fa-bad", manifest: { name: "Bad", apiVersion: 1, contributes: { flowActions: [{ name: "a", label: "A", function: "missing" }] } }, files: {} }), /no function "missing"/);
  assert.equal(flowActions().some((a) => a.name === "fa-demo.triple"), false, "a plugin that is not on brings no actions");
  setEnabled("fa-demo", true);

  // Widgets: the function is a permission of its own, per widget code.
  const key = "w1111111111111f";
  await assert.rejects(() => widgetCall(key, "fn.call", { plugin: "fa-demo", name: "triple", args: { x: 2 } }), /may not run the function/);
  grantWidget(key, { dbs: [], meta: ["call:fa-demo.triple"] });
  assert.equal(await widgetCall(key, "fn.call", { plugin: "fa-demo", name: "triple", args: { x: 2 } }), 6);
  await assert.rejects(() => widgetCall(key, "fn.call", { plugin: "fa-demo", name: "other", args: {} }), /may not run the function/);

  // Flows: the action is in the catalog under the plugin's name; it needs the permission to call the function.
  const action = flowActions().find((a) => a.name === "fa-demo.triple");
  assert.ok(action, "an enabled plugin's action is in the catalog");
  assert.deepEqual(action!.input.map((i) => [i.name, i.type, !!i.required]), [["x", "number", true]]);
  const ctx = (meta: string[], dryRun = false) => ({ perms: { meta }, dryRun }) as unknown as Parameters<NonNullable<typeof action>["run"]>[1];
  await assert.rejects(async () => action!.run({ x: 3 }, ctx([])), /may not call the function/);
  assert.equal(await action!.run({ x: 3 }, ctx(["call:fa-demo.triple"])), 9);
  const direct = flowActions().find((a) => a.name === "fn.call")!;
  assert.equal(await direct.run({ plugin: "fa-demo", name: "triple", args: { x: 4 } }, ctx(["call:fa-demo.triple"])), 12);
  assert.deepEqual(await direct.run({ plugin: "fa-demo", name: "triple", args: { x: 4 } }, ctx(["call:fa-demo.triple"], true)), { dryRun: true, function: "fa-demo.triple" });
});

test("lookups and sources of a plugin are read by its functions", { timeout: 180000 }, async (t) => {
  const rt = await import("@/plugins/notebook/runtimes");
  const { metaRun } = await import("@/plugins/workspace/meta");
  const { setEnabled } = await import("@/lib/ext/registry");
  const { searchLookup, lookupSources } = await import("@/plugins/workspace/lookups");
  const { allSources } = await import("@/plugins/workspace/source-point");
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  assert.throws(() => metaRun("plugin.save", { id: "ls-bad", manifest: { name: "Bad", apiVersion: 1, contributes: { sources: [{ id: "s", label: "S", read: "nope" }] } }, files: {} }), /no function "nope"/);
  metaRun("plugin.save", {
    id: "ls-demo",
    manifest: {
      name: "Ls demo",
      apiVersion: 1,
      contributes: {
        functions: [
          { name: "find", runtime: "python", file: "fn/find.py" },
          { name: "one", runtime: "python", file: "fn/one.py" },
          { name: "all", runtime: "python", file: "fn/all.py" },
        ],
        lookups: [{ id: "birds", label: "Birds", fields: { title: "name", wings: "span" }, search: "find", details: "one" }],
        sources: [{ id: "birds", label: "Birds", read: "all" }],
      },
    },
    files: {
      "fn/find.py": "return [{'id': 'b1', 'title': inputs['query'] + ' tit'}, {'nope': 1}]",
      "fn/one.py": "return {'title': 'Tit ' + inputs['id'], 'wings': 18}",
      "fn/all.py": "return [{'ref': 'r1', 'title': 'Blue tit', 'fields': {'wings': 18}}, {'title': 'no ref'}]",
    },
  });
  assert.equal(lookupSources().some((s) => s.id === "ls-demo.birds"), false, "off plugin brings nothing");
  setEnabled("ls-demo", true);
  const found = await searchLookup("ls-demo.birds", "blue", "en-US");
  assert.deepEqual(found.hits, [{ id: "b1", title: "blue tit" }]);
  const src = allSources().find((s) => s.id === "ls-demo.birds")!;
  assert.ok(src);
  const recs = await src.read();
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].ref, recs[0].title, recs[0].fields.wings], ["r1", "Blue tit", "18"]);
});

test("a webhook: only a function that says so, only with the plugin's secret", { timeout: 180000 }, async (t) => {
  const rt = await import("@/plugins/notebook/runtimes");
  const { metaRun } = await import("@/plugins/workspace/meta");
  const { setEnabled } = await import("@/lib/ext/registry");
  const { renewWebhookSecret, clearWebhookSecret } = await import("@/plugins/notebook/webhooks");
  const { POST } = await import("@/app/api/ext/hook/[plugin]/[name]/route");
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  metaRun("plugin.save", {
    id: "hk-demo",
    manifest: { name: "Hk demo", apiVersion: 1, contributes: { functions: [{ name: "echo", runtime: "python", file: "fn/echo.py", webhook: true }, { name: "private", runtime: "python", file: "fn/p.py" }] } },
    files: { "fn/echo.py": "return {'got': inputs.get('x') or inputs.get('body')}", "fn/p.py": "return 1" },
  });
  setEnabled("hk-demo", true);
  const hit = (name: string, secret: string | null, body: string) =>
    POST(new Request(`http://127.0.0.1:9333/api/ext/hook/hk-demo/${name}`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {}, body }), { params: Promise.resolve({ plugin: "hk-demo", name }) });
  clearWebhookSecret("hk-demo");
  assert.equal((await hit("echo", "anything", "{}")).status, 401, "no secret made: nobody gets in");
  const secret = renewWebhookSecret("hk-demo");
  assert.equal((await hit("echo", null, "{}")).status, 401);
  assert.equal((await hit("echo", "wrong", "{}")).status, 401);
  const ok = await hit("echo", secret, JSON.stringify({ x: 5 }));
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).result, { got: 5 });
  assert.deepEqual(((await (await hit("echo", secret, "plain text")).json()) as { result: unknown }).result, { got: "plain text" });
  assert.equal((await hit("private", secret, "{}")).status, 404, "a function that is not a webhook is not reachable");
  const again = renewWebhookSecret("hk-demo");
  assert.equal((await hit("echo", secret, "{}")).status, 401, "a renewed secret ends the old one");
  assert.equal((await hit("echo", again, "{}")).status, 200);
  clearWebhookSecret("hk-demo");
});

test("field types of a plugin are checked by what they say; zeff.ai needs its own permission", async () => {
  const { metaRun } = await import("@/plugins/workspace/meta");
  const { setEnabled } = await import("@/lib/ext/registry");
  const { fieldType, parseCustom } = await import("@/plugins/workspace/field-types");
  const { accessFor } = await import("@/plugins/notebook/zeff-access");
  assert.throws(() => metaRun("plugin.save", { id: "ft-bad", manifest: { name: "Bad", apiVersion: 1, contributes: { fieldTypes: [{ id: "x", label: "X", pattern: "(" }] } }, files: {} }), /regular expression/);
  assert.throws(() => metaRun("plugin.save", { id: "ft-bad", manifest: { name: "Bad", apiVersion: 1, contributes: { fieldTypes: [{ id: "x", label: "X", kind: "choice" }] } }, files: {} }), /needs options/);
  metaRun("plugin.save", {
    id: "ft-demo",
    manifest: {
      name: "Ft demo",
      apiVersion: 1,
      contributes: {
        fieldTypes: [
          { id: "ticket", label: "Ticket", pattern: "^[A-Z]+-\\d+$", display: "link", href: "https://t.example/{value}" },
          { id: "score", label: "Score", kind: "number", min: 0, maxValue: 10, display: "progress" },
          { id: "mood", label: "Mood", kind: "choice", options: ["good", "ok", "bad"], display: "badge" },
        ],
      },
    },
    files: {},
  });
  assert.equal(fieldType("ft-demo.ticket"), undefined, "off plugin brings nothing");
  setEnabled("ft-demo", true);
  assert.equal(parseCustom("ft-demo.ticket", "ABC-12"), "ABC-12");
  assert.equal(parseCustom("ft-demo.ticket", "nope"), null);
  assert.equal(parseCustom("ft-demo.score", "7,5"), 7.5);
  assert.equal(parseCustom("ft-demo.score", "11"), null);
  assert.equal(parseCustom("ft-demo.mood", "OK"), "ok");
  assert.equal(parseCustom("ft-demo.mood", "great"), null);
  assert.equal(fieldType("ft-demo.mood")?.suggestions?.().length, 3);
  const a = await accessFor({ op: "ai", args: { prompt: "hi" } } as never);
  assert.equal(a.key, "ai");
  assert.equal(a.write, true);
});
