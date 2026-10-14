import { ApiError, int, str, TICKET, type ApiContribution } from "@/lib/plugins/api-kit";
import { t } from "@/lib/i18n/server";

/** Todos' part of the plugin API (docs/plugins/api.md). */
export const TODOS_API: ApiContribution = {
  permissions: () => ({
    "todos.read": t("Read your todos"),
    "todos.write": t("Add todos"),
  }),
  methods: {
    "todos.list": {
      perm: "todos.read",
      summary: "Your todos (status open | done | dismissed | all, ticket, limit).",
      run: async (p) => {
        const { listTodos } = await import("@/lib/boards/store");
        const status = str(p, "status", { max: 12 }) || "open";
        if (!["open", "done", "dismissed", "all"].includes(status)) throw new ApiError("bad_request", 'status: "open", "done", "dismissed" or "all"');
        const limit = int(p, "limit", { min: 1, max: 500 }) ?? 200;
        return listTodos({ status: status as "open" | "done" | "dismissed" | "all", ticket: str(p, "ticket", { max: 40 }) || undefined })
          .slice(-limit)
          .map((todo) => ({ id: todo.id, ref: todo.ref, ticket: todo.ticket, text: todo.text, kind: todo.kind, owner: todo.owner, status: todo.status, due: todo.due, parentId: todo.parentId, source: todo.source }));
      },
    },
    "todos.add": {
      perm: "todos.write",
      summary: "Add a todo (text, ticket).",
      run: async (p) => {
        const ticket = str(p, "ticket", { max: 40 });
        if (ticket && !TICKET.test(ticket)) throw new ApiError("bad_request", "ticket: a ticket key like ABC-123");
        const { addSessionTodo } = await import("@/lib/boards/store");
        const todo = addSessionTodo({ ticket, text: str(p, "text", { required: true, max: 500 }) });
        return { id: todo.id, ref: todo.ref };
      },
    },
  },
};
