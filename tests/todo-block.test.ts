import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The central todo block edits a todo where it shows it: its text changed (the rest as it was), its due date, its status. */
test("setTodoText: a todo's text changed in place — trimmed, not empty, its ops kept", async () => {
  const { addManualTodo, getTodo, setTodoText, setTodoOps } = await import("@/lib/todos/store");
  const g = addManualTodo({ ticket: "WS-1", text: "Belege sammeln" });
  const id = (g as unknown as { id: number }).id ?? getTodo(1)!.id;
  setTodoOps(id, [{ type: "teams-message", to: "Anna", body: "Hi" }] as never);
  setTodoText(id, "  Belege für 2025 sammeln  ");
  assert.equal(getTodo(id)!.text, "Belege für 2025 sammeln");
  assert.equal(getTodo(id)!.ops.length, 1, "its actions kept");
  assert.throws(() => setTodoText(id, "   "), /empty/i);
});
