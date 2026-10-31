import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { canUndoClose, closedDay, dayOf, hoursOfDay, logIdOf, openDay, startedDay } from "./day-log";
import type { MetricProvider } from "./metric-point";
import { isDayList, newProperty, type DbSchema, type Property, type Row } from "./model";
import { createPage, getDatabase, getPage, rawRows, setCell, updateSchema } from "./store";
import { withStamps } from "./auto-fill";

/**
 * Day lists as a type of their own (the "Tagesliste"): what their tabs show — today (what is ticked, what is still open), the history
 * (each day of the log full, partial or empty) and the figures (kept on each day: how much of it was done the last 7 / 30 days, what is
 * open today, the mean time of each item) — the figures as Kennzahlen too (formulas, @-chips, Today, badges). The days themselves are
 * day-log.ts's; this only reads them, never an AI. Server only.
 */

/** A list's fields that matter for a day: the tick, the time it records, the dose (the first number). */
export function dayParts(schema: Pick<DbSchema, "properties">): { tick?: Property; time?: Property; dose?: Property } {
  const tick = schema.properties.find((p) => p.type === "checkbox");
  const time = schema.properties.find((p) => p.type === "date" && !!tick && p.stampOf === tick.id) ?? schema.properties.find((p) => p.type === "date" && p.includeTime);
  return { tick, time, dose: schema.properties.find((p) => p.type === "number") };
}

const stamped = (v: unknown): boolean => /T\d{2}:\d{2}/.test(String(v ?? ""));
/** Whether a log's value is one: a dose, a tick, a time (0, unticked and no time are none). */
const something = (v: unknown): boolean => v !== undefined && v !== null && v !== 0 && v !== false && v !== "";

export type DayItem = { id: number; title: string; done: boolean; at: string | null; dose: number | null };
export type DayHistoryDay = { day: string; taken: number; total: number; items: string[] };
export type DayListState = {
  id: number;
  title: string;
  icon: string;
  /** The day the ticks count for (4:00 to 4:00). */
  day: string;
  items: DayItem[];
  done: number;
  total: number;
  /** The log database (its days), once there is one. */
  logId: number | null;
  /** The day closed by hand last, and whether that close can be undone. */
  closed: string | null;
  canUndo: boolean;
  tick: string | null;
  time: string | null;
  dose: { id: string; name: string; unit?: string } | null;
};

/** The list's items now: each one done or not — after 4:00 (the turn not made yet: nothing looked at it) everything is open again. */
function itemsOf(schema: DbSchema, rows: Row[], turned: boolean): DayItem[] {
  const { tick, time, dose } = dayParts(schema);
  return rows.map((r) => {
    const at = time && stamped(r.cells[time.id]) ? String(r.cells[time.id]).slice(0, 16) : null;
    const done = !turned && (tick ? r.cells[tick.id] === true : !!at);
    return { id: r.id, title: r.title.trim() || t("Untitled"), done, at: done ? at : null, dose: dose && typeof r.cells[dose.id] === "number" ? (r.cells[dose.id] as number) : null };
  });
}

/** A day list as it is today (null: no such list, or not a day list). Reads only — the turn at 4:00 is shown, not made. */
export function dayListState(dbId: number, now = new Date()): DayListState | null {
  const d = getDatabase(dbId);
  if (!d || d.page.archivedAt || !isDayList(d.schema)) return null;
  const started = startedDay(dbId);
  const turned = !!started && started < dayOf(now);
  const items = itemsOf(d.schema, rawRows(dbId), turned);
  const { tick, time, dose } = dayParts(d.schema);
  return {
    id: dbId,
    title: d.page.title || t("Untitled"),
    icon: d.page.icon,
    day: turned ? dayOf(now) : openDay(dbId, now),
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
    logId: logIdOf(dbId),
    closed: closedDay(dbId),
    canUndo: canUndoClose(dbId),
    tick: tick?.id ?? null,
    time: time?.id ?? null,
    dose: dose ? { id: dose.id, name: dose.name, ...(dose.unit ? { unit: dose.unit } : {}) } : null,
  };
}

/** Every day list (not in the trash, not a template), in the tree's order. */
export function dayListIds(): number[] {
  const rows = getSqlite()
    .prepare("select id from ws_pages where kind = 'database' and db_id is null and archived_at is null and template = 0 and (instr(schema, '\"dayList\":true') > 0 or instr(schema, '\"stampTime\":true') > 0) order by position, id")
    .all() as { id: number }[];
  return rows.map((r) => r.id).filter((id) => {
    const d = getDatabase(id);
    return !!d && isDayList(d.schema);
  });
}

const ymd = (d: Date) => d.toLocaleDateString("sv-SE");
const dayBefore = (day: string, n = 1) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - n);
  return ymd(d);
};

