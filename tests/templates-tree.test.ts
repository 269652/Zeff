import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases", "finances"]) setInstalled(p, true);
  await import("@/plugins/contributions");
  return { s: await import("@/plugins/workspace/store"), tpl: await import("@/plugins/workspace/templates") };
}
const pageCount = async () => ((await import("@/db")).getSqlite().prepare("select count(*) n from ws_pages").get() as { n: number }).n;

test("the catalog: the built-in templates (the outdated ones gone) and your own — every picker lists exactly these", async () => {
  const { s, tpl } = await setup();
  const keys = tpl.templateMetas().map((m) => m.key);
  for (const k of ["meeting", "tasks", "projects", "dashboard", "contracts"]) assert.ok(keys.includes(k), k);
  for (const k of ["debts", "wiki-home", "pkg:projects-tasks"]) assert.ok(!keys.includes(k), `${k} is cleaned up`);
  const own = s.createPage({ title: "Kundentermin", icon: "📞", template: true });
  const mine = tpl.templateMetas().find((m) => m.key === `page:${own}`);
  assert.ok(mine, "your own template is in the catalog");
  assert.equal(mine.category, "mine");
  assert.equal(mine.name, "Kundentermin");
});

test("your own template is not in the page tree but in the templates' tree — with what is below it; its routines don't run", async () => {
  const { s } = await setup();
  const own = s.createPage({ title: "Vorlage Projekt", template: true });
  const kid = s.createPage({ parentId: own, title: "Vorlage Unterseite" });
  const ids = s.tree().map((x) => x.id);
  assert.ok(!ids.includes(own) && !ids.includes(kid), "not in the page tree");
  const tt = s.templateTree();
  assert.equal(tt.find((x) => x.id === own)?.parentId, null);
  assert.equal(tt.find((x) => x.id === kid)?.parentId, own);
  assert.ok(s.inTemplates(kid) && !s.inTemplates(s.createPage({ title: "Normal" })));
  const { createRoutine, listRoutines } = await import("@/plugins/workspace/routines");
  createRoutine(kid, "agent", { enabled: true });
  assert.ok(!listRoutines().some((r) => r.pageId === kid), "a template's routine is left alone");
});

test("a built-in template previewed: its page as it would be made — nothing is kept", async () => {
  const { tpl } = await setup();
  const before = await pageCount();
  const p = tpl.previewTemplate("weekly-review");
  assert.equal(await pageCount(), before, "the preview leaves nothing behind");
  assert.equal(p.kind, "page");
  assert.match(JSON.stringify(p.page.content), /flexBox|callout|zeffWidget/);
  assert.ok(p.children.length >= 1, "the draft agent below it");
  const d = tpl.previewTemplate("tasks");
  assert.equal(d.kind, "database");
  assert.ok(d.databases[0].properties.length > 2 && d.databases[0].views.length > 0);
  assert.throws(() => tpl.previewTemplate("nope"));
});

test("a built-in duplicated: your own template page with the same content; a two-database template kept together under one page", async () => {
  const { s, tpl } = await setup();
  const fresh = await tpl.fromTemplate("meeting", null);
  const own = tpl.duplicateBuiltin("meeting");
  const p = s.getPage(own)!;
  assert.ok(p.template && p.parentId === null);
  // (Its to-do lists get their own ids each time it is made.)
  const same = (doc: unknown) => JSON.stringify(doc).replace(/"(listId|itemId)":"[^"]*"/g, "");
  assert.equal(same(p.content), same(s.getPage(fresh)!.content));
  assert.ok(tpl.templateMetas().some((m) => m.key === `page:${own}`));
  const before = s.tree().length;
  const pr = tpl.duplicateBuiltin("projects");
  assert.equal(s.tree().length, before, "nothing of it lands in the page tree");
  const kids = s.templateTree().filter((x) => x.parentId === pr);
  assert.equal(kids.filter((x) => x.kind === "database").length, 2);
});

test("using a template: built-in and own make a new page where you choose; an own one is copied with its databases, relations and routines", async () => {
  const { s, tpl } = await setup();
  const parent = s.createPage({ title: "Ziel" });
  const b = await tpl.fromTemplate("meeting", parent);
  assert.equal(s.getPage(b)!.parentId, parent);
  const own = tpl.duplicateBuiltin("projects");
  const used = await tpl.fromTemplate(`page:${own}`, parent);
  const u = s.getPage(used)!;
  assert.ok(!u.template && u.parentId === parent);
  assert.equal(u.title, s.getPage(own)!.title, "no “(copy)”");
  assert.ok(s.tree().some((x) => x.id === used), "in the page tree");
  const dbs = s.tree().filter((x) => x.parentId === used && x.kind === "database");
  assert.equal(dbs.length, 2);
  const rel = dbs.flatMap((d) => s.getDatabase(d.id)!.schema.properties).find((x) => x.type === "relation" && x.relationDb)!;
  assert.ok(dbs.some((d) => d.id === rel.relationDb), "the relation points at the copy, not the template");
  const { createRoutine, getRoutine } = await import("@/plugins/workspace/routines");
  const agentTpl = s.createPage({ title: "Agent-Vorlage", template: true });
  createRoutine(agentTpl, "agent", { enabled: true });
  const agent = await tpl.fromTemplate(`page:${agentTpl}`, null);
  assert.equal(getRoutine(agent)?.kind, "agent");
  assert.equal(getRoutine(agent)?.enabled, true);
});

test("save as template copies the page into the templates; removed from the templates it is back in the page tree", async () => {
  const { s, tpl } = await setup();
  const page = s.createPage({ title: "Checkliste Reise", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Pass" }] }] } });
  const copy = tpl.saveAsTemplate(page);
  assert.notEqual(copy, page);
  assert.ok(s.getPage(copy)!.template && s.getPage(copy)!.title === "Checkliste Reise");
  assert.deepEqual(s.getPage(copy)!.content, s.getPage(page)!.content);
  assert.ok(s.tree().some((x) => x.id === page), "the page itself stays");
  const kid = s.createPage({ parentId: copy, title: "Teil" });
  tpl.setTemplate(kid, false);
  assert.ok(s.tree().some((x) => x.id === kid && x.parentId === null), "a page below a template: out to the top of the tree");
  tpl.setTemplate(copy, false);
  assert.ok(s.tree().some((x) => x.id === copy));
  tpl.setTemplate(page, true);
  assert.ok(s.templateTree().some((x) => x.id === page) && !s.tree().some((x) => x.id === page), "moved into the templates");
});
