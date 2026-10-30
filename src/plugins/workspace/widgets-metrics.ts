import { t } from "@/lib/i18n/server";
import type { Metric } from "./metrics";
import type { WidgetData, WidgetTile, WorkspaceWidget } from "./widget-point";

/**
 * One tile of a figure widget: a Kennzahl by its name — with a second one as its line under it ("Offene Schulden: 3"), and
 * when to leave it out (no value: the source isn't there; zero: nothing to say).
 */
export type MetricPick = { name: string; detail?: string; hide?: "empty" | "zero" };

/** A Kennzahl as a tile: its value, its goal (or what it is), its tone — goal and thresholds first, then the plugin's reading. */
export async function metricTile(m: Metric, detail?: Metric | null): Promise<WidgetTile> {
  const { formatMetric, goalProgress, beyond } = await import("./metrics");
  const g = goalProgress(m);
  const second = detail && detail.value !== null && detail.value !== 0 ? `${detail.label}: ${formatMetric(detail.value, detail.unit)}` : "";
  return {
    label: m.label,
    value: m.error ? "⚠" : formatMetric(m.value, m.unit),
    detail: m.goal ? (g ? (g.reached ? t("goal reached") : t("{gap} to the goal", { gap: formatMetric(g.gap, m.unit) })) : "") : second || (detail ? "" : m.what),
    tone: beyond(m.value, m.alert) ? "bad" : g?.reached ? "good" : (m.tone ?? detail?.tone),
    href: `/workspace/metrics#${m.key}`,
    // (a goal to reach: how far it is)
    ...(m.goal?.dir === "atLeast" && m.goal.target > 0 && m.value !== null ? { bar: { value: Math.max(0, m.value), max: m.goal.target } } : {}),
  };
}

/** Kennzahlen as figure tiles, in the order picked — a name there is none of (its plugin isn't installed) is left out. */
export async function metricTiles(picks: MetricPick[]): Promise<WidgetTile[]> {
  const { listMetrics } = await import("./metrics");
  const { valueKey } = await import("./values");
  const all = listMetrics(picks.flatMap((p) => (p.detail ? [p.name, p.detail] : [p.name])));
  const find = (name: string) => all.find((m) => m.key === valueKey(name)) ?? null;
  const tiles: WidgetTile[] = [];
  for (const p of picks) {
    const m = find(p.name);
    if (!m || (p.hide && m.value === null) || (p.hide === "zero" && m.value === 0)) continue;
    tiles.push(await metricTile(m, p.detail ? find(p.detail) : null));
  }
  return tiles;
}

/** A figure widget's Kennzahlen: the names set in its settings (comma-separated), else its own few. */
export async function metricStats(names: unknown, picks: MetricPick[], empty: string): Promise<WidgetData> {
  const chosen = String(names ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tiles = await metricTiles(chosen.length ? chosen.map((name) => ({ name })) : picks);
  return tiles.length ? { kind: "stats", tiles } : { kind: "error", message: empty };
}

/** The setting every figure widget has: which Kennzahlen (empty: its own). */
export const namesSetting = () => ({ key: "names", label: t("Which metrics (names, comma-separated; empty: the usual ones)"), kind: "text" as const, default: "" });

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
    const { listMetrics } = await import("./metrics");
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
    const tiles = await Promise.all(list.map((m) => metricTile(m)));
    return tiles.length ? { kind: "stats", tiles } : { kind: "error", message: t("No metrics yet — Workspace → Metrics.") };
  },
};
