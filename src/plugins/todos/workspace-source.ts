import { listTodos } from "@/lib/todos/store";
import { t } from "@/lib/i18n/server";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";

/** Your todos as something a database can join, by ticket: open ones per ticket, whose they are, what is due. Read only. */
const F = { ticket: "tdticket", status: "tdstatus", owner: "tdowner", kind: "tdkind", due: "tddue", ref: "tdref" };

export function todoRecords() {
  return listTodos({ status: "all" })
    .filter((x) => x.status !== "dismissed")
    .map((x) => ({
      ref: `todo:${x.id}`,
      title: x.text,
      fields: {} as Record<string, string>,
      updatedAt: x.updatedAt,
      typed: [
        { id: F.ticket, name: "Ticket", type: "text" as const, value: x.ticket },
        { id: F.status, name: "Status", type: "text" as const, value: x.status },
        { id: F.owner, name: "Owner", type: "text" as const, value: x.owner === "me" ? "me" : "other" },
        { id: F.kind, name: "Kind", type: "text" as const, value: x.kind },
        { id: F.due, name: "Due", type: "date" as const, value: x.due ?? "" },
        { id: F.ref, name: "Todo", type: "text" as const, value: x.ref },
      ],
    }));
}

export const TODOS_SOURCE: WorkspaceSource = {
  id: "todos",
  get label() {
    return t("Todos");
  },
  icon: "☑️",
  get hint() {
    return t("Your todos with their ticket, status and owner — tickets can count the open ones.");
  },
  columns: [
    { id: F.ticket, name: "Ticket", type: "text" },
    { id: F.status, name: "Status", type: "text" },
    { id: F.owner, name: "Owner", type: "text" },
    { id: F.kind, name: "Kind", type: "text" },
    { id: F.due, name: "Due", type: "date" },
    { id: F.ref, name: "Todo", type: "text" },
  ],
  count: () => listTodos({ status: "open" }).length,
  read: todoRecords,
  table: todoRecords,
  relationOnly: true,
  noNewRows: true,
};
