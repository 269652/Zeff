import { ApiError, int, str, TICKET, type ApiContribution } from "@/lib/plugins/api-kit";
import { t } from "@/lib/i18n/server";

/** Todos' part of the plugin API (docs/plugins/api.md). */
export const TODOS_API: ApiContribution = {
  events: { "todos.changed": { description: "Something in the todos changed (no details; at most every half second)", topic: "todos" } },
  permissions: () => ({
    "todos.read": t("Read your todos"),
    "todos.write": t("Add todos"),
  }),
  methods: {
    "todos.list": {
      perm: "todos.read",
      summary: "Your todos (status open | done | dismissed | all, ticket, limit).",
      run: async (p) => {
        const { listTodos } = await import("@/lib/todos/store");
        const status = str(p, "status", { max: 12 }) || "open";
        if (!["open", "done", "dismissed", "all"].includes(status)) throw new ApiError("bad_request", 'status: "open", "done", "dismissed" or "all"');
        const limit = int(p, "limit", { min: 1, max: 500 }) ?? 200;
        return listTodos({ status: status as "open" | "done" | "dismissed" | "all", ticket: str(p, "ticket", { max: 40 }) || undefined })
          .slice(-limit)
          .map((todo) => ({ id: todo.id, ref: todo.ref, ticket: todo.ticket, text: todo.text, kind: todo.kind, owner: todo.owner, status: todo.status, due: todo.due, parentId: todo.parentId, source: todo.source }));
      },
    },
    "todos.add": {
      automatic: true,
      perm: "todos.write",
      summary: "Add a todo (text, ticket).",
      run: async (p) => {
        const ticket = str(p, "ticket", { max: 40 });
        if (ticket && !TICKET.test(ticket)) throw new ApiError("bad_request", "ticket: a ticket key like ABC-123");
        const { addSessionTodo } = await import("@/lib/todos/store");
        const todo = addSessionTodo({ ticket, text: str(p, "text", { required: true, max: 500 }) });
        return { id: todo.id, ref: todo.ref };
      },
      offer: {
        label: "Make a todo",
        when: "Aus etwas (einer Mail, einer Nachricht, einem Eintrag) folgt eine Aufgabe für mich, die keine der anderen Aktionen gleich erledigt — sie kommt als Todo auf meine Liste (mit dem Ticket, wenn es eins gibt).",
        fields: { text: "die Aufgabe in einem Satz, Verb zuerst", ticket: "optional: der Ticket-Schlüssel (z. B. PROJ-123)" },
        example: { text: "Anna die Freigabe für die Startseite bis Freitag geben", ticket: "" },
        check: (raw) => {
          const text = (raw.text ?? "").trim().slice(0, 500);
          const ticket = (raw.ticket ?? "").trim().toUpperCase();
          return text ? { text, ticket: TICKET.test(ticket) ? ticket : "" } : null;
        },
        describe: (p) => ({ title: t("Todo: {text}", { text: String(p.text) }), body: p.ticket ? String(p.ticket) : undefined }),
      },
    },
  },
};
