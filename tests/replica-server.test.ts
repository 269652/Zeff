import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

let n = 0;
// (Ops as the phone sends them — checked by isReplicaOp at the route, typed loosely here.)
const op = (o: object, at = new Date().toISOString()) => ({ id: `op${++n}`, at, ...o }) as unknown as import("@/lib/replica/shared").ReplicaOp;

async function seed() {
  const todos = await import("@/lib/todos/store");
  const ws = await import("@/plugins/workspace/store");
  const cal = await import("@/lib/calendar/ir");
  const todo = todos.addManualTodo({ ticket: "", text: "Milch kaufen" });
  const page = ws.createPage({ title: "Einkauf" });
  const dbId = ws.createPage({ title: "Aufgaben", kind: "database" });
  const row = ws.addRow(dbId, { title: "Zahnarzt" });
  const calendar = cal.createCalendar("Privat");
  const event = cal.addEvent(calendar.id, { title: "Yoga", start: "2026-11-10T18:00", end: "2026-11-10T19:00" });
  return { todo, page, dbId, row, calendar, event };
}

test("the manifest: every todo, page, row, calendar and event with a version — an edit changes it, also one that bumps no timestamp", async () => {
  const s = await seed();
  const { replicaManifest } = await import("@/lib/replica/server");
  const m1 = replicaManifest();
  for (const k of [`todo:${s.todo.id}`, `page:${s.page}`, `page:${s.dbId}`, `page:${s.row}`, `calendar:${s.calendar.id}`]) assert.ok(m1[k], k);
  assert.ok(Object.keys(m1).some((k) => k.startsWith(`event:${s.calendar.id}:`)), "the event by its calendar and key");
  const todos = await import("@/lib/todos/store");
  todos.setTodoFlagged(s.todo.id, true);
  const m2 = replicaManifest();
  assert.notEqual(m2[`todo:${s.todo.id}`], m1[`todo:${s.todo.id}`], "a flag (no updatedAt bump) is a new version");
  assert.equal(m2[`page:${s.page}`], m1[`page:${s.page}`], "the rest unchanged");
});

test("entities by key: what the phone keeps of each", async () => {
  const s = await seed();
  const { replicaEntities } = await import("@/lib/replica/server");
  const [t, p, r] = replicaEntities([`todo:${s.todo.id}`, `page:${s.dbId}`, `page:${s.row}`, "page:999999"]);
  assert.equal(t.kind, "todo");
  assert.equal((t.data as { text: string }).text, "Milch kaufen");
  assert.equal((p.data as { kind: string }).kind, "database");
  assert.ok((p.data as { schema: unknown }).schema, "a database's schema");
  assert.equal((r.data as { dbId: number }).dbId, s.dbId);
  assert.equal(replicaEntities(["page:999999"]).length, 0, "a key that's gone is left out");
});

test("ops in order: a todo made offline gets its id, later ops on it use the tmp", async () => {
  const { applyReplicaOps } = await import("@/lib/replica/server");
  const { hashValue } = await import("@/lib/replica/shared");
  const todos = await import("@/lib/todos/store");
  const a = await applyReplicaOps([
    op({ kind: "todo.add", tmp: "tmp:t1", text: "Brot holen" }),
    op({ kind: "todo.set", todo: "tmp:t1", field: "due", value: "2026-11-12", base: hashValue(null) }),
    op({ kind: "todo.set", todo: "tmp:t1", field: "status", value: "done", base: hashValue("open") }),
    op({ kind: "todo.note", todo: "tmp:t1", text: "beim Bäcker" }),
  ]);
  assert.deepEqual(a.results.map((r) => r.ok), [true, true, true, true], JSON.stringify(a.results));
  const id = a.ids["tmp:t1"] as number;
  const t = todos.getTodo(id)!;
  assert.equal(t.text, "Brot holen");
  assert.equal(t.due, "2026-11-12");
  assert.equal(t.status, "done");
  assert.equal(t.userNotes.at(-1)?.text, "beim Bäcker");
  // A tmp made in an earlier batch is still known.
  const b = await applyReplicaOps([op({ kind: "todo.set", todo: "tmp:t1", field: "text", value: "Brot und Butter", base: hashValue("Brot holen") })]);
  assert.equal(b.results[0].ok, true);
  assert.equal(todos.getTodo(id)!.text, "Brot und Butter");
});

