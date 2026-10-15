import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a session names a todo (T-165) or has one open todo on its ticket: that is the todo worked on — no new one", async () => {
  const { addManualTodo, findSessionTodo, listTodos } = await import("@/lib/boards/store");
  const first = addManualTodo({ ticket: "PROJ-306", text: "Umsetzung abschließen" });
  const before = listTodos({ status: "all" }).length;
  assert.equal(findSessionTodo(`Schließe du Umsetzung von ${first.ref} vollständig ab`, "PROJ-306")?.id, first.id, "by the T- number in the words");
  assert.equal(findSessionTodo("Mach das fertig", "PROJ-306")?.id, first.id, "the only open todo on the ticket");
  addManualTodo({ ticket: "PROJ-306", text: "Noch etwas" });
  assert.equal(findSessionTodo("Mach das fertig", "PROJ-306"), undefined, "two open todos: not guessed");
  assert.equal(findSessionTodo("Mach das fertig", ""), undefined);
  assert.equal(findSessionTodo("Siehe T-99999", "PROJ-306"), undefined, "a todo that isn't there");
  assert.equal(listTodos({ status: "all" }).length, before + 1, "finding makes nothing");
});

test("a session without a todo gets a placeholder in the Worker tab — never in yours — with the action that makes it your todo", async () => {
  const { addSessionTodo, getTodo, listTodos } = await import("@/lib/boards/store");
  const ph = addSessionTodo({ ticket: "PROJ-400", text: "Die Navigation prüfen" });
  assert.equal(ph.byWorker, true);
  assert.deepEqual(ph.ops, [{ type: "todo-promote", text: "Die Navigation prüfen" }]);
  assert.equal(listTodos({ status: "open", byWorker: false }).some((t) => t.id === ph.id), false, "not in the Todos tab");
  assert.equal(listTodos({ status: "open", byWorker: true }).some((t) => t.id === ph.id), true, "in the Worker tab");

  // The worker is told what the placeholder is.
  const { sessionTodoNote } = await import("@/lib/work/brief");
  const note = sessionTodoNote(getTodo(ph.id)!);
  assert.match(note, /Platzhalter dieser Session/);
  assert.match(note, /todo_needs_input/);
  assert.match(note, /Todo anlegen/);
  assert.equal(sessionTodoNote({ ...getTodo(ph.id)!, source: "Mail-Durchsicht" }), "", "only for a session's own placeholder");

  // The click: the action runs, the placeholder is a todo of yours — with the title chosen, the action gone.
  const { RUNNERS } = await import("@/plugins/actions/run");
  const done = await RUNNERS["todo-promote"]!({ type: "todo-promote", text: "Navigation auf Mobil prüfen" } as never, { todo: getTodo(ph.id)!, note: () => {} });
  assert.match(done.what, /Navigation auf Mobil prüfen/);
  const now = getTodo(ph.id)!;
  assert.equal(now.byWorker, false);
  assert.equal(now.text, "Navigation auf Mobil prüfen");
  assert.deepEqual(now.ops, []);
  assert.equal(listTodos({ status: "open", byWorker: false }).some((t) => t.id === ph.id), true, "now in the Todos tab");
});
