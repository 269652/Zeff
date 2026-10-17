import { getSqlite } from "@/db";
import { getTodo } from "@/lib/boards/store";
import { t } from "@/lib/i18n/server";
import { cancelRun } from "@/lib/work/runner";
import { workRef } from "@/lib/work/shared";
import { runsByStatus } from "@/lib/work/store";
import type { WidgetItem, WorkspaceWidget } from "@/plugins/workspace/widget-point";

const clip = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ""));

/** The workers at work (queued and running) and those lately through — stopping one from here. */
export const WORK_WIDGETS: WorkspaceWidget[] = [
  {
    id: "work.runs",
    label: "Workers",
    icon: "🛠",
    description: "What the workers and agents do right now — and how the last ones ended. Stop a run from here.",
    settings: [{ key: "hours", label: "Also those ended within (hours)", kind: "number", default: 3, min: 0, max: 48 }],
    ttl: 5,
    data: (config) => {
      const todoText = (id: number) => clip(getTodo(id)?.text, 90) || workRef(id);
      const active = runsByStatus(["queued", "running"]).map((r): WidgetItem => ({ id: String(r.id), text: todoText(r.todoId), badge: r.status, detail: `${workRef(r.id)} · ${r.provider}`, href: `/work?run=${r.id}`, actions: [{ id: "stop", label: t("Stop") }] }));
      const since = new Date(Date.now() - Number(config.hours) * 3600e3).toISOString();
      const ended = Number(config.hours)
        ? (getSqlite().prepare("select id, todo_id, status, summary, error from work_runs where status in ('done', 'failed') and finished_at > ? order by id desc limit 6").all(since) as { id: number; todo_id: number; status: string; summary: string | null; error: string | null }[]).map(
            (r): WidgetItem => ({ id: String(r.id), text: todoText(r.todo_id), badge: r.status, detail: `${workRef(r.id)} · ${clip(r.summary ?? r.error, 120)}`, href: `/work?run=${r.id}` }),
          )
        : [];
      return { kind: "list", items: [...active, ...ended], empty: t("No worker is working."), title: active.length ? t("{n} working", { n: active.length }) : undefined };
    },
    act: (action, payload) => {
      if (action !== "stop") throw new Error("unknown action");
      cancelRun(Number(payload.id));
    },
  },
];