/**
 * The log's days, oldest first, from its first entry up to today: for each, how many of the items there were that day were done
 * (a dose, a tick or a time in one of its columns) and which. Today's from the list itself (the log's is still open). A day without
 * an entry: nothing done.
 */
export function dayHistory(dbId: number, now = new Date()): DayHistoryDay[] {
  const state = dayListState(dbId, now);
  const d = getDatabase(dbId);
  if (!state || !d) return [];
  const rows = rawRows(dbId);
  const since = new Map(rows.map((r) => [r.id, (r.createdAt ?? "").slice(0, 10)]));
  const names = new Map(rows.map((r) => [r.id, r.title.trim() || t("Untitled")]));
  // (An item counts from the day it was made — not on the days before it.)
  const madeOn = (id: number) => since.get(id) ?? "";
  const byDay = new Map<string, Set<number>>();
  const logId = state.logId;
  if (logId) {
    const log = getDatabase(logId)!;
    const date = log.schema.properties.find((p) => p.type === "date" && !p.dayKey && !p.includeTime);
    const keyed = log.schema.properties.filter((p) => p.dayKey).map((p) => ({ p, row: Number(p.dayKey!.split(":")[0]) })).filter((x) => names.has(x.row));
    if (date)
      for (const r of rawRows(logId)) {
        const day = String(r.cells[date.id] ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const taken = byDay.get(day) ?? new Set<number>();
        for (const k of keyed) if (something(r.cells[k.p.id])) taken.add(k.row);
        byDay.set(day, taken);
      }
  }
  const today = state.day;
  byDay.set(today, new Set(state.items.filter((i) => i.done).map((i) => i.id)));
  const first = [...byDay.keys()].sort()[0] ?? today;
  const out: DayHistoryDay[] = [];
  for (let day = first, guard = 0; day <= today && guard < 3700; day = dayBefore(day, -1), guard++) {
    const there = rows.filter((r) => !madeOn(r.id) || madeOn(r.id) <= day);
    const taken = byDay.get(day) ?? new Set<number>();
    const items = there.filter((r) => taken.has(r.id)).map((r) => names.get(r.id)!);
    out.push({ day, taken: items.length, total: there.length, items });
  }
  return out;
}

/** How much of the days before today was done, in % — the last `days` days (from the log's first one); none: null. */
export function adherence(history: DayHistoryDay[], days: number, today: string): number | null {
  const from = dayBefore(today, days);
  const span = history.filter((h) => h.day >= from && h.day < today && h.total > 0);
  const total = span.reduce((a, h) => a + h.total, 0);
  return total ? Math.round((span.reduce((a, h) => a + h.taken, 0) / total) * 1000) / 10 : null;
}

/** The mean time each item was done at over the last 30 days (hours of its day: 8.5 is 8:30, 24.5 0:30 after midnight). */
export function meanTimes(dbId: number, now = new Date()): { id: number; title: string; hours: number; days: number }[] {
  const state = dayListState(dbId, now);
  const d = getDatabase(dbId);
  if (!state?.logId || !state.time || !d) return [];
  const log = getDatabase(state.logId)!;
  const date = log.schema.properties.find((p) => p.type === "date" && !p.dayKey && !p.includeTime);
  if (!date) return [];
  const from = dayBefore(state.day, 30);
  const entries = rawRows(state.logId).filter((r) => String(r.cells[date.id] ?? "") >= from);
  const out: { id: number; title: string; hours: number; days: number }[] = [];
  for (const item of state.items) {
    const col = log.schema.properties.find((p) => p.dayKey === `${item.id}:${state.time}`);
    const hours = col ? entries.map((r) => (stamped(r.cells[col.id]) ? hoursOfDay(String(r.cells[col.id])) : null)).filter((h): h is number => h !== null) : [];
    if (hours.length) out.push({ id: item.id, title: item.title, hours: Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 100) / 100, days: hours.length });
  }
  return out;
}

