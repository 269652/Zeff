import { t } from "@/lib/i18n/server";
import { runRoutine } from "./routine-run";
import { listRoutines, routineRuns } from "./routines";
import type { WorkspaceWidget } from "./widget-point";

/** Your routines (agents and automations) with how they last ended — run one from here. */
export const WORKSPACE_WIDGETS: WorkspaceWidget[] = [
  {
    id: "workspace.routines",
    label: "Routines",
    icon: "⚙️",
    description: "Your agents and automations and how they last ended — run one from here.",
    settings: [{ key: "limit", label: "How many", kind: "number", default: 8, min: 1, max: 30 }],
    ttl: 10,
    data: (config) => ({
      kind: "list",
      empty: t("No routines yet."),
      items: listRoutines()
        .slice(0, Number(config.limit))
        .map((r) => {
          const last = routineRuns(r.pageId, 1)[0];
          return { id: String(r.pageId), text: r.title || t("Untitled"), detail: `${r.kind} · ${r.enabled ? t("on") : t("off")} · ${last ? `${last.status} ${new Date(last.startedAt).toLocaleString()}` : t("never run")}`, href: `/workspace/${r.pageId}`, badge: last?.status === "failed" ? "!" : undefined, actions: [{ id: "run", label: t("Run") }] };
        }),
    }),
    act: async (action, payload) => {
      if (action !== "run") throw new Error("unknown action");
      await runRoutine(Number(payload.id), { kind: "manual" });
    },
  },
];
