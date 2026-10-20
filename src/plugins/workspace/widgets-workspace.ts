import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { runRoutine } from "./routine-run";
import { listRoutines, routineRuns } from "./routines";
import type { WorkspaceWidget, WidgetSetting } from "./widget-point";

/** Your routines (agents and automations) with how they last ended — run one from here. */
export const WORKSPACE_WIDGETS: WorkspaceWidget[] = [
  {
    id: "workspace.routines",
    get label() {
      return t("Routines");
    },
    icon: "⚙️",
    get description() {
      return t("Your agents and automations and how they last ended — run one from here.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 30 }];
    },
    ttl: 10,
    data: (config) => {
      const all = listRoutines();
      return {
        kind: "list",
        empty: t("No routines yet — make an agent or an automation from a template."),
        count: all.filter((r) => r.enabled).length || undefined,
        items: all.slice(0, Number(config.limit)).map((r) => {
          const last = routineRuns(r.pageId, 1)[0];
          const state = last ? (last.status === "failed" ? t("failed") : last.status === "running" ? t("running") : t("done")) : t("never run");
          return {
            id: String(r.pageId),
            icon: r.kind === "agent" ? "🤖" : "⚙️",
            text: r.title || t("Untitled"),
            detail: [r.enabled ? t("on") : t("off"), state].join(" · "),
            meta: last ? formatAgo(last.startedAt) : undefined,
            tone: last?.status === "failed" ? ("bad" as const) : last?.status === "running" ? ("good" as const) : undefined,
            href: `/workspace/${r.pageId}`,
            actions: [{ id: "run", label: t("Run now"), icon: "▶" }],
          };
        }),
      };
    },
    act: async (action, payload) => {
      if (action !== "run") throw new Error("unknown action");
      await runRoutine(Number(payload.id), { kind: "manual" });
    },
  },
];
