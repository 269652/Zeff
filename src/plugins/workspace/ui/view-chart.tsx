"use client";

import { useT } from "@/components/I18nProvider";
import { dateRange, groupRows, noLabels, type DbSchema, type Row, type View } from "../model";
import type { ChartPoint } from "../blocks";
import { BarChart, ColumnChart, LineChart, PieChart } from "./charts";

/** The same colours the chart blocks draw with (blocks.ts holds them on the server; a view draws on the client). */
const COLOR_HEX: Record<string, string> = { gray: "#94a3b8", brown: "#a16207", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", red: "#ef4444" };
const PALETTE = ["#6366f1", "#22c55e", "#f97316", "#ec4899", "#0ea5e9", "#eab308", "#a855f7", "#14b8a6", "#ef4444", "#84cc16", "#64748b", "#f43f5e"];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : null);

/** The rows of a view as chart points: one per value of the `groupBy` field (a date field: per month), counting rows or summing / averaging a number field. */
export function chartPoints(view: View, rows: Row[], schema: DbSchema, noValue: string): { points: ChartPoint[]; unit: string; valueName: string } {
  const g = schema.properties.find((p) => p.id === view.groupBy);
  const v = schema.properties.find((p) => p.id === view.chartProp && p.type === "number");
  const calc = view.chartCalc ?? "count";
  if (!g) return { points: [], unit: "", valueName: "" };
  const measure = (list: Row[]): number => {
    if (calc === "count" || !v) return list.length;
    const values = list.map((r) => num(r.cells[v.id])).filter((n): n is number => n !== null);
    const sum = values.reduce((a, b) => a + b, 0);
    return calc === "avg" ? (values.length ? sum / values.length : 0) : sum;
  };
  let groups: { label: string; color?: string; rows: Row[] }[];
  if (g.type === "date") {
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      const month = dateRange(r.cells[g.id])?.start.slice(0, 7);
      if (month) by.set(month, [...(by.get(month) ?? []), r]);
    }
    groups = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => ({ label, rows: list }));
  } else {
    groups = groupRows(rows, g.id, schema.properties, noLabels).map((x) => ({ label: x.label || noValue, color: x.color, rows: x.rows }));
    if (!["select", "status", "multi_select", "checkbox"].includes(g.type)) groups.sort((a, b) => b.rows.length - a.rows.length);
  }
  const points = groups
    // (summing or averaging: a group in which no row has the number has nothing to show)
    .filter((x) => x.rows.length && (calc === "count" || !v || x.rows.some((r) => num(r.cells[v.id]) !== null)))
    .slice(0, 30)
    .map((x, i): ChartPoint => ({ label: x.label, value: Math.round(measure(x.rows) * 100) / 100, color: (x.color && COLOR_HEX[x.color]) || PALETTE[i % PALETTE.length] }));
  const unit = calc === "count" || !v ? "" : v.format === "euro" ? "€" : v.format === "dollar" ? "$" : v.format === "hours" ? "h" : v.format === "percent" ? "%" : "";
  return { points, unit, valueName: calc === "count" || !v ? "" : v.name };
}

/** A view drawn as a chart: its rows by a field, as bars, columns, a line or a pie. */
export function ChartView({ view, rows, schema }: { view: View; rows: Row[]; schema: DbSchema }) {
  const t = useT();
  const { points, unit } = chartPoints(view, rows, schema, t("No value"));
  if (!view.groupBy || !points.length)
    return <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{!view.groupBy ? t("Pick the field the chart is grouped by (“Group by …” above).") : t("Nothing to draw — no row has a value in that field.")}</p>;
  const Chart = { bar: BarChart, column: ColumnChart, line: LineChart, pie: PieChart }[view.chartKind ?? "column"];
  return (
    <div className="card p-4">
      <Chart points={points} unit={unit} />
    </div>
  );
}
