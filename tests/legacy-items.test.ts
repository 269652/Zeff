import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** What an earlier version left behind (items under a group entry, their entries removed) comes back as entries — nothing lost. */
test("legacy items under a group entry become entries again, with their evidence", async () => {
  const { getDb, getSqlite, schema } = await import("@/db");
  const { createJob } = await import("@/lib/jobs");
  const { createEntry, getEntry, listEntries } = await import("@/lib/entries");
  const { convertLegacyItems } = await import("@/db/legacy-items");
  const { addFollowUp } = await import("@/lib/boards/store");
  const { eq } = await import("drizzle-orm");
  createJob({ number: "300001", name: "Relaunch" });
  const day = "2026-12-01";
  const head = createEntry({ jobNumber: "300001", date: day, hours: 8, description: "PROJ | Mob Programming Tag", isGroup: true, start: "09:30" }, "calendar");
  const todo = addFollowUp({ ticket: "PROJ-415", text: `Antworten ${Math.random().toString(36).slice(2, 8)} abcxyz`, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  getDb().update(schema.todos).set({ entryId: head.id }).where(eq(schema.todos.id, todo.id)).run();
  const sqlite = getSqlite();
  sqlite.prepare("insert into entry_items (entry_id, date, hours, start, parallel, description, ticket, type, tags, reported_by, todo_ids, run_ids, time_ids, suggestion_id, source, created_at) values (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, '[]', '[]', NULL, 'day', ?)").run(head.id, day, 0.25, null, "Jonas antworten", "PROJ-415", "ticket", JSON.stringify(["typo3"]), "web", JSON.stringify([todo.id]), "2026-12-01T08:00:00.000Z");

  assert.equal(convertLegacyItems(sqlite), 1);
  assert.equal(convertLegacyItems(sqlite), 0, "once");
  const entries = listEntries({ from: day, to: day });
  assert.equal(entries.length, 2);
  const member = entries.find((e) => e.id !== head.id)!;
  assert.deepEqual([member.description, member.ticket, member.hours, member.workedHours, member.type, member.tags.map((t) => t.name)], ["Jonas antworten", "PROJ-415", 0, 0.25, "ticket", ["typo3"]]);
  assert.equal(member.jobId, head.jobId);
  // In the group's span (collecting, the group's hours untouched), its todo pointing at it.
  const span = sqlite.prepare("select id, mode from entry_spans where head_id = ?").get(head.id) as { id: string; mode: string };
  assert.equal(member.spanId, span.id);
  assert.equal(span.mode, "collect");
  assert.equal(getEntry(head.id)!.hours, 8);
  assert.equal(getDb().select().from(schema.todos).all().find((t) => t.id === todo.id)?.entryId, member.id);
  assert.equal((sqlite.prepare("select count(*) n from entry_items").get() as { n: number }).n, 0);
});
