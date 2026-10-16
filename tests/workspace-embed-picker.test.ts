import assert from "node:assert/strict";
import test from "node:test";

/** The picker for "Embed page": the pages below this one first, then the rest; the page itself never; filtered by what is typed. */
const item = (id: number, title: string, parentId: number | null = null, kind: "page" | "database" = "page") => ({ id, parentId, kind, title, icon: "", favorite: false, position: id });

test("embedChoices: below this page first, the page itself left out, filtered by title", async () => {
  const { embedChoices } = await import("@/plugins/workspace/embed-picker");
  const all = [item(1, "Projekt"), item(2, "Notizen", 1), item(3, "Aufgaben", 1, "database"), item(4, "Archiv"), item(5, "Notizen alt", 4), item(6, "Tief", 2)];
  const r = embedChoices(all, 1, "");
  assert.deepEqual(r.below.map((x) => x.id), [2, 3, 6], "its sub-pages, deeper ones too");
  assert.deepEqual(r.other.map((x) => x.id), [4, 5], "everything else, not the page itself");
  const q = embedChoices(all, 1, "notiz");
  assert.deepEqual([q.below.map((x) => x.id), q.other.map((x) => x.id)], [[2], [5]]);
  assert.deepEqual(embedChoices(all, 1, "  AUFGABEN ").below.map((x) => x.kind), ["database"]);
});

test("embedChoices: a page below another is not offered inside its own embed loop - the page's ancestors are left out", async () => {
  const { embedChoices } = await import("@/plugins/workspace/embed-picker");
  const all = [item(1, "Root"), item(2, "Mitte", 1), item(3, "Hier", 2), item(4, "Nachbar", 1)];
  const r = embedChoices(all, 3, "");
  assert.deepEqual(r.other.map((x) => x.id), [4], "the parents (1, 2) would show this page inside itself");
  assert.deepEqual(r.below, []);
});
