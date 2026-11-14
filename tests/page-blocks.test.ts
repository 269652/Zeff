import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A block of your own right in a page (no database around it): kept in the page as `:::use name {params}`, packed with the page when
 * it is exported, brought by a package — and by its update, where a block you left as it came takes the new version and one you
 * changed stays yours.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return { w: await import("@/plugins/workspace/store"), doc: await import("@/plugins/workspace/doc"), bs: await import("@/plugins/workspace/block-store") };
}

const block = (template: string) => ({ name: "pb.hello", title: "Hello", description: "Says hello.", params: [{ name: "who", type: "text" }], template, example: '<use block="pb.hello" who="you"/>' });

test("in a page: as Markdown and back; a wrong name or parameters are left out", async () => {
  const { doc } = await world();
  const d = doc.sanitizeDoc(doc.markdownToDoc(':::use pb.hello {"who":"Ann","n":3}\n\nText'));
  assert.deepEqual(d.content![0], { type: "zeffBlock", attrs: { block: "pb.hello", params: JSON.stringify({ who: "Ann", n: "3" }) } });
  assert.equal(doc.docToMarkdown(d).split("\n")[0], ':::use pb.hello {"who":"Ann","n":"3"}');
  const bad = doc.sanitizeDoc({ type: "doc", content: [{ type: "zeffBlock", attrs: { block: "Not A Name", params: '{"x":{"deep":1}}' } }] } as never);
  assert.deepEqual(bad.content![0].attrs, { block: "", params: "{}" });
});

test("exported with the page; installed and updated with a package — yours stays", async () => {
  const { w, doc, bs } = await world();
  bs.saveBlock(block("<text>Hello {{ props.who }}</text>"));
  const page = w.createPage({ title: "Home" });
  w.updatePage(page, { content: doc.markdownToDoc(":::use pb.hello {\"who\":\"Ann\"}") });
  const { exportPackage } = await import("@/plugins/workspace/packages");
  const pkg = exportPackage(page, { name: "Home" });
  assert.deepEqual(pkg.blocks?.map((b) => b.def.name), ["pb.hello"], "the block a page uses goes with it");

  const life = await import("@/plugins/workspace/package-life");
  const versioned = (version: string, template: string) => ({ format: 1 as const, id: "pbapp", name: "PB", version, items: [{ id: "i1", kind: "page", title: "PB", content: doc.markdownToDoc(":::use pb.hello") }], blocks: [{ def: block(template) }] });
  // (the block is there already as the package's 1.0.0 has it)
  bs.saveBlock(block("<text>v1</text>"));
  await life.installTracked(versioned("1.0.0", "<text>v1</text>") as never, null);
  const r = await life.updateTracked("pbapp", versioned("1.1.0", "<text>v2</text>") as never);
  assert.equal(bs.getBlock("pb.hello")!.template, "<text>v2</text>", "a block left as it came takes the new version");
  assert.ok(r.changes.some((c) => c.includes("block “pb.hello” updated")), r.changes.join("|"));
  bs.saveBlock(block("<text>mine</text>"));
  const r2 = await life.updateTracked("pbapp", versioned("1.2.0", "<text>v3</text>") as never);
  assert.equal(bs.getBlock("pb.hello")!.template, "<text>mine</text>", "a block you changed stays yours");
  assert.ok(r2.kept.some((k) => k.includes("pb.hello")));
  // A block the package brings that is not there yet is made.
  assert.ok(await bs.deleteBlock("pb.hello"));
  await life.updateTracked("pbapp", versioned("1.3.0", "<text>v4</text>") as never);
  assert.equal(bs.getBlock("pb.hello")!.template, "<text>v4</text>");
});
