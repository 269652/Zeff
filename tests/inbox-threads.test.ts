import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const row = (id: number, conv: string, when: string, cells: Record<string, unknown> = {}) => ({ id, title: `m${id}`, icon: "", createdAt: "", updatedAt: "", cells: { commconv: conv, commwhen: when, ...cells } });

/** The inbox's list is by conversation: one entry per thread (its latest message, how many, how many unread); a snoozed thread is away until its time. */
test("threads: one entry per conversation — latest first, counts, unread", async () => {
  const { groupThreads } = await import("@/plugins/mail-client/threads");
  const rows = [row(1, "A", "2026-10-16T08:00"), row(2, "A", "2026-10-16T10:00", { communread: true }), row(3, "B", "2026-10-16T09:00"), row(4, "", "2026-10-16T07:00"), row(5, "", "2026-10-16T06:00")];
  const { threads } = groupThreads(rows as never, Date.parse("2026-10-16T12:00"));
  assert.deepEqual(threads.map((t) => [t.head.id, t.count, t.unread]), [[2, 2, 1], [3, 1, 0], [4, 1, 0], [5, 1, 0]], "A by its latest; rows without a conversation each their own");
  assert.deepEqual(threads[0].ids.sort(), [1, 2]);
});

test("snooze: a thread whose messages are all snoozed is away until its time — a new message brings it back", async () => {
  const { groupThreads } = await import("@/plugins/mail-client/threads");
  const later = "2026-10-17T08:00:00.000Z";
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const rows = [row(1, "A", "2026-10-16T08:00", { commsnooze: later }), row(2, "A", "2026-10-16T09:00", { commsnooze: later }), row(3, "B", "2026-10-16T10:00", { commsnooze: later })];
  const a = groupThreads(rows as never, now);
  assert.deepEqual(a.threads, [], "all away");
  assert.equal(a.snoozed, 2, "two threads snoozed");
  const fresh = groupThreads([...rows, row(4, "A", "2026-10-16T11:00")] as never, now);
  assert.deepEqual(fresh.threads.map((t) => t.head.id), [4], "a new message of A is not snoozed: the thread is back");
  const over = groupThreads(rows as never, Date.parse("2026-10-17T09:00:00.000Z"));
  assert.equal(over.threads.length, 2, "the time has come");
  assert.equal(over.snoozed, 0);
});

test("snoozeUntil: the options — later today, tomorrow morning, next week", async () => {
  const { snoozeUntil } = await import("@/plugins/mail-client/threads");
  const now = new Date(2026, 9, 16, 10, 30); // a Friday
  const at = (iso: string) => new Date(iso);
  assert.equal(at(snoozeUntil("later", now)).getHours(), 13);
  assert.equal(at(snoozeUntil("tomorrow", now)).getDate(), 17);
  assert.equal(at(snoozeUntil("tomorrow", now)).getHours(), 8);
  const w = at(snoozeUntil("week", now));
  assert.deepEqual([w.getDay(), w.getDate(), w.getHours()], [1, 19, 8], "next Monday morning");
});
