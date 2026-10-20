import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A time entry's "Report" is what goes into the booking; its Comment is a note of your own on it — kept with the entry, shown beside it,
 * never part of the booking's text unless you put it there.
 */
test("an entry keeps a comment of its own beside its report text; it can be changed and cleared", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { createEntry, updateEntry, listEntries, getEntry } = await import("@/lib/entries");
  createJob({ number: "100300", name: "Kommentar" });
  const e = createEntry({ jobNumber: "100300", date: "2026-10-19", hours: 1.5, description: "Footer umbauen", comment: "  Kunde wollte es erst anders — siehe Chat  " } as never, "web");
  assert.equal(e.description, "Footer umbauen");
  assert.equal(e.comment, "Kunde wollte es erst anders — siehe Chat", "trimmed");
  assert.equal(listEntries().find((x) => x.id === e.id)!.comment, "Kunde wollte es erst anders — siehe Chat");

  const none = createEntry({ jobNumber: "100300", date: "2026-10-19", hours: 1, description: "Ohne" } as never, "web");
  assert.equal(none.comment, null);

  updateEntry(e.id, { comment: "Neu gefasst" } as never);
  assert.equal(getEntry(e.id)!.comment, "Neu gefasst");
  assert.equal(getEntry(e.id)!.description, "Footer umbauen", "the report text is untouched");
  updateEntry(e.id, { comment: null } as never);
  assert.equal(getEntry(e.id)!.comment, null, "cleared");
  updateEntry(e.id, { description: "Footer fertig" } as never);
  assert.equal(getEntry(e.id)!.comment, null);
});
