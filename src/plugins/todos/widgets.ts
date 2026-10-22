import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";

/**
 * The widgets of Todos: what you got done — this week (from Monday) or in the last days —, the latest first, with how many in
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
