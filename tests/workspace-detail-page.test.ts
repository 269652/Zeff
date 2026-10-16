import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A database's detail view is a page (System → Detail views → its name): blocks — the row's properties, subtasks,
 * suggested actions, todos, briefing …, its own page, and any text — edited like any page; made from what the database
 * showed so far, once. The row modules are blocks a page can hold too.
 */
test("ensureDetailPage: the detail view as a page of blocks — from what the database showed, once, protected", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const d = await import("@/plugins/workspace/doc");
  const { ensureDetailPage } = await import("@/plugins/workspace/detail-page");
  const { isSystemPage } = await import("@/lib/prompts/system-pages");
  for (const x of ["properties", "subtasks", "suggested", "page", "todos"]) assert.ok((d.BLOCK_MODULES as readonly string[]).includes(x), `${x} is a block`);
  const status: import("@/plugins/workspace/model").Property = { id: "st", name: "Status", type: "status", options: [] };
  const db = w.createPage({ kind: "database", title: "Projekte", schema: { titleName: "Name", properties: [status], views: [{ ...m.newView("Board", "board"), groupBy: "st" }] } });
  const id = ensureDetailPage(db);
  assert.equal(w.getDatabase(db)!.schema.detailPage, id);
  assert.ok(isSystemPage(id), "protected");
  const page = w.getPage(id)!;
  assert.equal(page.title, "Projekte");
  const modules = (page.content.content ?? []).filter((n) => n.type === "zeffModule").map((n) => n.attrs?.module);
  assert.deepEqual(modules, m.detailModules(w.getDatabase(db)!.schema, null), "from what it showed");
  assert.equal(ensureDetailPage(db), id, "once");
  const clean = d.sanitizeDoc({ type: "doc", content: [{ type: "zeffModule", attrs: { module: "properties", key: "" } }] }) as { content: { attrs?: { module?: string } }[] };
  assert.equal(clean.content[0].attrs?.module, "properties", "kept by sanitize");
});
