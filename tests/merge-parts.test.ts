import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * An update merged per field and line (plugins/workspace/merge-parts.ts, docs/zeff-kernel.md): what only the update changed comes in,
 * what only you changed stays, where both changed the same thing yours stays and the spot is named — fields, views and flow steps
 * matched by their ids, a page's text block by block.
 */

test("one value, an object, a list by ids", async () => {
  const { merge3, mergeById } = await import("@/plugins/workspace/merge-parts");
  assert.deepEqual(merge3(1, 1, 2, "x"), { value: 2, conflicts: [], took: ["x"] });
  assert.deepEqual(merge3(1, 3, 1, "x"), { value: 3, conflicts: [], took: [] });
  assert.deepEqual(merge3(1, 3, 2, "x"), { value: 3, conflicts: [{ where: "x" }], took: [] });
  // Objects: inside, key by key.
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }, "o").value, { a: 2, b: 3 });
  const base = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  const mine = [{ id: "b", name: "B" }, { id: "a", name: "Mine" }, { id: "c", name: "C changed" }, { id: "m", name: "My own" }];
  const theirs = [{ id: "a", name: "A" }, { id: "n", name: "New" }, { id: "b", name: "B2" }];
  const r = mergeById(base, mine, theirs, "fields");
  // b updated, a stays mine, c (dropped by the update, changed by me) stays as a conflict, m stays, n added after a (where the update has it).
  assert.deepEqual(r.value.map((x) => x.name), ["B2", "Mine", "New", "C changed", "My own"]);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].where, /C/);
});

test("a page's text: block by block", async () => {
  const { mergeDoc } = await import("@/plugins/workspace/merge-parts");
  const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const base = { content: [p("one"), p("two"), p("three")] };
  const mine = { content: [p("ONE (mine)"), p("two"), p("three")] };
  const theirs = { content: [p("one"), p("two"), p("three (new)"), p("four")] };
  const r = await mergeDoc(base, mine, theirs, "text");
  assert.deepEqual(r.value.content, [p("ONE (mine)"), p("two"), p("three (new)"), p("four")]);
  assert.deepEqual(r.conflicts, []);
  const both = await mergeDoc(base, { content: [p("mine"), p("two"), p("three")] }, { content: [p("theirs"), p("two"), p("three")] }, "text");
  assert.deepEqual(both.value.content, [p("mine"), p("two"), p("three")], "both changed the same block: yours stays");
  assert.equal(both.conflicts.length, 1);
});

test("an app update: your changes stay, the update's come in, both on one thing: yours, said", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const life = await import("@/plugins/workspace/package-life");
  const flows = await import("@/plugins/workspace/flows/store");
  const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const doc = (...t: string[]) => ({ type: "doc", content: t.map(p) });
  const view = { id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] };
  const pkg = (version: string, props: unknown[], text: string[], nodes: unknown[]) => ({
    format: 1 as const,
    id: "mergeapp",
    name: "Merge app",
    version,
    items: [
      { id: "i1", kind: "page", title: "Merge app", content: doc(...text) },
      { id: "i2", parent: "i1", kind: "database", title: "Items", schema: { titleName: "Name", properties: props, views: [view] } },
      { id: "i3", parent: "i1", kind: "page", title: "Go", flow: { name: "mergeapp.go", title: "Go", nodes, permissions: {} } },
    ],
  });
  const n = (id: string, template: string) => ({ id, kind: "action", action: "text.template", input: { template } });
  await life.installTracked(pkg("1.0.0", [{ id: "a", name: "Colour", type: "text" }, { id: "b", name: "Size", type: "text" }], ["Intro", "Middle", "End"], [n("s1", "one"), n("s2", "two")]) as never, null);
  const inst = life.getInstalled("mergeapp")!;
  const [root, db, flowPage] = [inst.map.i1, inst.map.i2, inst.map.i3];

  // Yours: the first field renamed, a field of your own, the intro rewritten, the first step changed.
  const s = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s, properties: [...s.properties.map((x) => (x.id === "a" ? { ...x, name: "Farbe" } : x)), { id: "mine", name: "Notes", type: "text" } as never] });
  w.updatePage(root, { content: doc("My intro", "Middle", "End") as never });
  const f = flows.getFlow(flowPage)!;
  flows.saveFlow(flowPage, { ...f, nodes: f.nodes.map((x) => (x.id === "s1" ? (n("s1", "mine") as never) : x)) });

  // The update: the first field renamed too (both!), the second one's type changed, a field added; the end rewritten, a paragraph
  // added; a step added.
  const r = await life.updateTracked("mergeapp", pkg("2.0.0", [{ id: "a", name: "Hue", type: "text" }, { id: "b", name: "Size", type: "number" }, { id: "c", name: "Price", type: "number" }], ["Intro", "Middle", "The end", "PS"], [n("s1", "one"), n("s2", "two"), n("s3", "three")]) as never);

  const props = w.getDatabase(db)!.schema.properties;
  assert.equal(props.find((x) => x.id === "a")!.name, "Farbe", "both renamed it: yours stays");
  assert.equal(props.find((x) => x.id === "b")!.type, "number", "only the update changed it: it comes in");
  assert.ok(props.some((x) => x.id === "c"), "a field the update adds");
  assert.ok(props.some((x) => x.id === "mine"), "a field of your own");
  const text = JSON.stringify(w.getPage(root)!.content);
  assert.match(text, /My intro/);
  assert.match(text, /The end/);
  assert.match(text, /PS/);
  const steps = flows.getFlow(flowPage)!.nodes as { id: string; input?: { template?: string } }[];
  assert.deepEqual(steps.map((x) => [x.id, x.input?.template]), [["s1", "mine"], ["s2", "two"], ["s3", "three"]]);
  assert.equal(r.conflicts?.length, 1);
  assert.match(r.conflicts![0], /name/);
});
