/** The Todos plugin's action: a session's placeholder todo (Worker tab) made a real todo of yours — one click. Client-safe. */
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/todos/shared" {
  interface TodoOpMap {
    /** A work session that belongs to no todo yet: its placeholder (Worker tab) becomes a todo of yours with this title. */
    "todo-promote": { text: string };
  }
}

export const TODOS_ACTIONS = [
  action({
    type: "todo-promote",
    plugin: "todos",
    label: "Create todo",
    verb: "Create",
    // (No offer: Zeff puts it on a session's placeholder itself — an AI never proposes it, and a worker makes no todos of yours.)
    clean: (o) => (str(o.text) ? { type: "todo-promote", text: str(o.text).slice(0, 500) } : null),
    title: (op, t = EN) => t("Create todo: {text}", { text: op.text }),
    note: (op, t = EN) => ({ heading: t("Create todo"), detail: op.text, body: null }),
  }),
];
