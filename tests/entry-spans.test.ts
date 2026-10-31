import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const mk = async (date: string, description: string, ticket: string | null, start: string | undefined, hours: number, job = "300001") => {
  const { createEntry } = await import("@/lib/entries");
  return createEntry({ jobNumber: job, date, hours, description, ticket: ticket ?? undefined, start }, "web");
};
const dayHours = async (date: string) => {
  const { listEntries } = await import("@/lib/entries");
  return Math.round(listEntries({ from: date, to: date }).reduce((s, e) => s + e.hours, 0) * 100) / 100;
};
const row = async (id: number) => (await import("@/lib/entries")).getEntry(id);
const setup = async () => {
  const { createJob } = await import("@/lib/jobs");
  for (const [n, name] of [["300001", "Relaunch"], ["300002", "Anderes"]]) {
    try {
      createJob({ number: n, name });
    } catch {
      // (made by an earlier test of this file)
    }
  }
};

/** A mob day: the 8 h entry is yours and is NEVER rewritten; the tasks keep everything and book 0 under it. */
test("a collecting entry books the hours; the tasks stay whole and nothing is rewritten", async () => {
  await setup();
  const { createEntry, deleteEntry, updateEntry } = await import("@/lib/entries");
  const { collectIntoHead, collectHeadsOn, autoGroup } = await import("@/lib/entry-parallel");
  const { spanOfHead, setSpanMode, dissolveSpan, unlinkMember, linkMember, getSpan, createSpan } = await import("@/lib/entry-spans");
  const { getDb, schema } = await import("@/db");
  const day = "2026-11-03";
  const jonas = await mk(day, "Jonas antworten", "PROJ-415", "10:00", 0.25);
  const noStart = await mk(day, "Ohne Start", "PROJ-3", undefined, 0.5);
  const evening = await mk(day, "Abends", null, "18:30", 1);
  const { addFollowUp } = await import("@/lib/todos/store");
  const todo = addFollowUp({ ticket: "PROJ-415", text: "Antworten", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  getDb().update(schema.todos).set({ entryId: jonas.id }).where(eq(schema.todos.id, todo.id)).run();

  const mob = createEntry({ jobNumber: "300001", date: day, hours: 8, description: "PROJ | Mob Programming Tag", isGroup: true, start: "09:30" }, "calendar");
  assert.equal(spanOfHead(mob.id)?.mode, "collect");
  assert.equal(collectHeadsOn(day)[0].head.id, mob.id);
  assert.equal(collectIntoHead(mob.id), 2); // Jonas (10:00) and the one without a start; the evening one is outside the window
  assert.deepEqual([(await row(jonas.id))!.hours, (await row(jonas.id))!.workedHours], [0, 0.25]);
  assert.deepEqual([(await row(noStart.id))!.hours, (await row(noStart.id))!.workedHours], [0, 0.5]);
  assert.equal((await row(evening.id))!.spanId, null);
  assert.equal(await dayHours(day), 9); // 8 (the head) + 1 (the evening): the grouped tasks book nothing
  // Everything of the task is where it was: same entry, its evidence, its words, its start.
  const j = (await row(jonas.id))!;
  assert.deepEqual([j.description, j.ticket, j.start], ["Jonas antworten", "PROJ-415", "10:00"]);
  assert.equal(getDb().select().from(schema.todos).all().find((x) => x.id === todo.id)?.entryId, jonas.id);
  const headBefore = (await row(mob.id))!;

  // THE BUG: a collecting entry of yours is never rewritten. Every way of booking is there for it now — they change only what it
  // and its tasks BOOK (its total, 8 h, is kept) — and each can be switched back.
  const spanId = spanOfHead(mob.id)!.id;
  const same = async () => {
    const h = (await row(mob.id))!;
    return [h.description, h.ticket, h.start, h.workedHours, h.isGroup];
  };
  const kept = JSON.stringify(await same());
  const books = async () => [(await row(mob.id))!.hours, (await row(jonas.id))!.hours, (await row(noStart.id))!.hours];
  setSpanMode(spanId, "remainder"); // the tasks book what they worked, the group the time that is left
  assert.deepEqual(await books(), [7.25, 0.25, 0.5]);
  assert.equal(await dayHours(day), 9);
  setSpanMode(spanId, "divide"); // the group's 8 h divided over its tasks
  const [h1, j1, n1] = await books();
  assert.equal(h1, 0);
  assert.equal(Math.round((j1 + n1) * 100) / 100, 8);
  setSpanMode(spanId, "sequential"); // the tasks book what they worked; the group nothing
  assert.deepEqual(await books(), [0, 0.25, 0.5]);
  assert.equal(await dayHours(day), 1.75);
  setSpanMode(spanId, "combine"); // "book all on group" again
  assert.deepEqual(await books(), [8, 0, 0]);
  assert.equal(await dayHours(day), 9);
  assert.equal(JSON.stringify(await same()), kept, "nothing of the collecting entry was rewritten");
  assert.equal(getSpan(spanId)!.mode, "collect");
  // Booking the remainder needs a collecting entry: a span of tasks only has none.
  assert.throws(() => setSpanMode(createSpan(day, "divide").id, "remainder"), /collecting entry/);

  // The switch: out of the group the task books what it worked; back in it books 0 again.
  unlinkMember(jonas.id);
  assert.equal((await row(jonas.id))!.hours, 0.25);
  assert.equal(await dayHours(day), 9.25);
  linkMember(jonas.id, spanOfHead(mob.id)!.id);
  assert.equal((await row(jonas.id))!.hours, 0);

  // Editing a task's hours edits what it WORKED; what it books follows the group.
  updateEntry(jonas.id, { hours: 0.75 });
  assert.deepEqual([(await row(jonas.id))!.hours, (await row(jonas.id))!.workedHours], [0, 0.75]);
  // A new entry on that day that runs parallel to the mob window is grouped by itself.
  const late = await mk(day, "Dazu", "PROJ-9", "11:00", 1);
  assert.equal(autoGroup(late.id)?.mode, "collect");
  assert.equal((await row(late.id))!.hours, 0);
  // Moving a task to another day takes it out of the group.
  updateEntry(late.id, { date: "2026-11-04" });
  assert.deepEqual([(await row(late.id))!.spanId, (await row(late.id))!.hours, (await row(late.id))!.workedHours], [null, 1, null]);

  // Ungroup: every task books what it worked; the collecting entry stays — an ordinary entry again.
  dissolveSpan(spanOfHead(mob.id)!.id);
  assert.equal((await row(jonas.id))!.hours, 0.75);
  assert.equal((await row(mob.id))!.hours, 8);
  assert.equal((await row(mob.id))!.isGroup, false);

  // Deleting a collecting entry never takes its tasks with it: they book what they worked.
  const mob2 = createEntry({ jobNumber: "300001", date: "2026-11-05", hours: 8, description: "Mob 2", isGroup: true }, "web");
  const t1 = await mk("2026-11-05", "Eins", "A-1", "10:00", 2);
  collectIntoHead(mob2.id);
  assert.equal((await row(t1.id))!.hours, 0);
  deleteEntry(mob2.id);
  assert.deepEqual([(await row(t1.id))!.hours, (await row(t1.id))!.spanId, (await row(t1.id))!.workedHours], [2, null, null]);
});

/** Two tasks of one job at the same time: kept whole in a span; only what they BOOK changes with the mode. */
test("parallel work: every mode only changes the booked hours — never the tasks", async () => {
  await setup();
  const { detectParallel, applyParallel, setParallelMode } = await import("@/lib/entry-parallel");
  const { setSpanMode, getSpan, membersOf, dissolveSpan } = await import("@/lib/entry-spans");
  const { listEntries, updateEntry } = await import("@/lib/entries");
  const day = "2026-11-10";
  const a = await mk(day, "Login", "PROJ-1", "10:00", 3);
  const b = await mk(day, "Header", "PROJ-2", "10:00", 3);
  await mk(day, "Anderer Job", "XY-1", "10:00", 3, "300002");
  await mk(day, "Ohne Start", "PROJ-3", undefined, 2);
  assert.equal(await dayHours(day), 11);
  const [c] = detectParallel(day, day);
  assert.deepEqual({ ids: c.ids, span: c.spanHours, sum: c.sumHours }, { ids: [a.id, b.id], span: 3, sum: 6 });

  // The tasks as they are — checked after every mode.
  const whole = async () => {
    const out = [];
    for (const id of [a.id, b.id]) {
      const e = (await row(id))!;
      out.push([e.description, e.ticket, e.start, e.workedHours, e.jobId]);
    }
    return JSON.stringify(out);
  };

  const r = applyParallel([a.id, b.id], "divide");
  const wholeDivided = await whole();
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [1.5, 1.5]);
  assert.equal(JSON.stringify([(await row(a.id))!.workedHours, (await row(b.id))!.workedHours]), "[3,3]");
  assert.equal(await dayHours(day), 8);
  assert.equal(detectParallel(day, day).length, 0, "grouped: nothing left to detect");

  // Combine: a spanning entry (made here) books the 3 h; the tasks stay and book 0.
  const combined = setParallelMode(r.spanId, "combine");
  const head = (await row(combined.headId!))!;
  assert.deepEqual([head.isGroup, head.groupKind, head.hours, head.description, head.start, combined.headAuto], [true, "combine", 3, "PROJ-1, PROJ-2: Login · Header", "10:00", true]);
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [0, 0]);
  assert.equal(await whole(), wholeDivided, "the tasks are untouched by combining");
  assert.equal(await dayHours(day), 8); // 3 combined + 3 (other job) + 2 (no start)

  // Back to divided: the spanning entry Zeff made goes; the tasks are untouched.
  setParallelMode(r.spanId, "divide");
  assert.equal(await (await import("@/lib/entries")).getEntry(head.id), undefined);
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [1.5, 1.5]);
  assert.equal(await whole(), wholeDivided);

  // One after the other: each books what it worked — and their starts are the real ones, still parallel.
  setParallelMode(r.spanId, "sequential");
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [3, 3]);
  assert.deepEqual([(await row(a.id))!.start, (await row(b.id))!.start], ["10:00", "10:00"]);
  assert.equal(await whole(), wholeDivided);
  assert.equal(await dayHours(day), 11);
  assert.equal(getSpan(r.spanId)!.mode, "sequential");

  // Working hours edited on a task: the group books again.
  setParallelMode(r.spanId, "divide");
  updateEntry(b.id, { hours: 1 }); // b worked 1 h (10:00–11:00): the stretch is 3 h (a), shared 3:1
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [2.25, 0.75]);
  assert.equal((await row(b.id))!.workedHours, 1);

  // A combined span turned into a collecting entry of yours: its words and hours stay; Zeff stops rewriting it.
  const comb2 = setSpanMode(r.spanId, "combine");
  const kept = (await row(comb2.headId!))!;
  const mine = setSpanMode(r.spanId, "collect");
  assert.deepEqual([mine.headAuto, mine.mode], [false, "collect"]);
  updateEntry(comb2.headId!, { description: "Meine Zeile" });
  assert.equal((await row(comb2.headId!))!.description, "Meine Zeile");
  assert.equal((await row(comb2.headId!))!.hours, kept.hours);
  assert.equal(membersOf(r.spanId).length, 2);

  // Ungroup: the tasks book what they worked; the collecting entry of yours stays.
  dissolveSpan(r.spanId);
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [3, 1]);
  assert.ok(await row(comb2.headId!));
  assert.equal(listEntries({ from: day, to: day }).filter((e) => e.spanId).length, 0);
});

