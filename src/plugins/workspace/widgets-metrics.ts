import { t } from "@/lib/i18n/server";
import type { WidgetTile, WorkspaceWidget } from "./widget-point";

/** The Kennzahlen as a widget: the ones named (or all), each a tile with its value — the goal reached or not, beyond a threshold. */
export const METRICS_WIDGET: WorkspaceWidget = {
  id: "workspace.metrics",
  get label() {
    return t("Metrics");
  },
  icon: "📊",
  get description() {
    return t("Named numbers at a glance — Tilgungsrate, Sparquote, the hours of the week, your own — with their goal.");
  },
  get settings() {
    return [{ key: "names", label: t("Which (names, comma-separated; empty: all)"), kind: "text" as const, default: "" }];
  },
  size: "full",
  ttl: 60,
  data: async (config) => {
    const { formatMetric, goalProgress, beyond, listMetrics } = await import("./metrics");
    const wanted = String(config.names ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const all = listMetrics();
    const list = wanted.length ? wanted.map((w) => all.find((m) => m.label.toLowerCase() === w || m.key === w)).filter((m) => !!m) : all;
    const tiles: WidgetTile[] = list.map((m) => {
      const g = goalProgress(m);
      return {
        label: m.label,
        value: m.error ? "⚠" : formatMetric(m.value, m.unit),
        detail: m.goal ? (g ? (g.reached ? t("goal reached") : t("{gap} to the goal", { gap: formatMetric(g.gap, m.unit) })) : "") : m.what,
        tone: beyond(m.value, m.alert) ? "bad" : g?.reached ? "good" : undefined,
        href: `/workspace/metrics#${m.key}`,
      };
    });
    return tiles.length ? { kind: "stats", tiles } : { kind: "error", message: t("No metrics yet — Workspace → Metrics.") };
  },
};
