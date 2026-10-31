/** The Todos plugin's action, run: the session's placeholder becomes your todo (it keeps its runs and time). Server only. */
import type { TodoOp } from "@/lib/todos/shared";
import { promoteSessionTodo } from "@/lib/todos/store";
import { t } from "@/lib/i18n/server";
import type { ActionContext, ActionResult } from "../actions/run-types";

export async function runTodoPromote(op: Extract<TodoOp, { type: "todo-promote" }>, ctx: ActionContext): Promise<ActionResult> {
  const todo = promoteSessionTodo(ctx.todo.id, op.text);
  return { what: t("Todo {ref} created: {text}", { ref: todo.ref, text: todo.text.slice(0, 80) }), todoNote: `Zum Todo gemacht: „${todo.text}“.` };
}