/** Booked as it happens: grouped by itself, the way set — and the report is what is booked. */
test("new work that runs in parallel is grouped as it is booked; the report gets the booked hours", async () => {
  await setup();
  const { autoGroup, setDefaultParallelMode } = await import("@/lib/entry-parallel");
  const { getSpan, membersOf } = await import("@/lib/entry-spans");
  const { getEntry } = await import("@/lib/entries");
  const { getRewrittenJobLines } = await import("@/lib/report");
  const { weekFromDate } = await import("@/lib/week");
  const { listBookedEntries, listEntries } = await import("@/lib/entries");
  setDefaultParallelMode("divide");
  const day = "2026-11-17"; // a Tuesday
  const week = weekFromDate(new Date(`${day}T00:00:00`));

  const one = await mk(day, "Eins", "PROJ-10", "09:00", 2);
  assert.equal(autoGroup(one.id), null);
  const two = await mk(day, "Zwei", "PROJ-11", "10:00", 2);
  const r = autoGroup(two.id)!; // 09:00–12:00 = 3 h stretch, divided in proportion
  assert.equal(r.mode, "divide");
  assert.equal(await dayHours(day), 3);
  const three = await mk(day, "Drei", "PROJ-12", "09:30", 1);
  assert.equal(autoGroup(three.id)!.mode, "divide"); // joins the span; the shares are made again
  assert.equal(await dayHours(day), 3);
  assert.equal(membersOf(r.spanId).length, 3);

  // The report is what goes out: divided tasks are lines with their shares.
  const lines = getRewrittenJobLines(week).filter((l) => l.date === day);
  assert.equal(Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100, 3);
  assert.equal(lines.length, 3);

  // Combined: the spanning entry is the one line; its tasks book 0 and are no lines of their own.
  const { setParallelMode } = await import("@/lib/entry-parallel");
  const span = setParallelMode(r.spanId, "combine");
  const lines2 = getRewrittenJobLines(week).filter((l) => l.date === day);
  assert.deepEqual(lines2.map((l) => l.hours), [3]);
  assert.match(lines2[0].first.description, /PROJ-10, PROJ-12, PROJ-11/); // (in the order they started)
  assert.equal(listBookedEntries({ from: day, to: day }).length, 1);
  assert.equal(listEntries({ from: day, to: day }).length, 4, "the overview still shows every task (and the spanning entry)");
  assert.equal(getSpan(r.spanId)!.headId, span.headId);
  assert.equal(getEntry(span.headId!)!.hours, 3);

  // Set to combine: a new pair makes a spanning entry, and a later one joins it — its hours follow.
  setDefaultParallelMode("combine");
  const d2 = "2026-11-18";
  const x = await mk(d2, "X", "PROJ-20", "10:00", 2);
  assert.equal(autoGroup(x.id), null);
  const y = await mk(d2, "Y", "PROJ-21", "11:00", 2);
  const c = autoGroup(y.id)!;
  assert.equal(c.mode, "combine");
  const head = getSpan(c.spanId)!.headId!;
  assert.equal(getEntry(head)!.hours, 3);
  const z = await mk(d2, "Z", "PROJ-22", "12:00", 2);
  autoGroup(z.id);
  assert.equal(getEntry(head)!.hours, 4);
  assert.equal(await dayHours(d2), 4);

  // Sequential as the default: the real starts stay; each task books what it worked.
  setDefaultParallelMode("sequential");
  const d3 = "2026-11-19";
  await mk(d3, "P", "PROJ-30", "10:00", 1);
  const q = await mk(d3, "Q", "PROJ-31", "10:15", 1);
  assert.equal(autoGroup(q.id)!.mode, "sequential");
  assert.equal(getEntry(q.id)!.start, "10:15");
  assert.equal(await dayHours(d3), 2);
  setDefaultParallelMode("divide");
});

