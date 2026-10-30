/**
 * The old data blocks of a page (a figure, a chart, appointments, todos, a document, people — zeffMetric … zeffPeople) as what
 * replaced them: widgets and database views. Kept only so what still holds them reads right — a page saved before, a version, an old
 * `:::block metric {…}` line in Markdown — never made anew. Pure (client-safe): what needs the server (a Kennzahl defined for a
 * figure, a chart view made on its database, a document's row) is left as a marker that data-block-migration.ts settles; a widget
 * or a database block settles it by itself when it is shown. Client-safe.
 */

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string };

/** The old blocks' node types and the word each has in Markdown (`:::block metric {…}`). */
export const LEGACY_DATA_BLOCKS: Record<string, string> = { zeffMetric: "metric", zeffChart: "chart", zeffEvents: "events", zeffTasks: "tasks", zeffDocument: "document", zeffPeople: "people" };

/** What an old figure block looked at — a Kennzahl is made of it (the `define` of a Metrics widget until it is). */
export type LegacyMetricSpec = { dbId: number; viewId: string; calc: string; prop: string; label: string; progress?: boolean };
/** What an old chart block drew — a chart view of its database is made of it (`chart~…` as the view of a database block until it is). */
export type LegacyChartSpec = { type: string; groupBy: string; calc: string; prop: string; viewId: string };

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const pos = (v: unknown) => {
  const n = Math.floor(Number(v));
  return n > 0 ? n : 0;
};
/** Only the settings given (a widget takes its defaults for the rest). */
const config = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== 0 && v !== undefined)));
const widget = (id: string, cfg: Record<string, unknown>, title: string): Node => ({ type: "zeffWidget", attrs: { widget: id, config: config(cfg), title, header: "" } });

const CHART_SEP = "~";
/** A chart view still to be made, as the view id of a database block. */
export const chartMarker = (s: LegacyChartSpec): string => ["chart", s.type, s.groupBy, s.calc, s.prop, s.viewId].map((x) => x.replace(/~/g, "")).join(CHART_SEP);
/** The chart a marker stands for (null: not a marker). */
export function parseChartMarker(viewId: string): LegacyChartSpec | null {
  const p = viewId.split(CHART_SEP);
  if (p[0] !== "chart" || p.length !== 6) return null;
  return { type: ["bar", "column", "line", "pie"].includes(p[1]) ? p[1] : "bar", groupBy: p[2], calc: ["count", "sum", "avg"].includes(p[3]) ? p[3] : "count", prop: p[4], viewId: p[5] };
}

/** A figure still to be made a Kennzahl, as the `define` setting of a Metrics widget. */
export const metricDefine = (s: LegacyMetricSpec): string => JSON.stringify({ ...s, label: s.label.slice(0, 60) });
export function parseMetricDefine(raw: unknown): LegacyMetricSpec | null {
  if (typeof raw !== "string" || !raw.startsWith("{")) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const dbId = pos(o.dbId);
    return dbId ? { dbId, viewId: str(o.viewId), calc: str(o.calc) || "count", prop: str(o.prop), label: str(o.label, 60), ...(o.progress ? { progress: true } : {}) } : null;
  } catch {
    return null;
  }
}

/** The link an old document block becomes (without the server: its row is not known here). */
export const documentLink = (docId: number, name = ""): Node => ({ type: "paragraph", content: [{ type: "text", text: `📎 ${name || `Document ${docId}`}`, marks: [{ type: "link", attrs: { href: `/documents?doc=${docId}` } }] }] });

/** An old data block as what replaced it — null: one never set up (nothing to show). */
export function legacyDataBlock(type: string, a: Record<string, unknown> = {}): Node | null {
  const title = str(a.title, 120);
  switch (type) {
    case "zeffMetric": {
      const dbId = pos(a.dbId);
      if (!dbId) return null;
      const spec: LegacyMetricSpec = { dbId, viewId: str(a.viewId), calc: str(a.calc) || "count", prop: str(a.prop), label: str(a.label, 60), ...(a.style === "progress" ? { progress: true } : {}) };
      return widget("workspace.metrics", { define: metricDefine(spec) }, spec.label);
    }
    case "zeffChart": {
      const dbId = pos(a.dbId);
      if (!dbId) return null;
      return { type: "databaseView", attrs: { dbId, viewId: chartMarker({ type: str(a.type) || "bar", groupBy: str(a.groupBy), calc: str(a.calc) || "count", prop: str(a.prop), viewId: str(a.viewId) }), title } };
    }
    case "zeffEvents":
      return widget("calendar.agenda", { days: pos(a.days) || 7, q: str(a.q), calendar: str(a.calendar), limit: pos(a.limit) || 8 }, title);
    case "zeffTasks":
      return widget("todos.list", { q: str(a.q), ticket: str(a.ticket), status: ["open", "done", "all"].includes(str(a.status)) ? str(a.status) : "open", limit: pos(a.limit) || 10 }, title);
    case "zeffPeople": {
      const ids = (Array.isArray(a.ids) ? a.ids : []).map(pos).filter(Boolean).slice(0, 60);
      return widget("people.list", { ids: ids.join(","), q: str(a.q), limit: pos(a.limit) || 8 }, title);
    }
    case "zeffDocument": {
      const docId = pos(a.docId);
      return docId ? documentLink(docId) : null;
    }
    default:
      return null;
  }
}
