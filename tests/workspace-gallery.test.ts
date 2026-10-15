import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A note's card in the gallery, as Keep shows it: its text and checklist (to tick in place), pinned on top. */
test("previewLines: a page as a card's preview — text lines and checklist items with their place", async () => {
  const d = await import("@/plugins/workspace/doc");
  const doc = d.markdownToDoc("Einkauf für Samstag\n\n- [ ] Milch\n- [x] Brot\n\nNoch was");
  assert.deepEqual(d.previewLines(doc), [
    { kind: "text", text: "Einkauf für Samstag" },
    { kind: "task", text: "Milch", checked: false, index: 0 },
    { kind: "task", text: "Brot", checked: true, index: 1 },
    { kind: "text", text: "Noch was" },
  ]);
  assert.equal(d.previewLines(doc, 2).length, 2, "at most so many lines");
  const ticked = d.toggleTask(doc, 0, true);
  assert.deepEqual(d.previewLines(ticked).filter((l) => l.kind === "task").map((l) => (l as { checked: boolean }).checked), [true, true]);
  assert.deepEqual(d.previewLines(d.toggleTask(doc, 5, true)), d.previewLines(doc), "no such item: as it was");
});

test("ticking a note's checklist item on its card changes its page", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const d = await import("@/plugins/workspace/doc");
  const a = await import("@/plugins/workspace/actions");
  const dbId = w.createPage({ kind: "database", title: "Notizen" });
  const row = w.addRow(dbId, { title: "Einkauf" });
  w.updatePage(row, { content: d.markdownToDoc("- [ ] Milch\n- [ ] Eier") });
  const loaded = await a.loadDatabaseAction(dbId);
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.data.extras.previews[row].map((l) => l.text), ["Milch", "Eier"], "the card's preview comes with the data");
  assert.ok((await a.toggleTaskAction(row, 1, true)).ok);
  assert.match(d.docToMarkdown(w.getPage(row)!.content), /- \[ \] Milch\n- \[x\] Eier/);
});

test("splitPinned: the pinned notes first, as their own group", async () => {
  const m = await import("@/plugins/workspace/model");
  const row = (id: number, pinned?: boolean) => ({ id, title: `R${id}`, icon: "", cells: pinned ? { pinned: true } : {}, createdAt: "", updatedAt: "" });
  const { pinned, others } = m.splitPinned([row(1), row(2, true), row(3), row(4, true)]);
  assert.deepEqual(pinned.map((r) => r.id), [2, 4]);
  assert.deepEqual(others.map((r) => r.id), [1, 3]);
});
