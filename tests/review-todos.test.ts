import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function seed() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos", true);
  const store = await import("@/lib/boards/store");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const todo = (text: string) => store.addManualTodo({ ticket: "PROJ-7", text });
  const suggested = todo("Footer-Links prüfen");
  store.suggestDone(suggested.id, "Ticket-Lage", "Done, per the briefing run: Kommentar sagt erledigt");
  const reported = todo("Navigation umbauen");
  store.markWorkerDone(reported.id, "W-3 · Claude", "pushed feature/PROJ-7-nav");
  const asking = todo("Login reparieren");
  store.markWorkerDone(asking.id, "W-4 · Claude");
  store.setTodoNeedsInput(asking.id, "Welcher Login ist gemeint?");
  const proposed = todo("Rico nach dem Approval fragen");
  getDb()
    .update(schema.todos)
    .set({ ops: JSON.stringify([{ type: "jira-comment", ticket: "PROJ-7", body: "Rico, kannst du bitte approven?" }]), autoOpsWhy: "Rico wartet auf eine Erinnerung" })
    .where(eq(schema.todos.id, proposed.id))
    .run();
  const mine = todo("Ops von dir");
  store.setTodoOps(mine.id, [{ type: "jira-comment", ticket: "PROJ-7", body: "selbst geschrieben" }]);
  todo("Einfach offen");
  return { suggested: suggested.id, reported: reported.id, asking: asking.id, proposed: proposed.id, mine: mine.id };
}

test("Todos' queue: todos a worker or the AI says are done, and actions the AI proposed — not one waiting for an answer, not your own actions", async () => {
  const ids = await seed();
  const { reviewItems } = await import("@/lib/review");
  const items = (await reviewItems()).items.filter((i) => i.plugin === "todos");
  assert.deepEqual(
    items.map((i) => i.key),
    [`todo-done:${ids.suggested}`, `todo-done:${ids.reported}`, `todo-actions:${ids.proposed}`],
  );
  const [suggested, reported, proposed] = items;
  assert.match(suggested.title, /Footer-Links prüfen/);
  assert.match(suggested.detail!, /Ticket-Lage.*Kommentar sagt erledigt/);
  assert.equal(suggested.href, `/t/${ids.suggested}`);
  assert.match(reported.detail!, /W-3 · Claude.*pushed feature\/PROJ-7-nav/);
  assert.deepEqual(suggested.actions.map((a) => [a.id, !!a.primary]), [["yes", true], ["no", false]]);
  assert.match(proposed.title, /Rico nach dem Approval fragen/);
  assert.match(proposed.detail!, /Rico wartet auf eine Erinnerung/);
  assert.deepEqual(proposed.actions.map((a) => [a.id, !!a.primary]), [["yes", false], ["no", false]], "sending is never the \"y\" key — a click on the button");
});

test("done: yes closes the todo, no takes the worker's word back — it stays open", async () => {
  const ids = await seed();
  const { reviewAct } = await import("@/lib/review");
  const { getTodo } = await import("@/lib/boards/store");
  await reviewAct(`todo-done:${ids.suggested}`, "yes");
  assert.equal(getTodo(ids.suggested)!.status, "done");
  await reviewAct(`todo-done:${ids.reported}`, "no");
  assert.equal(getTodo(ids.reported)!.status, "open");
  assert.equal(getTodo(ids.reported)!.workerDone, null);
  await assert.rejects(() => reviewAct(`todo-done:${ids.reported}`, "later"), /later/);
});

test("proposed actions: no takes them off — not proposed again till the todo changes", async () => {
  const ids = await seed();
  const { reviewAct, reviewItems } = await import("@/lib/review");
  const { getTodo } = await import("@/lib/boards/store");
  await reviewAct(`todo-actions:${ids.proposed}`, "no");
  const todo = getTodo(ids.proposed)!;
  assert.deepEqual([todo.status, todo.ops, todo.autoOpsWhy], ["open", [], null]);
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const row = getDb().select({ at: schema.todos.actionsReviewedAt }).from(schema.todos).where(eq(schema.todos.id, ids.proposed)).get()!;
  assert.ok(row.at);
  assert.ok(!(await reviewItems()).items.some((i) => i.key === `todo-actions:${ids.proposed}`));
});
