import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Any of Zeff's and the Workspace's functions as an auto action: the Workspace's methods (a row added or changed by its
 * database's and fields' names, a page made or written on) and todos.add are offered to the AI ("zeff-do") — with the
 * databases and their fields as context; run from a todo or a row with one click.
 */
test("workspace methods offered: rows added and changed by names, pages made and written on — as zeff-do, from a row too", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { offeredMethods } = await import("@/plugins/actions/server");
  const { docText } = await import("@/plugins/workspace/doc");
  const offered = offeredMethods();
  for (const name of ["workspace.rows.add", "workspace.rows.update", "workspace.pages.create", "workspace.pages.append", "todos.add"]) assert.ok(offered[name], `${name} offered`);

  const status: import("@/plugins/workspace/model").Property = { id: "st", name: "Status", type: "status", options: [{ id: "o1", name: "Offen", color: "gray", group: "todo" }] };
  const due: import("@/plugins/workspace/model").Property = { id: "due", name: "Fällig", type: "date" };
  const db = w.createPage({ kind: "database", title: "Rezepte", schema: { titleName: "Name", properties: [status, due], views: [m.newView("Table")] } });
  const ctx = await offered["workspace.rows.add"].offer.context!({ ticket: "", text: "Rezept" });
  assert.ok(ctx.some((l) => l.includes("Rezepte") && l.includes("Status") && l.includes("Offen")), "the databases and their fields as context");

  const add = offered["workspace.rows.add"];
  const p = add.offer.check({ database: "rezepte", title: "Pfannkuchen", fields: '{"Status": "Erledigt", "Fällig": "2026-10-20"}', markdown: "Mehl, Eier, Milch" });
  assert.ok(p, "checked");
  assert.match(add.offer.describe(p!).title, /Pfannkuchen/);
  await add.run(p!, { plugin: "test", has: () => true } as never);
  const row = w.rawRows(db).find((r) => r.title === "Pfannkuchen")!;
  const opt = w.getDatabase(db)!.schema.properties.find((x) => x.id === "st")!.options!.find((o) => o.id === row.cells.st);
  assert.equal(opt?.name, "Erledigt", "a status by its name — made when new");
  assert.equal(row.cells.due, "2026-10-20");
  assert.match(docText(w.getPage(row.id)!.content), /Mehl, Eier, Milch/);
  assert.equal(add.offer.check({ database: "Gibt es nicht", title: "x" }), null, "no such database: dropped");

  const upd = offered["workspace.rows.update"];
  await upd.run(upd.offer.check({ database: "Rezepte", row: "pfannkuchen", fields: '{"Status": "Offen"}', markdown: "Zucker nicht vergessen." })!, { plugin: "test", has: () => true } as never);
  assert.equal(w.getPage(row.id)!.props.st, "o1");
  assert.match(docText(w.getPage(row.id)!.content), /Zucker nicht vergessen/);

  const make = offered["workspace.pages.create"];
  const r = (await make.run(make.offer.check({ title: "Einkauf", markdown: "- Milch" })!, { plugin: "test", has: () => true } as never)) as { id: number };
  const app = offered["workspace.pages.append"];
  await app.run(app.offer.check({ page: "Einkauf", markdown: "- Brot" })!, { plugin: "test", has: () => true } as never);
  assert.match(docText(w.getPage(r.id)!.content), /Milch[\s\S]*Brot/);

  // From a row (a mail's, say): zeff-do runs it.
  const { runRowAction } = await import("@/plugins/workspace/row-actions");
  const out = await runRowAction(row.id, { type: "zeff-do", method: "workspace.pages.append", args: JSON.stringify({ page: "Einkauf", markdown: "- Butter" }) });
  assert.ok(out.what);
  assert.match(docText(w.getPage(r.id)!.content), /Butter/);
});
