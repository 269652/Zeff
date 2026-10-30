import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Notes in the Lage: per ticket, the notes its open todos came from and those naming it — from
 * your Keep boards in the Lage and Google Keep, newest first, at most six.
 */
test("lage: a ticket's notes — linked by its todos or naming it, from boards in the Lage", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const k = await import("@/plugins/keep/boards");
  const g = await import("@/plugins/keep/store");
  const { addNoteTodo } = await import("@/lib/boards/store");
  const { lageNoteLines } = await import("@/plugins/keep/lage");

  const b = k.createKeepBoard({ name: "Arbeit" });
  const off = k.createKeepBoard({ name: "Privat" });
  k.updateKeepBoard(off, { inLage: false });
  const naming = k.createOwnNote(b, { title: "Idee", text: "Für PROJ-12 den Export prüfen" });
  k.createOwnNote(b, { title: "Andere", text: "PROJ-123 ist ein anderes Ticket" });
  k.createOwnNote(off, { title: "Privat", text: "PROJ-12 auch hier" });
  const linked = k.createOwnNote(off, { title: "Verknüpft", text: "ohne Schlüssel" });
  g.saveKeepNotes([{ id: "g1", kind: "note", title: "", text: "proj-12 aus Google", labels: [], color: null, pinned: false, archived: false, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-02T00:00:00Z", url: "https://keep.google.com/#NOTE/g1" }], true);
  addNoteTodo({ ticket: "PROJ-12", text: "Export prüfen", kind: "task", refs: [linked.ref], runId: null });

  const lines = lageNoteLines("PROJ-12", 200, cut);
  assert.match(lines[0], /^Notizen zu PROJ-12 /);
  const body = lines.slice(1).join("\n");
  assert.match(body, new RegExp(`\\[${naming.ref}\\] .* \\(Arbeit\\) „Idee“ — Für PROJ-12 den Export prüfen`));
  assert.match(body, new RegExp(`\\[${linked.ref}\\] .* \\(Privat\\) „Verknüpft“`), "linked by an open todo: in, whatever its board");
  assert.match(body, /\[keep:g1\] 2020-01-02 \(Google Keep\) „\(ohne Titel\)“ — proj-12 aus Google/);
  assert.doesNotMatch(body, /PROJ-123|PROJ-12 auch hier/, "another ticket; a board not in the Lage");
  assert.equal(lines.length, 4);
  assert.match(lines.at(-1)!, /keep:g1/, "newest first: the old Google note last");

  assert.deepEqual(lageNoteLines("PROJ-99", 200, cut), [], "nothing about it: no lines");
  setInstalled("workspace", false);
  assert.deepEqual(lageNoteLines("PROJ-12", 200, cut), [], "the Workspace not installed: no notes");
});

/** Any collection in the briefing brings its notes — not boards: their cards are tickets in the Lage themselves. */
test("lage: notes come from every collection in the briefing, not from boards", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const { collectionProviders } = await import("@/lib/items/point");
  const { lageNoteLines } = await import("@/plugins/keep/lage");
  setInstalled("workspace", true);
  setInstalled("signal", true);
  const item = (ref: string, collectionId: string, text: string) => ({ ref, key: null, collectionId, kind: "row" as const, title: ref, text, labels: [], status: null, due: null, assignee: null, color: null, pinned: false, archived: false, parentRef: null, href: "/x", createdAt: null, updatedAt: "2030-01-01T00:00:00Z" });
  const col = (id: string, kind: "notes" | "board" | "database", briefing: boolean) => ({ id, plugin: "signal", kind, name: `Sammlung ${id}`, description: "", color: null, href: "/x", readOnly: true, briefing, knowledge: false, items: 1 });
  const cols = [col("db", "database", true), col("off", "database", false), col("cards", "board", true)];
  const items = [item("page:1", "db", "zu PROJ-77"), item("page:2", "off", "PROJ-77 aus"), item("X-1", "cards", "PROJ-77 Karte")];
  collectionProviders.contribute("signal", {
    collections: () => cols,
    items: (id) => (cols.some((c) => c.id === id) ? items.filter((i) => i.collectionId === id) : null),
    byRefs: (refs) => items.filter((i) => refs.includes(i.ref)),
    set: () => false,
    byKeys: () => [],
    act: () => null,
  });

  const lines = lageNoteLines("PROJ-77", 200, cut);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[1], /\[page:1\] 2030-01-01 \(Sammlung db\) „page:1“ — zu PROJ-77/);
  setInstalled("signal", false);
});
