import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const follow = async (v: { ticket: string; text: string; parentId?: number | null; ops?: unknown[]; source?: string; byWorker?: boolean; workRunId?: number | null }) => {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket: v.ticket, text: v.text, kind: "reply", parentId: v.parentId ?? null, workRunId: v.workRunId ?? null, source: v.source ?? "test", ops: v.ops, byWorker: v.byWorker });
};
/** A todo row inserted around the gate (a duplicate that is already there). */
const raw = async (ticket: string, text: string, extra: Record<string, unknown> = {}) => {
  const { getDb, schema } = await import("@/db");
  return getDb().insert(schema.todos).values({ ticket, text, ...extra } as never).returning().get();
};
const events = async (todoId: number) => {
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  return getDb().select().from(schema.todoEvents).where(eq(schema.todoEvents.todoId, todoId)).all();
};
const openIds = async (ticket: string) => (await import("@/lib/boards/store")).listTodos({ ticket, status: "open" }).map((t) => t.id);

test("a follow-up that repeats an open todo is merged into it: no second row, the history says what came from where, the todo is touched", async () => {
  const { getTodo } = await import("@/lib/boards/store");
  const first = await follow({ ticket: "DG-1", text: "Antwort an Jens zur Migrationsplanung schreiben", ops: [{ type: "jira-comment", ticket: "DG-1", body: "Die Migration startet am Montag, bitte Zugang prüfen." }] });
  assert.equal(first.outcome, undefined, "new: no merge");
  const before = getTodo(first.id)!;
  await new Promise((r) => setTimeout(r, 15));
  const again = await follow({ ticket: "DG-1", text: "Antwort an Jens zur Migrationsplanung schreiben und senden", source: "Follow-up from W-45", workRunId: 45, ops: [{ type: "jira-comment", ticket: "DG-1", body: "Zugang zum Server noch prüfen, danach geht es los." }] });
  assert.equal(again.outcome, "merged");
  assert.equal(again.id, first.id, "the oldest keeps its id");
  assert.deepEqual(await openIds("DG-1"), [first.id], "no second row");
  const after = getTodo(first.id)!;
  assert.equal(after.ops.length, 2, "its operations and the new, different one");
  assert.ok(after.updatedAt > before.updatedAt, "touched");
  assert.ok(after.mergedAt && after.mergedAt > before.updatedAt, "merged_at: new to you again");
  const ev = (await events(first.id)).filter((e) => e.event === "merged");
  assert.equal(ev.length, 1);
  assert.match(ev[0].text, /senden/);
  assert.equal(ev[0].note, "Follow-up from W-45");
  assert.equal(ev[0].actor, "work:45");
});

test("the same operation twice is kept once; the earlier deadline wins; refs are united; a draft only fills an empty one", async () => {
  const { getTodo, addMailTodo } = await import("@/lib/boards/store");
  const a = addMailTodo({ ticket: "", text: "Pflichtschulung Datenschutz bis Freitag abschließen", kind: "other", refs: ["mail:a"], runId: null, due: "2026-11-20" });
  const b = addMailTodo({ ticket: "", text: "Pflichtschulung Datenschutz bis Freitag abschließen", kind: "reply", refs: ["mail:b"], runId: 7, due: "2026-11-10" });
  assert.equal(b.outcome, "merged");
  assert.equal(b.id, a.id);
  const t = getTodo(a.id)!;
  assert.equal(t.due, "2026-11-10");
  assert.deepEqual(t.refs.sort(), ["mail:a", "mail:b"]);
  assert.equal(t.kind, "reply", "a placeholder kind gives way");
  assert.equal(t.owner, "me");
  const op = { type: "jira-comment" as const, ticket: "DG-2", body: "Danke, ich kümmere mich darum." };
  const x = await follow({ ticket: "DG-2", text: "Kommentar zur Rückfrage des Kunden beantworten", ops: [op] });
  await follow({ ticket: "DG-2", text: "Kommentar zur Rückfrage des Kunden beantworten", ops: [op] });
  assert.equal(getTodo(x.id)!.ops.length, 1);
  const ev = (await events(a.id)).filter((e) => e.event === "merged");
  assert.equal(ev[0].actor, "lage:7");
});

