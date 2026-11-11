import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Blocks of your own, the gaps closed: versions, a widget as a block, blocks carried by packages (and plugins made from them). */

const widgetBlock = {
  name: "calc.sum",
  description: "A sum in a widget",
  params: [{ name: "values", type: "list" }, { name: "label", type: "text", default: "Sum" }],
  widget: { html: "<div id=r></div><script>document.getElementById('r').textContent=(zeff.context.params||{}).label</script>", libs: [], height: 200 },
};

test("a block keeps every change as a version and an old one comes back", async () => {
  const s = await import("@/plugins/workspace/block-store");
  s.saveBlock({ name: "ver.card", description: "v", template: "<b>one</b>" });
  s.saveBlock({ name: "ver.card", description: "v", template: "<b>one</b>" }); // (same: not again)
  s.saveBlock({ name: "ver.card", description: "v", template: "<b>two</b>" }, { source: "ai", note: "made bold two" });
  const vs = s.listBlockVersions("ver.card");
  assert.deepEqual(vs.map((v) => [v.n, v.source]), [[2, "ai"], [1, "first"]]);
  s.restoreBlockVersion("ver.card", 1);
  assert.equal(s.getBlock("ver.card")!.template, "<b>one</b>");
  assert.equal(s.listBlockVersions("ver.card")[0].source, "restore");
  await s.deleteBlock("ver.card");
  assert.ok(s.removedBlocks().some((r) => r.name === "ver.card"));
  s.restoreBlockVersion("ver.card", 3);
  assert.ok(s.getBlock("ver.card"));
  assert.ok(!s.removedBlocks().some((r) => r.name === "ver.card"));
});

test("a widget block: checked, drawn as an appwidget with its parameters", async () => {
  const { normalizeBlock } = await import("@/plugins/workspace/blocks");
  assert.throws(() => normalizeBlock({ name: "bad", description: "", template: "<b/>", widget: widgetBlock.widget }), /not both/);
  assert.throws(() => normalizeBlock({ name: "bad", description: "" }), /template .* or a widget/);
  assert.throws(() => normalizeBlock({ name: "bad", description: "", widget: { html: "<base href=x>" } }), /base/);
  const b = normalizeBlock(widgetBlock);
  assert.equal(b.template, "");
  assert.equal(b.widget!.height, 200);
  const { renderView } = await import("@/plugins/workspace/view-template");
  const r = renderView('<use block="calc.sum" label="Total"/>', { rows: [{ id: 1, title: "A", icon: "", cells: { n: 5 }, createdAt: "", updatedAt: "" }] as never, props: [{ id: "n", name: "N", type: "number" }] as never, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "D" } }, { blocks: [b] });
  assert.deepEqual(r.errors, []);
  const w = r.nodes[0] as { t: string; a: Record<string, string> };
  assert.equal(w.t, "appwidget");
  assert.equal(w.a.block, "calc.sum");
  assert.equal(JSON.parse(w.a.params).label, "Total");
  const { checkBlock } = await import("@/plugins/workspace/block-check");
  assert.deepEqual(checkBlock(widgetBlock).errors, []);
});

test("a package carries the blocks its views use, with their flows", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const s = await import("@/plugins/workspace/block-store");
  const pk = await import("@/plugins/workspace/packages");
  const fs = await import("@/plugins/workspace/flows/store");
  const root = w.createPage({ title: "App" });
  s.saveBlock({ name: "pk.inner", description: "inner", template: "<b>inner</b>" });
  s.saveBlock({ name: "pk.outer", description: "outer", template: '<use block="pk.inner"/><button run="@go">Go</button>' });
  fs.createFlow({ name: "block.pk.outer.go", title: "go", nodes: [], permissions: {} }, s.blocksFolder());
  const db = w.createPage({ parentId: root, kind: "database", title: "Things" });
  const schema = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...schema, views: [...schema.views, { ...schema.views[0], id: "v2", name: "Mine", template: '<use block="pk.outer"/>' }] });
  const pkg = pk.exportPackage(root, { name: "App" });
  assert.deepEqual((pkg.blocks ?? []).map((b) => b.def.name).sort(), ["pk.inner", "pk.outer"]);
  assert.equal((pkg.blocks ?? []).find((b) => b.def.name === "pk.outer")!.flows?.length, 1);
  // Installed where the blocks are gone: they come back; where they exist: left alone.
  await s.deleteBlock("pk.outer", { flows: true });
  await s.deleteBlock("pk.inner");
  assert.ok(!fs.flowByName("block.pk.outer.go"));
  pk.installPackage(JSON.parse(JSON.stringify(pkg)), null);
  assert.equal(s.getBlock("pk.inner")!.template, "<b>inner</b>");
  assert.ok(s.getBlock("pk.outer"));
  assert.ok(fs.flowByName("block.pk.outer.go"));
  s.saveBlock({ name: "pk.inner", description: "inner", template: "<b>mine</b>" });
  pk.installPackage(JSON.parse(JSON.stringify(pkg)), null);
  assert.equal(s.getBlock("pk.inner")!.template, "<b>mine</b>");
});
