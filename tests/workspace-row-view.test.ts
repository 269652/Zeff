import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * A custom view of a row: a plugin brings one view for the rows of a database of its type (the person's page for the people
 * database). It is ONE block of the row's own page — the rest of the page is free text and blocks. No detail layout pages, no
 * dozen person modules.
 */
setupTempData();

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

test("rowView: a block of the document, kept by sanitize, as Markdown and back; the person modules are gone", async () => {
  const d = await import("@/plugins/workspace/doc");
  const clean = d.sanitizeDoc({ type: "doc", content: [{ type: "rowView", attrs: { junk: 1 } }, para("Notiz"), { type: "zeffModule", attrs: { module: "person-profile", key: "" } }] }) as { content: { type: string; attrs?: unknown }[] };
  assert.deepEqual(clean.content.map((n) => n.type), ["rowView", "paragraph"], "the old person module block is dropped");
  assert.equal(clean.content[0].attrs, undefined);
  const md = d.docToMarkdown(clean as never);
  assert.match(md, /^:::rowview$/m);
  const back = d.markdownToDoc(md).content as { type: string }[];
  assert.equal(back[0].type, "rowView");
  assert.doesNotMatch(d.docText(clean as never), /rowview/i, "no text of its own");
  const m = await import("@/plugins/workspace/model");
  assert.equal((m as Record<string, unknown>).PERSON_MODULES, undefined, "the dozen modules are gone");
});

test("detail views: no layout pages; a people row's page is its view", async () => {
  const m = await import("@/plugins/workspace/model");
  const schema = m.normalizeSchema({ titleName: "N", properties: [], views: [], dataType: "people", detailPage: 5 });
  assert.equal((schema as { detailPage?: number }).detailPage, undefined, "a layout page isn't kept any more");
  assert.deepEqual(m.detailModules({ ...schema, dataType: "people" }, null), ["page"], "the page holds the view");
});

test("ensureRowView: a person's page starts with the view block, once, its own text kept; not for other databases", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("people", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { ensureRowView, ensureRowViews, rowViewOf } = await import("@/plugins/workspace/row-views");
  assert.equal(rowViewOf("people")?.id, "person");
  assert.equal(rowViewOf("mail"), undefined);

  const people = w.createPage({ kind: "database", title: "People", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], dataType: "people" } });
  const ada = w.addRow(people, { title: "Ada" });
  w.updatePage(ada, { content: { type: "doc", content: [para("Meine Notiz zu Ada")] } });
  assert.equal(ensureRowView(ada), true);
  const types = () => (w.getPage(ada)!.content.content ?? []).map((n) => n.type);
  assert.deepEqual(types(), ["rowView", "paragraph"], "the view first, her text after it");
  const rev = w.getPage(ada)!.rev;
  assert.equal(ensureRowView(ada), false, "once");
  assert.equal(w.getPage(ada)!.rev, rev, "nothing written the second time");

  const other = w.createPage({ kind: "database", title: "Aufgaben", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  const task = w.addRow(other, { title: "T" });
  assert.equal(ensureRowView(task), false, "a database without a custom view");
  assert.deepEqual((w.getPage(task)!.content.content ?? []).map((n) => n.type), ["paragraph"].slice(0, (w.getPage(task)!.content.content ?? []).length));

  const bob = w.addRow(people, { title: "Bob" });
  const n = ensureRowViews();
  assert.ok(n >= 1, "every person row of every people database, in one go");
  assert.equal(w.getPage(bob)!.content.content?.[0].type, "rowView");

  setInstalled("people", false);
  const cy = w.addRow(people, { title: "Cy" });
  assert.equal(ensureRowView(cy), false, "its plugin isn't installed: no view");
  setInstalled("people", true);
});

test("the old detail layouts (System → Detail views) are put in the trash once — and are no system pages any more", async () => {
  const w = await import("@/plugins/workspace/store");
  const { setPref } = await import("@/lib/prefs");
  const { addSystemPage, isSystemPage } = await import("@/lib/prompts/system-pages");
  const { retireDetailLayouts } = await import("@/plugins/workspace/row-views");
  assert.equal(retireDetailLayouts(), false, "nothing to retire when there never was a folder");
  const folder = w.createPage({ title: "Detail views" });
  const layout = w.createPage({ title: "People", parentId: folder });
  addSystemPage(folder);
  addSystemPage(layout);
  setPref("system.detailFolder", folder);
  assert.equal(retireDetailLayouts(), true);
  assert.ok(w.getPage(folder)!.archivedAt && w.getPage(layout)!.archivedAt, "in the trash (they can be restored from there)");
  assert.ok(!isSystemPage(folder) && !isSystemPage(layout));
  assert.equal(retireDetailLayouts(), false, "once");
});