test("each op once: a batch sent twice (a dropped answer) changes nothing twice", async () => {
  const { applyReplicaOps } = await import("@/lib/replica/server");
  const o = op({ kind: "todo.add", tmp: "tmp:t2", text: "Einmal" });
  const a = await applyReplicaOps([o]);
  const b = await applyReplicaOps([o]);
  assert.equal(b.results[0].skipped, "already applied");
  assert.equal(b.ids["tmp:t2"], a.ids["tmp:t2"], "the id is answered again");
  const todos = await import("@/lib/todos/store");
  assert.equal(todos.listTodos({ status: "all" }).filter((t) => t.text === "Einmal").length, 1);
});

test("last write wins: the PC changed it after the phone saw it — the later edit stays, the other is reported and kept for you", async () => {
  const { applyReplicaOps, replicaConflicts } = await import("@/lib/replica/server");
  const { hashValue } = await import("@/lib/replica/shared");
  const todos = await import("@/lib/todos/store");
  const t = todos.addManualTodo({ ticket: "", text: "Reifen wechseln" });
  const seen = hashValue("Reifen wechseln");
  const before = new Date(Date.now() - 60_000).toISOString();
  todos.setTodoText(t.id, "Winterreifen wechseln");
  // The phone's edit was earlier than the PC's: the PC's stays.
  const a = await applyReplicaOps([op({ kind: "todo.set", todo: t.id, field: "text", value: "Reifen tauschen", base: seen }, before)]);
  assert.equal(a.results[0].skipped, "conflict: the PC's later edit stays");
  assert.equal(todos.getTodo(t.id)!.text, "Winterreifen wechseln");
  assert.deepEqual({ kept: a.conflicts[0].kept, lost: a.conflicts[0].lost }, { kept: "pc", lost: "Reifen tauschen" });
  // The phone's edit is later: it wins, the PC's value is reported.
  const later = new Date(Date.now() + 60_000).toISOString();
  const b = await applyReplicaOps([op({ kind: "todo.set", todo: t.id, field: "text", value: "Sommerreifen runter", base: seen }, later)]);
  assert.equal(b.results[0].ok, true);
  assert.equal(todos.getTodo(t.id)!.text, "Sommerreifen runter");
  assert.deepEqual({ kept: b.conflicts[0].kept, lost: b.conflicts[0].lost }, { kept: "phone", lost: "Winterreifen wechseln" });
  assert.ok(replicaConflicts().some((c) => c.lost === "Winterreifen wechseln" && c.label === "Sommerreifen runter"), "kept for you to look at");
});

test("Workspace: a page and its body, a row with cells, a cell, the order, the trash — tmps across ops", async () => {
  const { applyReplicaOps } = await import("@/lib/replica/server");
  const { hashValue } = await import("@/lib/replica/shared");
  const ws = await import("@/plugins/workspace/store");
  const dbId = ws.createPage({ title: "Board", kind: "database" });
  const schema = ws.getPage(dbId)!.schema!;
  const status = schema.properties.find((p) => p.type === "select" || p.type === "status");
  const first = ws.addRow(dbId, { title: "Erste" });
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hallo von unterwegs" }] }] };
  const a = await applyReplicaOps([
    op({ kind: "page.add", tmp: "tmp:p1", parent: null, title: "Reise" }),
    op({ kind: "page.set", page: "tmp:p1", field: "content", value: doc, base: hashValue(ws.getPage(first)!.content) }),
    op({ kind: "row.add", tmp: "tmp:r1", db: dbId, title: "Zweite", cells: {} }),
    op({ kind: "row.place", row: "tmp:r1", after: null, before: first }),
    ...(status ? [op({ kind: "row.cell", row: "tmp:r1", prop: status.id, value: status.options?.[0]?.id ?? null, base: hashValue(null) })] : []),
    op({ kind: "page.archive", page: first }),
  ]);
  assert.ok(a.results.every((r) => r.ok), JSON.stringify(a.results));
  const page = ws.getPage(a.ids["tmp:p1"] as number)!;
  assert.equal(page.title, "Reise");
  assert.match(JSON.stringify(page.content), /Hallo von unterwegs/);
  const row = ws.getPage(a.ids["tmp:r1"] as number)!;
  assert.equal(row.dbId, dbId);
  if (status) assert.equal(row.props[status.id], status.options?.[0]?.id ?? undefined);
  assert.ok(ws.getPage(first)!.archivedAt, "in the trash");
});

