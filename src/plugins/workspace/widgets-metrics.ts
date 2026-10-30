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
    return [
      { key: "names", label: t("Which (names, comma-separated; empty: all)"), kind: "text" as const, default: "" },
      // (an old figure block, not made a Kennzahl yet: what it counted — data-block-migration.ts)
      { key: "define", label: "define", kind: "text" as const, default: "", hidden: true },
    ];
  },
  size: "full",
  ttl: 60,
  data: async (config) => {
    const { formatMetric, goalProgress, beyond, listMetrics } = await import("./metrics");
    // An old figure block's: its Kennzahl made now (the same one again is taken), and shown.
    const { parseMetricDefine } = await import("./legacy-blocks");
    const spec = parseMetricDefine(config.define);
    const made = spec ? await (await import("./data-block-migration")).defineBlockMetric(spec) : null;
    if (spec && !made) return { kind: "error", message: t("The database of this figure is gone.") };
    const wanted = String(made ?? config.names ?? "")
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
        // (a goal to reach: how far it is)
        ...(m.goal?.dir === "atLeast" && m.goal.target > 0 && m.value !== null ? { bar: { value: Math.max(0, m.value), max: m.goal.target } } : {}),
      };
    });
    return tiles.length ? { kind: "stats", tiles } : { kind: "error", message: t("No metrics yet — Workspace → Metrics.") };
  },
};
