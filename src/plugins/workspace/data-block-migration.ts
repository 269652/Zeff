import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { DocNode } from "./doc";
import { documentLink, LEGACY_DATA_BLOCKS, legacyDataBlock, parseChartMarker, parseMetricDefine, type LegacyChartSpec, type LegacyMetricSpec } from "./legacy-blocks";
import { emptyFilter, newView, type View } from "./model";
import { getDatabase, rawRows, updatePage, updateSchema } from "./store";
import { defineValueType, type ValueAgg } from "./values";

/**
 * The old data blocks of the pages moved to what replaced them (once — and again for what still comes with one: idempotent):
 *   figure (zeffMetric)       → a Kennzahl (an aggregate over the database's view; a share: a formula of two) + a Metrics widget showing it
 *   chart (zeffChart)         → a chart view on that database (one of the same settings is taken) + the database shown in the page by it
 *   appointments (zeffEvents) → the widget calendar.agenda (its days, words, calendar, how many)
 *   todos (zeffTasks)         → the widget todos.list (its words, ticket, status, how many)
 *   people (zeffPeople)       → the widget people.list (the people picked, words, how many)
 *   document (zeffDocument)   → its row of the document inbox shown in the page (none: a link to the document)
 * legacy-blocks.ts does what needs no server (and leaves markers for the rest); this settles the markers. Server only.
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

/** What an old document block becomes: its row of the document inbox in the page, else a link to it. */
async function documentNode(docId: number): Promise<DocNode> {
  if (!isInstalled("documents")) return documentLink(docId);
  const { documentInbox } = await import("./document-databases");
  const inbox = documentInbox();
  const row = inbox ? rawRows(inbox).find((r) => r.cells.srcref === `doc:${docId}`) : undefined;
  if (row) return { type: "pageEmbed", attrs: { pageId: row.id, title: row.title } };
  const { getDocument } = await import("@/plugins/documents/store");
  return documentLink(docId, getDocument(docId)?.name ?? "");
}

/** A node (and what is in it) with the old blocks and the markers settled — `changed` tells whether anything was. */
async function settle(n: DocNode, changed: { yes: boolean }): Promise<DocNode | null> {
  if (n.type === "zeffDocument") {
    changed.yes = true;
    const id = Math.floor(Number(n.attrs?.docId));
    return id > 0 ? documentNode(id) : null;
  }
  if (n.type in LEGACY_DATA_BLOCKS) {
    changed.yes = true;
    const next = legacyDataBlock(n.type, n.attrs ?? {});
    return next ? settle(next as DocNode, changed) : null;
  }
  if (n.type === "zeffWidget" && n.attrs?.widget === "workspace.metrics") {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(String(n.attrs.config ?? "{}")) as Record<string, unknown>;
    } catch {
      // no settings
    }
    const spec = parseMetricDefine(config.define);
    if (!spec) return n;
    const name = await defineBlockMetric(spec);
    if (!name) return n;
    changed.yes = true;
    const { define: _, ...rest } = config;
    return { ...n, attrs: { ...n.attrs, config: JSON.stringify({ ...rest, names: name }) } };
  }
  if (n.type === "databaseView") {
    const spec = parseChartMarker(String(n.attrs?.viewId ?? ""));
    if (!spec) return n;
    const viewId = ensureChartView(Number(n.attrs?.dbId), spec, String(n.attrs?.title ?? ""));
    if (!viewId) return n;
    changed.yes = true;
    return { ...n, attrs: { ...n.attrs, viewId } };
  }
  if (!n.content?.length) return n;
  const kids: DocNode[] = [];
  for (const c of n.content) {
    const x = await settle(c, changed);
    if (x) kids.push(x);
  }
  return { ...n, content: kids };
}

/**
 * Every page (not in the trash) that still holds an old data block or a marker, moved over and saved — the state before kept as a
 * version, its "edited" time left as it was. How many pages changed.
 */
export async function migrateDataBlocks(): Promise<number> {
  const like = [...Object.keys(LEGACY_DATA_BLOCKS).map((k) => `%"type":"${k}"%`), "%workspace.metrics%define%", '%"viewId":"chart~%'];
  const rows = getSqlite()
    .prepare(`select id, content, updated_at from ws_pages where archived_at is null and (${like.map(() => "content like ?").join(" or ")})`)
    .all(...like) as { id: number; content: string; updated_at: string }[];
  let moved = 0;
  for (const r of rows) {
    try {
      const changed = { yes: false };
      const next = await settle(JSON.parse(r.content) as DocNode, changed);
      if (!changed.yes || !next) continue;
      updatePage(r.id, { content: next });
      getSqlite().prepare("update ws_pages set updated_at = ? where id = ?").run(r.updated_at, r.id);
      moved++;
    } catch (e) {
      console.error(`[workspace] moving the old data blocks of page ${r.id} failed`, e);
    }
  }
  return moved;
}