test("mail, document and note todos merge into an open one instead of adding a row", async () => {
  const { addMailTodo, addDocTodo, addNoteTodo, getTodo } = await import("@/lib/boards/store");
  const base = addMailTodo({ ticket: "", text: "Reisekostenabrechnung für September einreichen", kind: "other", refs: ["mail:r1"], runId: null });
  const d = addDocTodo({ ticket: "", text: "Reisekostenabrechnung für September einreichen", kind: "other", refs: ["doc:3"], runId: null });
  const n = addNoteTodo({ ticket: "", text: "September Reisekostenabrechnung einreichen", kind: "other", refs: ["keep:n1"], runId: null });
  assert.equal(d.outcome, "merged");
  assert.equal(n.outcome, "merged");
  assert.equal(d.id, base.id);
  assert.equal(n.id, base.id);
  assert.deepEqual(getTodo(base.id)!.refs.sort(), ["doc:3", "keep:n1", "mail:r1"]);
  assert.equal((await events(base.id)).filter((e) => e.event === "merged").length, 2);
});

test("the Ticket-Lage merges a repeated todo into the older one and says so in its counts", async () => {
  const { reconcileTodos, getTodo } = await import("@/lib/boards/store");
  const old = await follow({ ticket: "DG-3", text: "Testumgebung für die Abnahme vorbereiten und Zugang freigeben" });
  const out = reconcileTodos({ tickets: [{ key: "DG-3", resolved: [], todos: [{ text: "Testumgebung für die Abnahme vorbereiten", kind: "other", owner: "me", refs: ["teams:19:q|1"], due: "2026-12-01" }, { text: "Ganz anderes Thema mit Überschrift Lizenzverlängerung", kind: "other", owner: "me", refs: [] }] }] } as never, 9);
  assert.deepEqual(out, { added: 1, kept: 1, closed: 0, merged: 1 });
  const t = getTodo(old.id)!;
  assert.ok(t.refs.includes("teams:19:q|1"));
  assert.equal(t.due, "2026-12-01");
  assert.equal((await events(old.id)).filter((e) => e.event === "merged")[0].actor, "lage:9");
  assert.equal((await openIds("DG-3")).length, 2);
});

test("a todo you type merges on its own ticket only", async () => {
  const { addManualTodo } = await import("@/lib/boards/store");
  const a = addManualTodo({ ticket: "DG-4", text: "Code Review durchführen" });
  const same = addManualTodo({ ticket: "DG-4", text: "Code Review durchführen" });
  assert.equal(same.outcome, "merged");
  assert.equal(same.id, a.id);
  const other = addManualTodo({ ticket: "DG-5", text: "Code Review durchführen" });
  assert.equal(other.outcome, undefined);
  assert.notEqual(other.id, a.id);
});

