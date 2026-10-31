import { t } from "@/lib/i18n/server";
import type { LegacyChartSpec, LegacyMetricSpec } from "./legacy-blocks";
import { emptyFilter, newView, type View } from "./model";
import { getDatabase, updateSchema } from "./store";
import { defineValueType, type ValueAgg } from "./values";

/**
 * The markers an old data block leaves when a page still holds one (a version restored from before — sanitizeDoc reads the old
 * blocks as what replaced them, legacy-blocks.ts), settled where they are shown:
 *   figure (zeffMetric) → a Kennzahl (an aggregate over the database's view; a share: a formula of two) — widgets-metrics.ts
 *   chart (zeffChart)   → a chart view on that database (one of the same settings is taken) — the database block, actions.ts
 * The pages themselves were moved over once (both accounts, 2026-10); this is only for what still comes with one. Server only.
 */

const clean = (s: string) => s.replace(/["\\]/g, "").replace(/\s+/g, " ").trim();

/** A name for the Kennzahl an old figure block becomes: its label, else what it counts. */
function metricName(spec: LegacyMetricSpec, db: string, view: string, prop: string): string {
  if (spec.label) return clean(spec.label);
  const where = view ? `${db} · ${view}` : db;
  const what: Record<string, string> = {
    count: t("rows"),
    share: t("share of rows"),
    sum: t("sum of {field}", { field: prop }),
    avg: t("average of {field}", { field: prop }),
    min: t("smallest {field}", { field: prop }),
    max: t("largest {field}", { field: prop }),
    unique: t("different {field}", { field: prop }),
  };
  return clean(`${where} – ${what[spec.calc] ?? what.count}`).slice(0, 60);
}

const AGG: Record<string, ValueAgg> = { count: "count", sum: "sum", avg: "average", min: "min", max: "max", unique: "count_unique" };

/** The Kennzahl an old figure block becomes (made once; the same one again is taken): its name — null when its database is gone. */
export async function defineBlockMetric(spec: LegacyMetricSpec): Promise<string | null> {
  const d = getDatabase(spec.dbId);
  if (!d || d.page.archivedAt) return null;
  const view = spec.viewId ? d.schema.views.find((v) => v.id === spec.viewId) : undefined;
  const viewId = view ? view.id : "";
  const prop = d.schema.properties.find((p) => p.id === spec.prop);
  // A calculation over a field that is gone counts the rows (the block showed 0 then).
  const calc = spec.calc === "share" || spec.calc === "count" || prop ? spec.calc : "count";
  const base = metricName({ ...spec, calc }, d.page.title || t("Untitled"), view?.name ?? "", prop?.name ?? "");
  const metrics = await import("./metrics");
  for (let n = 1; n <= 30; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    if (calc !== "share") {
      if (defineValueType({ label: name, agg: AGG[calc] ?? "count", sources: [{ dbId: spec.dbId, viewId, propId: calc === "count" ? "" : prop!.id }] })) {
        metrics.forgetMetricValues();
        return name;
      }
      continue;
    }
    // A share: the rows of the view over all rows, in per cent — a formula of two counts.
    const part = `${name} · ${t("rows")}`;
    const all = `${name} · ${t("all rows")}`;
    const formula = `kennzahl("${part}") / kennzahl("${all}") * 100`;
    const had = metrics.getMetric(name);
    if (had && (had.kind !== "formula" || had.formula !== formula)) continue;
    if (!defineValueType({ label: part, agg: "count", sources: [{ dbId: spec.dbId, viewId, propId: "" }] }) || !defineValueType({ label: all, agg: "count", sources: [{ dbId: spec.dbId, viewId: "", propId: "" }] })) continue;
    if (!had) {
      metrics.defineFormulaMetric({ label: name, formula, unit: "%", what: t("The share of the rows of {db} the view shows", { db: d.page.title || t("Untitled") }) });
      // (its progress bar: the goal is all of them)
      if (spec.progress) metrics.setMetricMeta(name, { goal: { target: 100, dir: "atLeast" } });
    }
    metrics.forgetMetricValues();
    return name;
  }
  return null;
}

/** The chart view an old chart block becomes: one of the database with the same settings, else made now. Its id — null: no such database. */
export function ensureChartView(dbId: number, spec: LegacyChartSpec, title = ""): string | null {
  const d = getDatabase(dbId);
  if (!d) return null;
  const from = spec.viewId ? d.schema.views.find((v) => v.id === spec.viewId) : undefined;
  const filter = from?.filter ?? emptyFilter();
  const kind = spec.type as NonNullable<View["chartKind"]>;
  const calc = spec.calc as NonNullable<View["chartCalc"]>;
  const prop = calc === "count" ? "" : spec.prop;
  const same = d.schema.views.find((v) => v.type === "chart" && (v.groupBy ?? "") === spec.groupBy && (v.chartKind ?? "column") === kind && (v.chartCalc ?? "count") === calc && (v.chartProp ?? "") === prop && JSON.stringify(v.filter) === JSON.stringify(filter));
  if (same) return same.id;
  const view: View = { ...newView(clean(title) || (from ? `${t("Chart")} · ${from.name}` : t("Chart")), "chart"), filter: structuredClone(filter), sorts: from?.sorts ?? [], groupBy: spec.groupBy || undefined, chartKind: kind, chartCalc: calc, ...(prop ? { chartProp: prop } : {}) };
  updateSchema(dbId, { ...d.schema, views: [...d.schema.views, view] });
  return view.id;
}