/** A time of day from its hours (8.5 → "08:30", 24.5 → "00:30"). */
export const clockOf = (hours: number): string => {
  const m = Math.round(hours * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** The names a list's Kennzahlen are read by ("Medis · Erfüllt 7 Tage") — kept German, as every Kennzahl's name. */
export const dayMetricNames = (list: string) => ({ week: `${list} · Erfüllt 7 Tage`, month: `${list} · Erfüllt 30 Tage`, open: `${list} · Offen heute`, time: (item: string) => `${list} · ${item} Ø Uhrzeit` });

/** The figures of a list: what its "Auswertung" tab shows and its Kennzahlen read. */
export function dayStats(dbId: number, now = new Date()) {
  const state = dayListState(dbId, now);
  if (!state) return null;
  const history = dayHistory(dbId, now);
  const names = dayMetricNames(state.title);
  return { state, history, week: adherence(history, 7, state.day), month: adherence(history, 30, state.day), times: meanTimes(dbId, now).map((x) => ({ ...x, metric: names.time(x.title) })), names: { week: names.week, month: names.month, open: names.open } };
}

const adherenceTone = (v: number): "good" | "warn" | "bad" => (v >= 90 ? "good" : v >= 60 ? "warn" : "bad");

/** The Kennzahlen of every day list (metric-point.ts): read when asked — a list made, renamed or gone follows. */
export function dayListMetrics(): MetricProvider[] {
  const out: MetricProvider[] = [];
  let ids: number[] = [];
  try {
    ids = dayListIds();
  } catch {
    return out;
  }
  for (const id of ids) {
    const d = getDatabase(id);
    if (!d) continue;
    const title = d.page.title || "Tagesliste";
    const n = dayMetricNames(title);
    const href = () => `/workspace/${id}?day=stats`;
    out.push(
      { label: n.week, unit: "%", what: "How much of the day list was done the last 7 days", read: () => dayStats(id)?.week ?? null, href, tone: adherenceTone },
      { label: n.month, unit: "%", what: "How much of the day list was done the last 30 days", read: () => dayStats(id)?.month ?? null, href, tone: adherenceTone },
      { label: n.open, unit: "", what: "The items of the day list still open today", read: () => { const s = dayListState(id); return s ? s.total - s.done : null; }, href: () => `/workspace/${id}` },
    );
    if (dayParts(d.schema).time)
      for (const r of rawRows(id)) {
        const item = r.title.trim();
        if (!item) continue;
        out.push({ label: n.time(item), unit: "h", what: "The mean time of day the item was done at, the last 30 days (8.5: 8:30)", read: () => meanTimes(id).find((x) => x.id === r.id)?.hours ?? null, href });
      }
  }
  return out;
}

/** From this hour on, what is still open today counts on the list's badge in the tree. */
export const OPEN_BADGE_FROM = 18;

/** The tree's badges of the day lists: after 18:00, the items still open today (by list). */
export function dayListBadges(now = new Date()): Map<number, { count: number; label: string }> {
  const out = new Map<number, { count: number; label: string }>();
  if (now.getHours() < OPEN_BADGE_FROM && now.getHours() >= 4) return out;
  for (const id of dayListIds()) {
    const s = dayListState(id, now);
    const open = s ? s.total - s.done : 0;
    if (s && open > 0) out.set(id, { count: open, label: t("{n} still open today", { n: open }) });
  }
  return out;
}

/** The kinds of day list "New → Day list" makes. */
export const DAY_LIST_KINDS = ["meds", "routine", "habits"] as const;
export type DayListKind = (typeof DAY_LIST_KINDS)[number];

/** A new day list of a kind: medicines (a dose and the time taken), a routine (a tick and its time), habits (a tick). Its id. */
export function createDayList(kind: DayListKind, parentId: number | null = null): number {
  const tickName = kind === "meds" ? t("Taken") : t("Done");
  const tick: Property = { ...newProperty(tickName, "checkbox"), ...(kind === "habits" ? {} : { stampTime: true }) };
  const dose: Property[] = kind === "meds" ? [{ ...newProperty(t("Dose"), "number"), unit: "mg" }] : [];
  const title = kind === "meds" ? t("Medicines") : kind === "routine" ? t("Routine") : t("Habits");
  const icon = kind === "meds" ? "💊" : kind === "routine" ? "🔁" : "🌱";
  const base: DbSchema = { titleName: t("Name"), properties: [...dose, tick], views: [{ id: "v1", name: t("Table"), type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }], dayList: true };
  const schema = withStamps(base, t("at"));
  const id = createPage({ parentId, title, icon, kind: "database", schema });
  return id;
}

/**
 * A database made a day list, or no longer one. Made one without a checkbox, it gets one ("Done", recording the time); switched off,
 * its log stays (with its days) — under it as a database of its own again.
 */
export function setDayList(dbId: number, on: boolean): void {
  const d = getDatabase(dbId);
  if (!d) throw new Error(t("This database is gone."));
  let schema: DbSchema = { ...d.schema, dayList: on };
  if (on && !schema.properties.some((p) => p.type === "checkbox")) schema = withStamps({ ...schema, properties: [...schema.properties, { ...newProperty(t("Done"), "checkbox"), stampTime: true }] }, t("at"));
  updateSchema(dbId, schema);
}

/** An item of a day list ticked or unticked (from Today) — its time stamped by the list itself. */
export function tickDayItem(rowId: number, on: boolean): void {
  const row = getPage(rowId);
  const d = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !d || !isDayList(d.schema)) throw new Error(t("Only a daily list has days to close."));
  const { tick, time } = dayParts(d.schema);
  if (tick) setCell(rowId, tick.id, on);
  else if (time) setCell(rowId, time.id, on ? `${ymd(new Date())}T${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}` : null);
}