test("calendar: an event made, changed, deleted on Zeff's own calendar; another source's is read-only", async () => {
  const { applyReplicaOps, replicaEntities, replicaManifest } = await import("@/lib/replica/server");
  const { hashValue } = await import("@/lib/replica/shared");
  const cal = await import("@/lib/calendar/ir");
  const c = cal.createCalendar("Unterwegs");
  const a = await applyReplicaOps([op({ kind: "event.add", tmp: "tmp:e1", calendarId: c.id, title: "Arzt", start: "2026-11-12T09:00", end: "2026-11-12T10:00" })]);
  const ref = a.ids["tmp:e1"] as string;
  assert.match(ref, new RegExp(`^${c.id}:`));
  const b = await applyReplicaOps([op({ kind: "event.set", event: "tmp:e1", field: "title", value: "Zahnarzt", base: hashValue("Arzt") })]);
  assert.equal(b.results[0].ok, true, JSON.stringify(b.results));
  const [e] = replicaEntities([`event:${ref}`]);
  assert.equal((e.data as { title: string }).title, "Zahnarzt");
  await applyReplicaOps([op({ kind: "event.delete", event: ref })]);
  assert.equal(replicaManifest()[`event:${ref}`], undefined);

  const google = cal.ensureCalendar("google:x", { source: "google", name: "Google" });
  const g = await applyReplicaOps([op({ kind: "event.add", tmp: "tmp:e2", calendarId: google.id, title: "x", start: "2026-11-12T09:00", end: "2026-11-12T10:00" })]);
  assert.equal(g.results[0].ok, false);
  assert.match(g.results[0].error ?? "", /Zeff's own calendars/i);
});


test("a page with blocks Markdown doesn't keep: its body isn't overwritten from the phone (nothing lost), its title still is", async () => {
  const { applyReplicaOps } = await import("@/lib/replica/server");
  const { hashValue } = await import("@/lib/replica/shared");
  const ws = await import("@/plugins/workspace/store");
  const callout = { type: "doc", content: [{ type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Wichtig" }] }] }] };
  const id = ws.createPage({ title: "Reich", content: callout });
  const before = ws.getPage(id)!.content;
  const a = await applyReplicaOps([
    op({ kind: "page.set", page: id, field: "content", value: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Wichtig" }] }] }, base: hashValue(before) }),
    op({ kind: "page.set", page: id, field: "title", value: "Reich und neu", base: hashValue("Reich") }),
  ]);
  assert.equal(a.results[0].ok, false);
  assert.match(a.results[0].error ?? "", /only the PC can edit/);
  assert.equal(a.results[1].ok, true);
  assert.equal(JSON.stringify(ws.getPage(id)!.content), JSON.stringify(before), "the callout kept");
  assert.equal(ws.getPage(id)!.title, "Reich und neu");
});

test("a series' words changed from the phone (its times stay with the PC): every date gets the new title", async () => {
  const { applyReplicaOps, replicaManifest } = await import("@/lib/replica/server");
  const { hashValue } = await import("@/lib/replica/shared");
  const cal = await import("@/lib/calendar/ir");
  const c = cal.createCalendar("Serien");
  cal.addEvent(c.id, { title: "Yoga", start: "2026-11-10T18:00", end: "2026-11-10T19:00", recurrence: { freq: "weekly", interval: 1 } as never });
  const ref = Object.keys(replicaManifest()).find((k) => k.startsWith(`event:${c.id}:`))!.slice(6);
  const a = await applyReplicaOps([op({ kind: "event.set", event: ref, field: "title", value: "Yoga am Abend", base: hashValue("Yoga") })]);
  assert.equal(a.results[0].ok, true, JSON.stringify(a.results));
  const { replicaEntities } = await import("@/lib/replica/server");
  const [e] = replicaEntities([`event:${ref}`]);
  assert.equal((e.data as { title: string }).title, "Yoga am Abend");
  assert.ok((e.data as { recurrence: unknown }).recurrence, "still a series");
});
