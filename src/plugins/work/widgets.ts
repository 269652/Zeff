import { getSqlite } from "@/db";
import { getTodo } from "@/lib/boards/store";
import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { cancelRun } from "@/lib/work/runner";
import { workRef } from "@/lib/work/shared";
import { runsByStatus } from "@/lib/work/store";
import type { WidgetItem, WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { clip } from "@/plugins/workspace/widget-shared";

/** The workers at work (queued and running) and those lately through — stopping one from here. */
export const WORK_WIDGETS: WorkspaceWidget[] = [
  {
    id: "work.runs",
    get label() {
      return t("Workers");
    },
    icon: "🛠",
    get description() {
      return t("What the workers and agents do right now — and how the last ones ended. Stop a run from here.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "hours", label: t("Also those ended within (hours)"), kind: "number", default: 12, min: 0, max: 72 }];
    },
    ttl: 5,
    data: (config) => {
      const todoText = (id: number) => clip(getTodo(id)?.text, 90) || workRef(id);
      const active = runsByStatus(["queued", "running"]).map(
        (r): WidgetItem => ({
          id: String(r.id),
          icon: r.status === "running" ? "⚡" : "⏳",
          text: todoText(r.todoId),
          detail: `${workRef(r.id)} · ${r.provider}${r.status === "queued" ? ` · ${t("waiting")}` : ""}`,
          tone: r.status === "running" ? "good" : undefined,
          meta: r.status === "running" ? t("running") : t("queued"),
          href: `/work?run=${r.id}`,
          actions: [{ id: "stop", label: t("Stop"), icon: "⏹" }],
        }),
      );
      const since = new Date(Date.now() - Number(config.hours) * 3600e3).toISOString();
      const ended = Number(config.hours)
        ? (getSqlite().prepare("select id, todo_id, status, summary, error, finished_at from work_runs where status in ('done', 'failed') and finished_at > ? order by id desc limit 6").all(since) as { id: number; todo_id: number; status: string; summary: string | null; error: string | null; finished_at: string }[]).map(
            (r): WidgetItem => ({
              id: String(r.id),
              text: todoText(r.todo_id),
              detail: `${workRef(r.id)} · ${clip(r.summary ?? r.error, 110)}`,
              tone: r.status === "failed" ? "bad" : "good",
              meta: formatAgo(r.finished_at),
              href: `/work?run=${r.id}`,
            }),
          )
        : [];
      return { kind: "list", items: [...active, ...ended], count: active.length || undefined, empty: t("No worker is working."), footer: { text: t("All runs"), href: "/work" } };
    },
    act: (action, payload) => {
      if (action !== "stop") throw new Error("unknown action");
      cancelRun(Number(payload.id));
    },
  },
];