/** The day booking: tickets and suggestions on a mob day are grouped under the collecting entry. */
test("the day booking groups work under a group meeting and with parallel work", async () => {
  await setup();
  const { bookDay } = await import("@/lib/feierabend");
  const { listEntries } = await import("@/lib/entries");
  const { collectHeadsOn } = await import("@/lib/entry-parallel");
  const { suggestEntry } = await import("@/lib/work/suggestions");
  const date = "2026-11-24";
  const s = suggestEntry({ date, hours: 1.5, description: "Header gebaut", jobNumber: "300001", reportedBy: "Claude" });
  const out = await bookDay(date, [
    { kind: "ticket", hours: 2, jobNumber: "300001", description: "Tests", ticket: "PROJ-400" },
    { kind: "suggestion", hours: 1.5, jobNumber: "", description: "Header gebaut", ticket: null, suggestionId: s.id },
    { kind: "ticket", hours: 1, jobNumber: "300001", description: "Daneben", ticket: "PROJ-401", standalone: true },
    { kind: "meeting", hours: 8, jobNumber: "300001", description: "Mob Programming", ticket: null, externalId: "m-1", group: true },
  ]);
  assert.deepEqual({ booked: out.booked, items: out.items, errors: out.errors }, { booked: 4, items: 2, errors: [] });
  const entries = listEntries({ from: date, to: date });
  assert.equal(entries.length, 4, "nothing is removed: every line is an entry");
  assert.equal(Math.round(entries.reduce((x, e) => x + e.hours, 0) * 100) / 100, 9); // 8 (Mob) + 1 (standalone)
  const head = collectHeadsOn(date)[0].head;
  assert.equal(entries.filter((e) => e.spanId).length, 2);
  assert.equal(head.hours, 8);
});

