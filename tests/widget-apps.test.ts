import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Widgets as Zeff's shared building block (lib/widgets/bridge.ts, workspace/widget-bridge.ts): a widget's calls checked on the
 * way in, its key by its code, what it may write granted by the user only (never by the AI), reads that keep out of secret
 * databases, writes by field name, the block's Markdown round trip, and the assistant's widget tool.
 */

test("a widget's calls are checked: known methods, an id, arguments as an object, not too big", async () => {
  const { parseCall, MAX_CALL_ARGS } = await import("@/lib/widgets/bridge");
  const { parseWidgetMessage } = await import("@/lib/widgets/sandbox");
  assert.deepEqual(parseWidgetMessage({ zeffWidget: 1, type: "call", id: 3, method: "db.rows", args: { db: 12 } }), { type: "call", id: 3, method: "db.rows", args: { db: 12 } });
  assert.deepEqual(parseCall({ id: 1, method: "db.list" }), { id: 1, method: "db.list", args: {} });
  assert.equal(parseCall({ id: 1, method: "eval", args: {} }), null, "no unknown method");
  assert.equal(parseCall({ id: 0, method: "db.list" }), null, "an id");
  assert.equal(parseCall({ id: 2, method: "db.add", args: [1] }), null, "arguments are an object");
  assert.equal(parseCall({ id: 2, method: "db.add", args: { values: { x: "y".repeat(MAX_CALL_ARGS) } } }), null, "not too big");
});

test("a widget's key follows its code; wants are cleaned; what's missing is what isn't granted", async () => {
  const { widgetKey, wantsOf, missing } = await import("@/lib/widgets/bridge");
  assert.match(widgetKey("<p>a</p>"), /^w[0-9a-f]{14}$/);
  assert.equal(widgetKey("<p>a</p>"), widgetKey("<p>a</p>"));
  assert.notEqual(widgetKey("<p>a</p>"), widgetKey("<p>b</p>"));
  assert.deepEqual(wantsOf("12, 7,x,12,-1", "true"), { writes: [12, 7], ai: true });
  assert.deepEqual(wantsOf(undefined), { writes: [] });
  assert.deepEqual(missing({ writes: [1, 2], ai: true }, { dbs: [2] }), { writes: [1], ai: true });
  assert.deepEqual(missing({ writes: [1] }, { dbs: [1], ai: true }), { writes: [] });
});

test("the bridge: reads by field name, writes only where granted, secret databases closed, state kept apart", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { widgetCall, grantWidget, revokeWidget, widgetGrant, widgetContext, isRefusal } = await import("@/plugins/workspace/widget-bridge");
  const { widgetKey } = await import("@/lib/widgets/bridge");
  const page = store.createPage({ title: "Leads page" });
  const db = store.createPage({ kind: "database", title: "Leads", parentId: page });
  const { schema } = applyOps(store.getDatabase(db)!.schema, [{ op: "add_property", name: "Email", type: "email" }, { op: "add_property", name: "Size", type: "number" }, { op: "add_property", name: "Hot", type: "checkbox" }, { op: "add_property", name: "Stage", type: "select", options: ["New", "Won"] }], { related: () => null });
  store.saveSchema(db, schema);
  store.updatePage(page, { content: { type: "doc", content: [{ type: "databaseView", attrs: { dbId: db, viewId: "", title: "" } }] } });
  const other = store.createPage({ kind: "database", title: "Elsewhere" });

  const key = widgetKey("<div id=f></div><script>ZeffKit.form('#f', { db: 'Leads' })</script>");
  const refused = async (p: Promise<unknown>, re: RegExp) => {
    await assert.rejects(p, (e: unknown) => isRefusal(e) && re.test((e as Error).message));
  };

  // Reading needs nothing.
  const s = (await widgetCall(key, "db.schema", { db: "leads" })) as { id: number; titleName: string; fields: { name: string; options?: string[] }[] };
  assert.equal(s.id, db, "by its title, any case");
  assert.deepEqual(s.fields.find((f) => f.name === "Stage")?.options, ["New", "Won"]);
  // Writing needs the user's OK.
  await refused(widgetCall(key, "db.add", { db, values: { Name: "Ada" } }), /Not allowed/);
  assert.equal(widgetGrant(key), null);
  grantWidget(key, { dbs: [db] });
  const made = (await widgetCall(key, "db.add", { db, values: { [s.titleName]: "Ada", Email: "ada@example.com", Size: "12", Hot: true, Stage: "Won" } })) as { id: number };
  await widgetCall(key, "db.add", { db, values: { title: "Bob", Size: 3, Stage: "New" } });
  const rows = (await widgetCall(key, "db.rows", { db, sort: "Size", desc: true })) as { total: number; rows: { id: number; title: string; values: Record<string, unknown> }[] };
  assert.deepEqual(rows.rows.map((r) => r.title), ["Ada", "Bob"]);
  assert.deepEqual([rows.rows[0].values.Size, rows.rows[0].values.Hot, rows.rows[0].values.Stage, rows.rows[1].values.Hot], [12, true, "Won", false], "numbers, ticks and choices as they are");
  assert.deepEqual(((await widgetCall(key, "db.rows", { db, where: { Stage: "won" } })) as typeof rows).rows.map((r) => r.id), [made.id], "where: equal, any case");
  assert.equal(((await widgetCall(key, "db.rows", { db, contains: "example.com" })) as typeof rows).total, 1);
  await widgetCall(key, "db.update", { db, row: made.id, values: { Stage: "New" } });
  assert.equal(((await widgetCall(key, "db.rows", { db, where: { Stage: "New" } })) as typeof rows).total, 2);
  await refused(widgetCall(key, "db.update", { db: other, row: made.id, values: {} }), /Not allowed/);
  await refused(widgetCall(key, "db.rows", { db, where: { Nope: 1 } }), /No field "Nope"/);
  await refused(widgetCall(key, "db.rows", { db: "Nothing" }), /No database/);
  // Another widget (other code) isn't allowed what this one is.
  await refused(widgetCall(widgetKey("<p>other</p>"), "db.add", { db, values: { title: "x" } }), /Not allowed/);
  // The AI only when allowed.
  await refused(widgetCall(key, "ai", { prompt: "hi" }), /may not ask the AI/);
  // The page answers state itself.
  await refused(widgetCall(key, "state.get", {}), /page's/);
  // Taken back.
  revokeWidget(key, { db });
  await refused(widgetCall(key, "db.add", { db, values: { title: "Eve" } }), /Not allowed/);
  // A secret database is closed to widgets.
  (await import("@/plugins/workspace/sensitivity")).setDatabaseLabel(other, "secret");
  await refused(widgetCall(key, "db.rows", { db: other }), /secret/);
  assert.ok(!((await widgetCall(key, "db.list", {})) as { id: number }[]).some((d) => d.id === other), "nor listed");
  // Where it is: the databases on its page first.
  const ctx = widgetContext(page);
  assert.equal(ctx.page?.id, page);
  assert.equal(ctx.databases[0].id, db);
  assert.ok("onPage" in ctx.databases[0]);
});