test("several open matches: all merge into the oldest, and every reference follows it", async () => {
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { getTodo, listTodos, doneTodos } = await import("@/lib/boards/store");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { mergedIntoChain } = await import("@/lib/boards/merge");
  const text = "Release Notizen für Version fünf zusammenstellen";
  const o = await raw("DG-6", text, { refs: JSON.stringify(["teams:19:o|1"]) });
  const b = await raw("DG-6", `${text} bitte`, { refs: JSON.stringify(["teams:19:o|2"]), ops: JSON.stringify([{ type: "jira-comment", ticket: "DG-6", body: "Release Notizen sind fertig, siehe Anhang." }]), due: "2026-11-01", flaggedAt: "2026-10-01T00:00:00.000Z" });
  const c = await raw("DG-6", `${text} jetzt`, { parentId: b.id });
  const child = await raw("DG-6", "Völlig andere Folgeaufgabe mit eigenem Wortlaut", { parentId: c.id });
  const run = getDb().insert(schema.workRuns).values({ ticket: "DG-6", todoId: c.id, mode: "implement", provider: "claude", status: "done", prompt: "p", queuedAt: new Date().toISOString() } as never).returning().get();
  const time = addTodoTime({ todoId: b.id, minutes: 12, note: "x", by: "Agent", runId: null });
  const sug = getDb().insert(schema.entrySuggestions).values({ date: "2026-10-12", hours: 1, description: "d", todoIds: JSON.stringify([b.id, c.id]), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never).returning().get();

  const g = await follow({ ticket: "DG-6", text: `${text} neu`, source: "Follow-up from W-3" });
  assert.equal(g.outcome, "merged");
  assert.equal(g.id, o.id, "the oldest keeps its id");
  assert.deepEqual((await openIds("DG-6")).filter((id) => id !== child.id), [o.id]);
  const survivor = getTodo(o.id)!;
  assert.deepEqual(survivor.refs.sort(), ["teams:19:o|1", "teams:19:o|2"]);
  assert.equal(survivor.due, "2026-11-01");
  assert.ok(survivor.flaggedAt, "flag follows");
  assert.equal(survivor.ops.length, 1);
  // The merged rows are closed, not gone.
  for (const m of [b, c]) {
    const row = getDb().select().from(schema.todos).where(eq(schema.todos.id, m.id)).get()!;
    assert.equal(row.status, "dismissed");
    assert.equal(row.mergedInto, o.id);
    assert.equal(mergedIntoChain(m.id), o.id);
  }
  assert.equal(getDb().select().from(schema.workRuns).where(eq(schema.workRuns.id, run.id)).get()!.todoId, o.id);
  assert.equal(getDb().select().from(schema.todoTime).where(eq(schema.todoTime.id, time.id)).get()!.todoId, o.id);
  assert.deepEqual(JSON.parse(getDb().select().from(schema.entrySuggestions).where(eq(schema.entrySuggestions.id, sug.id)).get()!.todoIds), [o.id]);
  assert.equal(getDb().select().from(schema.todos).where(eq(schema.todos.id, child.id)).get()!.parentId, o.id);
  // The merged ones are no list entries of their own.
  assert.ok(!doneTodos().some((t) => t.id === b.id || t.id === c.id));
  assert.ok(!listTodos({ status: "open" }).some((t) => t.id === b.id));
  // 3 merges recorded (two duplicates there already + the new one).
  assert.equal((await events(o.id)).filter((e) => e.event === "merged").length, 3);
});

test("closed or dropped todos are never merged into: a repeat of one dealt with lately stays skipped", async () => {
  const { setTodoStatus, getTodo, listTodos } = await import("@/lib/boards/store");
  const { attributed } = await import("@/lib/boards/activity");
  const done = await follow({ ticket: "DG-7", text: "Serverzertifikat erneuern und Monitoring anpassen" });
  attributed("you", () => setTodoStatus(done.id, "dismissed", "nicht nötig"));
  const again = await follow({ ticket: "DG-7", text: "Serverzertifikat erneuern und Monitoring anpassen", source: "Follow-up from W-8", byWorker: true });
  assert.equal(again.outcome, "known");
  assert.equal(again.id, done.id);
  assert.equal(listTodos({ ticket: "DG-7", status: "open" }).length, 0, "nothing made");
  const row = getTodo(done.id)!;
  assert.equal(row.status, "dismissed");
  assert.equal(row.mergedAt, null, "not touched");
  assert.equal((await events(done.id)).filter((e) => e.event === "merged").length, 0);
});

test("a follow-up that repeats the todo its run has just finished is its own todo; one that repeats a parent still open is merged into it", async () => {
  const { markWorkerDone, getTodo } = await import("@/lib/boards/store");
  const parent = await follow({ ticket: "DG-8", text: "Importfunktion für Rechnungen implementieren" });
  markWorkerDone(parent.id, "W-9 · claude", "fertig");
  const next = await follow({ ticket: "DG-8", text: "Importfunktion für Rechnungen implementieren und testen", parentId: parent.id, source: "Follow-up from W-9", workRunId: 9, byWorker: true });
  assert.equal(next.outcome, undefined, "the parent is the follow-up's reason, not its twin");
  assert.notEqual(next.id, parent.id);
  const parent2 = await follow({ ticket: "DG-9", text: "Dashboard Kennzahlen aktualisieren und prüfen" });
  const rep = await follow({ ticket: "DG-9", text: "Dashboard Kennzahlen aktualisieren und prüfen", parentId: parent2.id, source: "Follow-up from W-10", workRunId: 10 });
  assert.equal(rep.outcome, "merged");
  assert.equal(rep.id, parent2.id);
  assert.equal(getTodo(parent2.id)!.status, "open");
});

test("the sweep merges the duplicates that are already there: oldest wins, never across owner, dry-run only counts", async () => {
  const { getTodo } = await import("@/lib/boards/store");
  const { mergeDuplicateTodos } = await import("@/lib/boards/dedupe");
  const t1 = await raw("DG-10", "Wartungsfenster mit dem Betrieb abstimmen und bestätigen");
  const t2 = await raw("DG-10", "Wartungsfenster mit dem Betrieb abstimmen und bestätigen lassen");
  const other = await raw("DG-10", "Wartungsfenster mit dem Betrieb abstimmen und bestätigen", { owner: "other" });
  const t3 = await raw("DG-10", "Wartungsfenster mit dem Betrieb abstimmen", { parentId: null });
  const dry = mergeDuplicateTodos({ dryRun: true });
  assert.deepEqual(dry.pairs.filter((p) => p.survivor === `T-${t1.id}`).map((p) => p.merged).sort(), [`T-${t2.id}`, `T-${t3.id}`].sort());
  assert.ok(!dry.pairs.some((p) => p.merged === `T-${other.id}` || p.survivor === `T-${other.id}`), "owner me and other stay apart");
  assert.equal(dry.merged, 0);
  assert.equal(getTodo(t2.id)!.status, "open", "a dry run changes nothing");
  const real = mergeDuplicateTodos({ actor: "merge" });
  assert.ok(real.merged >= 2);
  assert.equal(getTodo(t2.id)!.status, "dismissed");
  assert.equal(getTodo(t2.id)!.mergedInto, t1.id);
  assert.equal(getTodo(t1.id)!.status, "open");
  assert.equal(getTodo(other.id)!.status, "open");
  const ev = (await events(t1.id)).filter((e) => e.event === "merged");
  assert.equal(ev.length, 2);
  assert.ok(ev.every((e) => e.actor === "merge"));
  assert.equal(mergeDuplicateTodos({ dryRun: true }).pairs.filter((p) => p.survivor === `T-${t1.id}`).length, 0);
});

test("the same words on another ticket: the Ticket-Lage links the tickets on the older todo; every other path leaves them two todos", async () => {
  const { reconcileTodos, getTodo } = await import("@/lib/boards/store");
  const a = await follow({ ticket: "DG-11", text: "Abnahmeprotokoll mit dem Fachbereich besprechen und unterschreiben lassen" });
  const b = await follow({ ticket: "DG-12", text: "Abnahmeprotokoll mit dem Fachbereich besprechen und unterschreiben lassen" });
  assert.notEqual(b.id, a.id);
  const out = reconcileTodos({ tickets: [{ key: "DG-13", resolved: [], todos: [{ text: "Abnahmeprotokoll mit dem Fachbereich besprechen und unterschreiben lassen", kind: "other", owner: "me", refs: [] }] }] } as never, 11);
  assert.equal(out.merged, 1);
  assert.equal(out.added, 0);
  assert.ok(getTodo(a.id)!.alsoTickets.includes("DG-13") || getTodo(a.id)!.ticket === "DG-13");
});
