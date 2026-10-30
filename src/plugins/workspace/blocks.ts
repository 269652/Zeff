import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { cellText, dateRange, filterRows, formatNumber, groupRows, isComputed, noLabels, propById, type Labels, type Property, type Row } from "./model";
import { getDatabase, rowsOf } from "./store";
import { localDay } from "@/lib/dates";

/**
 * What the data blocks of a page show - a figure, a chart, the next appointments, a list of todos, a document, people - computed from
 * what Zeff holds, when the page is shown. The blocks keep only what to look at (a database, a view whose filter applies, a field, a
 * calculation); the numbers are never stored in the page. Server only.
 */

// ---------------------------------------------------------------------------
// A figure
// ---------------------------------------------------------------------------

export const METRIC_CALCS = ["count", "sum", "avg", "min", "max", "unique", "share"] as const;
export type MetricSpec = { dbId: number; /** A view of the database: its filter applies. */ viewId?: string; calc: (typeof METRIC_CALCS)[number]; /** The field summed, averaged … (not for count and share). */ prop?: string };
export type MetricResult = { value: number; text: string; /** All the rows of the database (before the view's filter). */ total: number; rows: number; database: string; view: string; propName: string };

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(",", ".")))) return Number(v.replace(",", "."));
  return null;
};

/** The rows of a database as a view shows them (its filter). */
function viewRows(dbId: number, viewId?: string): { rows: Row[]; all: Row[]; props: Property[]; database: string; view: string } {
  const d = getDatabase(dbId);
  const r = rowsOf(dbId);
  if (!d || !r) throw new Error(t("No such database."));
  const view = viewId ? r.schema.views.find((v) => v.id === viewId) : undefined;
  const labels: Labels = noLabels;
  return { rows: view ? filterRows(r.rows, view.filter, r.schema.properties, labels) : r.rows, all: r.rows, props: r.schema.properties, database: d.page.title || t("Untitled"), view: view?.name ?? "" };
}

export function metricData(spec: MetricSpec): MetricResult {
  const { rows, all, props, database, view } = viewRows(spec.dbId, spec.viewId);
  const p = spec.prop ? propById(props, spec.prop) : undefined;
  const values = p ? rows.map((r) => num(r.cells[p.id])).filter((n): n is number => n !== null) : [];
  let value = 0;
  switch (spec.calc) {
    case "count":
      value = rows.length;
      break;
    case "share":
      value = all.length ? (rows.length / all.length) * 100 : 0;
      break;
    case "sum":
      value = values.reduce((a, b) => a + b, 0);
      break;
    case "avg":
      value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      break;
    case "min":
      value = values.length ? Math.min(...values) : 0;
      break;
    case "max":
      value = values.length ? Math.max(...values) : 0;
      break;
    case "unique":
      value = p ? new Set(rows.map((r) => cellText(p, r.cells[p.id])).filter(Boolean)).size : 0;
      break;
  }
  const text = spec.calc === "share" ? `${Math.round(value * 10) / 10} %` : p && spec.calc !== "count" && spec.calc !== "unique" ? formatNumber(p, value) : String(Math.round(value * 100) / 100);
  return { value, text, total: all.length, rows: rows.length, database, view, propName: p?.name ?? "" };
}

// ---------------------------------------------------------------------------
// A chart
// ---------------------------------------------------------------------------

export const CHART_TYPES = ["bar", "column", "line", "pie"] as const;
export const BUCKETS = ["day", "week", "month", "year"] as const;
export type ChartSpec = { dbId: number; viewId?: string; type: (typeof CHART_TYPES)[number]; /** What the rows are grouped by. */ groupBy: string; calc: "count" | "sum" | "avg"; prop?: string; /** A date field is grouped by this. */ bucket?: (typeof BUCKETS)[number]; limit?: number };
export type ChartPoint = { label: string; value: number; color: string };
export type ChartResult = { points: ChartPoint[]; unit: string; database: string; groupName: string; valueName: string };

/** The colours of options and groups, as the editor shows them. */
export const COLOR_HEX: Record<string, string> = { gray: "#94a3b8", brown: "#a16207", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", red: "#ef4444" };
export const PALETTE = ["#6366f1", "#22c55e", "#f97316", "#ec4899", "#0ea5e9", "#eab308", "#a855f7", "#14b8a6", "#ef4444", "#84cc16", "#64748b", "#f43f5e"];

const startOfWeek = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d);
};
const bucketKey = (day: string, b: NonNullable<ChartSpec["bucket"]>) => (b === "year" ? day.slice(0, 4) : b === "month" ? day.slice(0, 7) : b === "week" ? startOfWeek(day) : day);

