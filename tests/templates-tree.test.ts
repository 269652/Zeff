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

/** The built-in templates kept: each complete and worth starting from. */
const KEPT = ["contracts", "decisions", "journal", "meeting", "projects", "reading-list", "tasks", "weekly-review"];
const builtinKeys = (tpl: Awaited<ReturnType<typeof setup>>["tpl"]) =>
  tpl
    .templateMetas()
    .filter((m) => m.category !== "mine" && m.category !== "packages")
    .map((m) => m.key)
    .sort();

test("the catalog: the built-in templates (only the complete ones) and your own — every picker lists exactly these", async () => {
  const { s, tpl } = await setup();
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("jira", false);
  assert.deepEqual(builtinKeys(tpl), KEPT);
  const keys = tpl.templateMetas().map((m) => m.key);
  for (const k of ["debts", "wiki-home", "pkg:projects-tasks", "dashboard", "finances", "who-owes", "authority", "project-brief", "keep-board", "news-summary", "one-on-one", "installment-plan", "agent", "automation", "agent-jobs", "rules"]) assert.ok(!keys.includes(k), `${k} is cleaned up`);
  setInstalled("jira", true);
  assert.deepEqual(builtinKeys(tpl), [...KEPT, "ticket-cockpit"].sort(), "the ticket cockpit with the Jira plugin only");
  setInstalled("jira", false);
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

test("a preview looks nothing up live: the journal's and the projects' databases are cards of their fields and views — no block points at a rolled-back id", async () => {
  const { s, tpl } = await setup();
  const before = await pageCount();
  for (const key of ["journal", "projects"]) {
    const p = tpl.previewTemplate(key);
    const text = JSON.stringify(p.page.content);
    assert.ok(!/"type":"(databaseView|pageEmbed|todoListEmbed|zeffForm|zeffRoutine)"/.test(text), `${key}: ${text.slice(0, 300)}`);
    assert.match(text, /"type":"callout"/);
    const max = Math.max(0, ...s.tree().map((x) => x.id));
    assert.ok(!/"(dbId|pageId)":(\d+)/.test(text) || [...text.matchAll(/"(dbId|pageId)":(\d+)/g)].every((m) => Number(m[2]) <= max), "no id that is not there");
  }
  const j = JSON.stringify(tpl.previewTemplate("journal").page.content);
  assert.match(j, /Journal entries/);
  assert.match(j, /Mood/, "the entries' fields");
  assert.equal(await pageCount(), before);
});

/** Every block's text below a node (to tell an empty placeholder). */
const textIn = (n: { text?: string; content?: unknown[] }): string => (n.text ?? "") + (n.content ?? []).map((c) => textIn(c as never)).join("");
const walk = (n: { type?: string; content?: unknown[] }, out: { type?: string; content?: unknown[] }[] = []) => {
  out.push(n);
  for (const c of n.content ?? []) walk(c as never, out);
  return out;
};

test("every kept template is complete: a page says in a line what it is for and has no empty placeholders; a database has its views and example rows", async () => {
  const { s, tpl } = await setup();
  const { setInstalled } = await import("@/plugins/state");
  // (With the Finances plugin the contracts come from your statements instead of examples.)
  setInstalled("finances", false);
  for (const key of KEPT) {
    const id = await tpl.fromTemplate(key, null);
    const p = s.getPage(id)!;
    if (p.kind === "database") {
      const d = s.getDatabase(id)!;
      assert.ok(d.schema.views.length >= 2, `${key}: views`);
      assert.ok(s.rawRows(id).length >= 2, `${key}: example rows`);
      continue;
    }
    const nodes = walk(p.content as never);
    const blocks = (p.content as { content: { type: string }[] }).content;
    assert.equal(blocks[0].type, "callout", `${key}: an intro first`);
    const empty = nodes.filter((n) => (n.type === "listItem" || n.type === "taskItem") && !textIn(n as never).trim());
    assert.equal(empty.length, 0, `${key}: ${empty.length} empty list items`);
  }
  setInstalled("finances", true);
});

test("meeting notes: a 1:1 is a section of it (no template of its own); projects: one page with its two databases and what they are for", async () => {
  const { s, tpl } = await setup();
  const meeting = JSON.stringify(s.getPage(await tpl.fromTemplate("meeting", null))!.content);
  assert.match(meeting, /1:1/);
  const pr = await tpl.fromTemplate("projects", null);
  assert.equal(s.getPage(pr)!.kind, "page");
  const dbs = s.tree().filter((x) => x.parentId === pr && x.kind === "database");
  assert.equal(dbs.length, 2);
  const shown = [...JSON.stringify(s.getPage(pr)!.content).matchAll(/"dbId":(\d+)/g)].map((m) => Number(m[1])).sort();
  assert.deepEqual(shown, dbs.map((d) => d.id).sort(), "both shown on the page");
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
  const shown = [...JSON.stringify(u.content).matchAll(/"dbId":(\d+)/g)].map((m) => Number(m[1])).sort();
  assert.deepEqual(shown, dbs.map((d) => d.id).sort(), "the page shows the copied databases, not the template's");
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