test("a widget block keeps its code and state through Markdown; libraries Zeff doesn't have and junk ids are dropped", async () => {
  const { docToMarkdown, markdownToDoc, sanitizeDoc } = await import("@/plugins/workspace/doc");
  const html = '<div id="f"></div>\n<script>\nconst s = `\n:::\n`;\nZeffKit.form("#f", { db: 12 });\n</script>';
  const doc = sanitizeDoc({ type: "doc", content: [{ type: "zeffApp", attrs: { title: "Leads", prompt: "a form", html, libs: "chart,evil", writes: "12,x", ai: false, state: '{"n":3}' } }] });
  const node = doc.content[0];
  assert.deepEqual(node.attrs, { title: "Leads", prompt: "a form", html, libs: "chart", writes: "12", ai: false, flows: "", wid: "", state: '{"n":3}' });
  const md = docToMarkdown(doc);
  assert.match(md, /^:::app \{"title":"Leads","prompt":"a form","libs":\["chart"\],"writes":\[12\],"state":\{"n":3\}\}\n/);
  const back = markdownToDoc(md).content.find((n) => n.type === "zeffApp")!;
  assert.deepEqual(back.attrs, node.attrs, "the same block again — a line of only ':::' in its code too");
  assert.equal(markdownToDoc(":::app\n<p>hi</p>\n:::\n\nAfter").content[1].type, "paragraph", "what follows is the page again");
  assert.equal(sanitizeDoc({ type: "doc", content: [{ type: "zeffApp", attrs: { html: "x".repeat(400_000) } }] }).content.some((n) => n.type === "zeffApp"), false, "too big: no block");
});

test("the assistant's widget tool: checked, shown in its answer, put into a page — and it can't grant itself anything", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { registerWidgetTools } = await import("@/plugins/workspace/mcp-widgets");
  const { embedsOf } = await import("@/plugins/workspace/chat-embed");
  const { widgetGrant } = await import("@/plugins/workspace/widget-bridge");
  const { widgetKey } = await import("@/lib/widgets/bridge");
  const tools: Record<string, (a: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>> = {};
  const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
  registerWidgetTools({ registerTool: (name: string, _m: unknown, fn: never) => (tools[name] = fn) } as never, { run: async (fn: () => unknown) => (await fn()) as never, ok: (t: string) => text(t) as never, fail: (t: string) => text(t, true) as never });
  assert.match((await tools.workspace_widget_docs({})).content[0].text, /ZeffKit\.form/);
  const db = store.createPage({ kind: "database", title: "Signups" });
  const page = store.createPage({ title: "Event" });
  const html = '<div id="f"></div><script>ZeffKit.form("#f", { db: "Signups" })</script>';
  const r = await tools.workspace_widget({ title: "Sign up", html, writes: ["Signups"], page });
  assert.ok(!r.isError, r.content[0].text);
  const [embed] = embedsOf(r);
  assert.equal(embed.kind, "widget");
  assert.deepEqual(embed.kind === "widget" && [embed.writes, embed.pageId], [[db], page]);
  const block = store.getPage(page)!.content.content.find((n) => n.type === "zeffApp")!;
  assert.equal(block.attrs?.html, html);
  assert.equal(block.attrs?.writes, String(db));
  assert.equal(widgetGrant(widgetKey(html)), null, "asked for — not granted");
  const bad = await tools.workspace_widget({ title: "x", html: "<script>fetch('https://evil.example')</script>" });
  assert.ok(bad.isError && /no network/.test(bad.content[0].text));
  const nodb = await tools.workspace_widget({ title: "x", html: "<p>x</p>", writes: ["Nope"] });
  assert.ok(nodb.isError);
});