export function chartData(spec: ChartSpec): ChartResult {
  const { rows, props, database } = viewRows(spec.dbId, spec.viewId);
  const g = propById(props, spec.groupBy) ?? (spec.groupBy === "title" ? undefined : undefined);
  if (!g) throw new Error(t("Pick the field the chart is grouped by."));
  const v = spec.prop ? propById(props, spec.prop) : undefined;
  const measure = (list: Row[]): number => {
    if (spec.calc === "count" || !v) return list.length;
    const values = list.map((r) => num(r.cells[v.id])).filter((n): n is number => n !== null);
    const sum = values.reduce((a, b) => a + b, 0);
    return spec.calc === "avg" ? (values.length ? sum / values.length : 0) : sum;
  };
  let groups: { label: string; color?: string; rows: Row[] }[];
  if (g.type === "date") {
    // By the day, week, month or year the date falls in (in time order); rows without a date are left out.
    const bucket = spec.bucket ?? "month";
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      const day = dateRange(r.cells[g.id])?.start.slice(0, 10);
      if (day) by.set(bucketKey(day, bucket), [...(by.get(bucketKey(day, bucket)) ?? []), r]);
    }
    groups = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => ({ label, rows: list }));
  } else {
    groups = groupRows(rows, g.id, props, noLabels).map((x) => ({ label: x.label || t("No value"), color: x.color, rows: x.rows }));
    // Texts and the like: the biggest groups; choices keep their order.
    if (!["select", "status", "multi_select", "checkbox"].includes(g.type)) groups = groups.sort((a, b) => b.rows.length - a.rows.length);
  }
  const limit = Math.max(1, Math.min(40, spec.limit ?? 12));
  const points = groups
    .filter((x) => x.rows.length)
    .slice(0, limit)
    .map((x, i): ChartPoint => ({ label: x.label, value: Math.round(measure(x.rows) * 100) / 100, color: (x.color && COLOR_HEX[x.color]) || PALETTE[i % PALETTE.length] }));
  const unit = spec.calc === "count" || !v ? "" : v.format === "euro" ? "€" : v.format === "dollar" ? "$" : v.format === "hours" ? "h" : v.format === "percent" ? "%" : "";
  void isComputed;
  return { points, unit, database, groupName: g.name, valueName: spec.calc === "count" || !v ? t("Rows") : `${spec.calc === "avg" ? t("Average") : t("Sum")} ${v.name}` };
}

// ---------------------------------------------------------------------------
// The next appointments
// ---------------------------------------------------------------------------

export type EventsSpec = { days: number; q?: string; calendar?: string; limit?: number };
export type EventLine = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; calendar: string; color: string; day: string };