/** A start can be set on a task afterwards: the group is booked again by it, and the work log offers one. */
test("setting a start on a grouped task re-books the group; the work log suggests a start", async () => {
  await setup();
  const { updateEntry } = await import("@/lib/entries");
  const { applyParallel } = await import("@/lib/entry-parallel");
  const { suggestedStarts } = await import("@/lib/entry-start");
  const { getDb, schema } = await import("@/db");
  const day = "2026-12-08";
  const a = await mk(day, "Eins", "PROJ-50", "10:00", 2);
  const b = await mk(day, "Zwei", "PROJ-51", "10:30", 2);
  applyParallel([a.id, b.id], "divide"); // stretch 10:00–12:30 = 2.5 h
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [1.25, 1.25]);
  updateEntry(b.id, { start: "10:00" }); // now both 10:00–12:00: 2 h
  assert.deepEqual([(await row(a.id))!.hours, (await row(b.id))!.hours], [1, 1]);
  assert.equal((await row(b.id))!.workedHours, 2);

  const c = await mk(day, "Ohne Start", "PROJ-52", undefined, 1);
  const at = new Date(2026, 11, 8, 14, 20).toISOString();
  getDb().insert(schema.todoTime).values({ todoId: 1, minutes: 30, note: "x", reportedBy: "Claude", source: "agent", at, createdAt: at, entryId: c.id } as never).run();
  assert.equal(suggestedStarts([{ id: c.id, date: day }]).get(c.id), "13:50", "a record is made when its stretch is through: 14:20 minus its 30 minutes");
  assert.equal(suggestedStarts([{ id: c.id, date: "2026-12-09" }]).get(c.id), undefined, "only what was logged on its own day");
});
