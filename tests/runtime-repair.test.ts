import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * What the AI changes at runtime and can take back: a view's template (every change keeps the one before), an app's template copied into its
 * view (and kept up with the app while nobody changed it), a plugin function's code (versions beside it; it must parse).
 */
setupTempData();
const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
process.env.ZEFF_PLUGINS_DIR = PLUGINS;

test("a view's template: every change keeps the one before, and one comes back", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { newView } = await import("@/plugins/workspace/model");
  const v = { ...newView("App", "table"), type: "app" as const, app: "template", template: "<text>one</text>" };
  const id = store.createPage({ kind: "database", title: "Things", schema: { titleName: "Name", properties: [], views: [v] } });
  const set = (template: string) => {
    const s = store.getDatabase(id)!.schema;
    store.updateSchema(id, { ...s, views: s.views.map((x) => (x.id === v.id ? { ...x, template } : x)) });
  };
  set("<text>two</text>");
  set("<text>three</text>");
  const list = store.viewVersions(id, v.id);
  assert.equal(list.length, 2);
  assert.equal(store.viewVersion(list[0].id)!.template, "<text>two</text>", "the newest kept is the one just before");
  store.restoreViewVersion(list[1].id);
  assert.equal(store.getDatabase(id)!.schema.views[0].template, "<text>one</text>");
  assert.equal(store.viewVersions(id, v.id).length, 3, "the one replaced by going back is kept too");
});

test("an app's template is copied into its view; an untouched copy follows the app, a changed one stays", async () => {
  const store = await import("@/plugins/workspace/store");
  const { newView } = await import("@/plugins/workspace/model");
  const { ensureAppTemplates } = await import("@/plugins/workspace/app-templates");
  const v = { ...newView("Agenda", "table"), type: "app" as const, app: "agenda" };
  const id = store.createPage({ kind: "database", title: "Notes", schema: { titleName: "Name", properties: [], views: [v] } });
  ensureAppTemplates(id);
  const copied = store.getDatabase(id)!.schema.views[0];
  assert.ok(copied.template && copied.template.length > 50, "the app's template is in the view now");
  assert.ok(copied.templateBase);
  // The app's template changed (Zeff updated): an untouched copy follows.
  const s = store.getDatabase(id)!.schema;
  store.updateSchema(id, { ...s, views: s.views.map((x) => ({ ...x, templateBase: "0000" })) });
  const before = store.getDatabase(id)!.schema.views[0].template;
  // (Its hash no longer matches its base: it counts as changed — stays.)
  ensureAppTemplates(id);
  assert.equal(store.getDatabase(id)!.schema.views[0].template, before);
});

test("a plugin function's code: it must parse, the code before is kept, and it comes back", async () => {
  const dir = path.join(PLUGINS, "fn-test");
  fs.mkdirSync(path.join(dir, "fn"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "zeff-plugin.json"),
    JSON.stringify({ id: "fn-test", name: "Fn test", version: "1.0.0", apiVersion: 1, contributes: { functions: [{ name: "hello", title: "Hello", description: "Says hello.", runtime: "node", file: "fn/hello.js", input: {}, needs: [] }] } }),
  );
  fs.writeFileSync(path.join(dir, "fn", "hello.js"), 'return "one";');
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("notebook", true);
  const { scanPlugins, setEnabled } = await import("@/lib/ext/registry");
  assert.deepEqual(scanPlugins(true).problems, []);
  setEnabled("fn-test", true);
  const src = await import("@/plugins/notebook/function-source");
  assert.match(src.syntaxProblem("return (") ?? "", /./);
  assert.equal(src.syntaxProblem('const x = await zeff.database("a"); return x;'), null, "await at the top is fine: it is an async function's body");
  assert.throws(() => src.saveFunctionSource("fn-test", "hello", "return ("), /doesn't parse/);
  src.saveFunctionSource("fn-test", "hello", 'return "two";');
  const now = src.functionSource("fn-test", "hello");
  assert.equal(now.code, 'return "two";');
  assert.equal(now.versions.length, 1);
  assert.equal(src.functionVersionCode("fn-test", "hello", now.versions[0].id), 'return "one";');
  src.restoreFunctionSource("fn-test", "hello", now.versions[0].id);
  assert.equal(src.functionSource("fn-test", "hello").code, 'return "one";');
});