export async function eventsData(spec: EventsSpec): Promise<{ events: EventLine[]; href: string | null }> {
  if (!isInstalled("calendar")) throw new Error(t("The Calendar plugin is not installed (Menu → Plugins)."));
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const { dayOf } = await import("@/lib/calendar/ir-shared");
  const from = new Date();
  const to = new Date(from.getTime() + Math.max(1, Math.min(120, spec.days || 7)) * 864e5);
  const q = (spec.q ?? "").trim().toLowerCase();
  const cal = (spec.calendar ?? "").trim().toLowerCase();
  const now = `${dayOf(from)}T${String(from.getHours()).padStart(2, "0")}:${String(from.getMinutes()).padStart(2, "0")}`;
  const events = eventsBetween(dayOf(from), dayOf(to), { visible: true })
    .filter((e) => !e.cancelled && (e.allDay ? e.end.slice(0, 10) > now.slice(0, 10) : e.end > now) && (!q || `${e.title} ${e.location} ${e.attendees.join(" ")}`.toLowerCase().includes(q)) && (!cal || e.calendar.name.toLowerCase() === cal))
    .slice(0, Math.max(1, Math.min(50, spec.limit ?? 8)))
    .map((e): EventLine => ({ id: `${e.id}${e.occurrence ? `@${e.occurrence}` : ""}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, calendar: e.calendar.name, color: e.calendar.color, day: e.start.slice(0, 10) }));
  let href: string | null = null;
  try {
    const { calendarDatabase } = await import("./calendar-database");
    const id = calendarDatabase();
    href = id ? `/workspace/${id}` : "/kalender";
  } catch {
    href = "/kalender";
  }
  return { events, href };
}

// ---------------------------------------------------------------------------
// A list of todos
// ---------------------------------------------------------------------------

export type TasksSpec = { q?: string; ticket?: string; status: "open" | "done" | "all"; limit?: number };
export type TaskLine = { id: number; ref: string; text: string; ticket: string; done: boolean; due: string | null };

export async function tasksData(spec: TasksSpec): Promise<{ tasks: TaskLine[]; total: number }> {
  if (!isInstalled("todos")) throw new Error(t("The Todos plugin is not installed (Menu → Plugins)."));
  const { listTodos } = await import("@/lib/boards/store");
  const q = (spec.q ?? "").trim().toLowerCase();
  const ticket = (spec.ticket ?? "").trim().toUpperCase();
  const list = listTodos({ status: spec.status, ...(ticket ? { ticket } : {}) }).filter((x) => !x.byWorker && (!q || `${x.ref} ${x.text} ${x.ticket}`.toLowerCase().includes(q)));
  const tasks = list.slice(0, Math.max(1, Math.min(60, spec.limit ?? 10))).map((x): TaskLine => ({ id: x.id, ref: x.ref, text: x.text, ticket: x.ticket, done: x.status !== "open", due: x.due }));
  return { tasks, total: list.length };
}

/** A todo ticked off (or back) in a block. */
export async function setTaskDone(id: number, done: boolean): Promise<void> {
  const { setTodoStatus } = await import("@/lib/boards/store");
  setTodoStatus(Number(id), done ? "done" : "open");
}

// ---------------------------------------------------------------------------
// A document
// ---------------------------------------------------------------------------

export type DocumentSpec = { docId: number };
export type DocumentLine = { id: number; name: string; kind: string; size: number; status: string; abstract: string; concepts: string[]; from: string; unread: boolean; addedAt: string };

export async function documentData(spec: DocumentSpec): Promise<DocumentLine> {
  if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
  const { getDocument } = await import("@/plugins/documents/store");
  const d = getDocument(Number(spec.docId));
  if (!d) throw new Error(t("This document is gone."));
  const { documentOrigins } = await import("@/lib/mail/attachments-store");
  const o = documentOrigins([d.id])[d.id];
  const { isUnread } = await import("@/plugins/documents/seen");
  return { id: d.id, name: d.name, kind: d.kind, size: d.size, status: d.status, abstract: d.abstract, concepts: d.concepts, from: o ? `${o.from}${o.subject ? ` — ${o.subject}` : ""}`.trim() : "", unread: isUnread(d.id), addedAt: d.createdAt };
}

/** Documents to pick from: the newest, or by words in the name. */
export async function documentChoices(q: string): Promise<{ id: number; name: string; kind: string }[]> {
  if (!isInstalled("documents")) return [];
  const { listDocuments } = await import("@/plugins/documents/store");
  const w = q.trim().toLowerCase();
  return listDocuments()
    .filter((d) => !w || d.name.toLowerCase().includes(w))
    .slice(0, 12)
    .map((d) => ({ id: d.id, name: d.name, kind: d.kind }));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type PeopleSpec = { ids?: number[]; q?: string; limit?: number };
export type PersonLine = { id: number; name: string; starred: boolean; emails: string[]; next: { on: string; kind: string } | null; href: string };

export async function peopleData(spec: PeopleSpec): Promise<PersonLine[]> {
  if (!isInstalled("people")) throw new Error(t("The People plugin is not installed (Menu → Plugins)."));
  const { listPeople, upcoming } = await import("@/plugins/people/store");
  const { personHref } = await import("./people-database");
  const q = (spec.q ?? "").trim().toLowerCase();
  const ids = new Set((spec.ids ?? []).map(Number));
  const soonest = new Map<number, { on: string; kind: string }>();
  for (const u of upcoming({ days: 366 }).sort((a, b) => a.on.localeCompare(b.on))) if (!soonest.has(u.person.id)) soonest.set(u.person.id, { on: u.on, kind: u.date.kind === "other" ? u.date.label || "" : u.date.kind });
  return listPeople()
    .filter((p) => (ids.size ? ids.has(p.id) : true) && (!q || `${p.name} ${p.aliases.join(" ")} ${p.emails.join(" ")}`.toLowerCase().includes(q)) && (ids.size || q || p.starred))
    .slice(0, Math.max(1, Math.min(30, spec.limit ?? 8)))
    .map((p): PersonLine => ({ id: p.id, name: p.name, starred: p.starred, emails: p.emails.slice(0, 2), next: soonest.get(p.id) ?? null, href: personHref(p.id) }));
}

/** People to pick from, by name. */
export async function personChoices(q: string): Promise<{ id: number; name: string }[]> {
  if (!isInstalled("people")) return [];
  const { listPeople } = await import("@/plugins/people/store");
  const w = q.trim().toLowerCase();
  return listPeople()
    .filter((p) => !w || `${p.name} ${p.aliases.join(" ")}`.toLowerCase().includes(w))
    .slice(0, 12)
    .map((p) => ({ id: p.id, name: p.name }));
}
