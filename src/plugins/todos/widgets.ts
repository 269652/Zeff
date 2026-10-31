import { getSqlite } from "@/db";
import { localDay } from "@/lib/dates";
import { t } from "@/lib/i18n/server";
import { listBadge, type WorkspaceWidget, type WidgetSetting } from "@/plugins/workspace/widget-point";

/**
 * The widgets of Todos: a list of your todos (all, of a ticket, by words — ticked off in place); what you got done — this week (from Monday) or in the last days —, the latest first, with how many in
 * all; the weekly review is made of it. Server only.
 */

/** Monday of this week, 00:00 local, as an ISO instant. */
function weekStart(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}

export const TODOS_WIDGETS: WorkspaceWidget[] = [
  {
    id: "todos.list",
    get label() {
      return t("Todo list");
    },
    icon: "☑️",
    get description() {
      return t("Your todos — all, of a ticket or by words; open, done or both — ticked off right here.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "q", label: t("Words"), kind: "text", default: "" },
        { key: "ticket", label: t("Ticket"), kind: "text", default: "" },
        {
          key: "status",
          label: t("Which"),
          kind: "select",
          default: "open",
          options: [
            { value: "open", label: t("Open") },
            { value: "done", label: t("Done") },
            { value: "all", label: t("All") },
          ],
        },
        { key: "limit", label: t("How many"), kind: "number", default: 10, min: 1, max: 60 },
      ];
    },
    ttl: 20,
    data: async (config) => {
      const { listTodos } = await import("@/lib/boards/store");
      const q = String(config.q ?? "").trim().toLowerCase();
      const ticket = String(config.ticket ?? "").trim().toUpperCase();
      const status = config.status === "done" || config.status === "all" ? config.status : "open";
      const today = localDay();
      const all = listTodos({ status, ...(ticket ? { ticket } : {}) }).filter((x) => !x.byWorker && (!q || `${x.ref} ${x.text} ${x.ticket}`.toLowerCase().includes(q)));
      const items = all.slice(0, Number(config.limit) || 10).map((x) => ({
        id: String(x.id),
        text: x.text,
        detail: [x.ref, x.ticket].filter(Boolean).join(" · "),
        meta: x.due || undefined,
        tone: x.status === "open" && x.due && x.due < today ? ("bad" as const) : undefined,
        href: `/t/${x.id}`,
        done: x.status !== "open",
        actions: [{ id: "toggle", label: x.status === "open" ? t("Done") : t("Open again"), icon: "✓" }],
      }));
      const overdue = all.filter((x) => x.status === "open" && x.due && x.due < today).length;
      return { kind: "list", items, count: all.length || undefined, urgent: overdue, empty: status === "done" ? t("Nothing done yet.") : t("No open todos.") };
    },
    // The page's badge: the overdue todos (a full list of open ones would always count).
    badge: listBadge({ important: (n) => (n === 1 ? t("1 overdue todo") : t("{n} overdue todos", { n })) }),
    act: async (action, payload) => {
      // Ticked: done; ticked again: open.
      if (action !== "toggle") throw new Error("unknown action");
      const { getTodo, setTodoStatus } = await import("@/lib/boards/store");
      const todo = getTodo(Number(payload.id));
      if (!todo) throw new Error(t("This todo is gone."));
      setTodoStatus(todo.id, todo.status === "open" ? "done" : "open");
    },
  },
  {
    id: "todos.done",
    get label() {
      return t("Done");
    },
    icon: "✅",
    get description() {
      return t("The todos you got done this week (or in the last days), the latest first — what the week brought, for the weekly review.");
    },
    get settings(): WidgetSetting[] {
      return [
        {
          key: "since",
          label: t("Since"),
          kind: "select",
          default: "week",
          options: [
            { value: "week", label: t("This week") },
            { value: "7", label: t("The last 7 days") },
            { value: "30", label: t("The last 30 days") },
          ],
        },
        { key: "limit", label: t("How many"), kind: "number", default: 10, min: 1, max: 50 },
      ];
    },
    ttl: 60,
    data: (config) => {
      const since = config.since === "7" || config.since === "30" ? new Date(Date.now() - Number(config.since) * 864e5).toISOString() : weekStart();
      const rows = getSqlite()
        .prepare("select id, ticket, text, done_at from todos where status = 'done' and owner = 'me' and done_at >= ? and merged_into is null order by done_at desc")
        .all(since) as { id: number; ticket: string; text: string; done_at: string }[];
      const items = rows.slice(0, Number(config.limit ?? 10)).map((r) => ({
        id: String(r.id),
        icon: "✓",
        text: r.text,
        detail: [`T-${r.id}`, r.ticket].filter(Boolean).join(" · "),
        meta: new Date(r.done_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "numeric" }),
        tone: "good" as const,
        href: `/todos#todo-${r.id}`,
      }));
      return { kind: "list", items, count: rows.length || undefined, empty: t("Nothing done yet — the week is young.") };
    },
  },
];
