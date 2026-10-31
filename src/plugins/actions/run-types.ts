import type { TodoOp, TodoView } from "@/lib/todos/shared";

/** A todo an operation leaves for afterwards (the next delivery step). */
export type NextTodo = { text: string; ops: TodoOp[]; owner?: "me" | "other" };

/** What running an action did: in words; what's next (a todo); a reference and a note for the todo (a sent message). */
export type ActionResult = { what: string; next?: NextTodo; ref?: string; todoNote?: string };

/** What an action runs with: the todo it's on, and a line for its log. */
export type ActionContext = { todo: TodoView; note: (line: string) => void };

/** How a plugin runs one of its actions (on the server). */
export type ActionRunner<O extends TodoOp = TodoOp> = (op: O, ctx: ActionContext) => Promise<ActionResult>;
