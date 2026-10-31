import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isDayList, newProperty, type DbSchema, type Property, type Row } from "./model";
import { addRow, createPage, getDatabase, getPage, rawRows, setCell, updatePage, updateSchema } from "./store";

/**
 * A list you tick through every day — your medicines, a routine: a daily list (its setting, dayList; a checkbox recording the time
 * switches it on). Each change of it writes the day's entry of its log at once ("Medis · Verlauf", a database under it, made the first
 * time): one column per item — its number when ticked (the dose taken), else 0 — and each time field's time (a date with the time:
 * the Correlations read it as hours of its day, 0:30 after midnight past 24). The day turns at 4:00: what you take at 0:30 belongs to
 * the evening before, and at the first change or look after 4:00 the list starts the day unticked — the day before stays in its log.
 * Today's entry stays open; when the day turns (or by hand: "Close the day", for the day the ticks were made on) it is closed — locked, the tree shows it under the list; a database with a date, the Correlations read it by themselves (a dose
 * or its time against the journal's mood, the night's sleep). Server only.
 */

/** When the day turns: what is ticked before 4:00 belongs to the day before. */
export const DAY_STARTS_AT = 4;
const LOGS = "workspace.closeLogs";
const RESET = "workspace.dayListReset";
/** The last day closed by hand ("Close the day"), by list. */
const CLOSED = "workspace.dayListClosed";
/** What a close undoes: its entry, the ticks (and their times) it took off, the day mark before it. */
const LAST = "workspace.dayListLastClose";
type LastClose = { entry: number; day: string; mark: string | null; cells: Record<string, Record<string, unknown>> };

const ymd = (d: Date) => d.toLocaleDateString("sv-SE");
/** The day a moment belongs to (4:00 to 4:00). */
export const dayOf = (at: Date): string => ymd(new Date(at.getTime() - DAY_STARTS_AT * 36e5));

/**
 * The day a list's ticks count for: the day they are made on (4:00 to 4:00) — closed by hand or not. While the turn at 4:00 has not
 * happened yet (nothing looked at the list since), the ticks still on it are the day's they were made on: the one it was started for.
 */
export function openDay(dbId: number, now = new Date()): string {
  const day = dayOf(now);
  const mark = getPref<Record<string, string>>(RESET, {})[dbId];
  return mark && mark < day ? mark : day;
}

export { isDayList };

/** `key`: the item's row and the field's property ("<row id>:<property id>") — what the log's column is found by, whatever the names. */
export type DayColumn = { key: string; name: string; type: "number" | "checkbox" | "date"; like?: Pick<Property, "format" | "unit" | "includeTime">; /** null: no value that day (not taken: no time). */ value: number | boolean | string | null };

/** A tick's time as hours of its day (4:00 to 4:00): 8:30 → 8.5, 0:30 → 24.5. */
export function hoursOfDay(stamp: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(stamp);
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  return Math.round((h < DAY_STARTS_AT ? h + 24 : h) * 100) / 100;
}

/** The columns of the log and each one's value now: each time field's time (a date with the time) and the numbers gated by the first tick. Pure. */
export function dayColumns(schema: Pick<DbSchema, "properties">, rows: Pick<Row, "id" | "title" | "cells">[]): DayColumn[] {
  const tick = schema.properties.find((p) => p.type === "checkbox");
  const numbers = schema.properties.filter((p) => p.type === "number");
  const stamps = schema.properties.filter((p) => p.type === "date" && p.includeTime);
  const ticks = schema.properties.filter((p) => p.type === "checkbox");
  const out: DayColumn[] = [];
  for (const r of rows) {
    const item = r.title.trim() || t("Untitled");
    const ticked = tick ? r.cells[tick.id] === true : true;
    for (const s of stamps) {
      const at = String(r.cells[s.id] ?? "");
      out.push({ key: `${r.id}:${s.id}`, name: `${item} · ${s.name}`, type: "date", like: { includeTime: true }, value: /T\d{2}:\d{2}/.test(at) ? at : null });
    }
    if (numbers.length) for (const n of numbers) out.push({ key: `${r.id}:${n.id}`, name: `${item} · ${n.name}`, type: "number", like: n, value: ticked ? Number(r.cells[n.id]) || 0 : 0 });
    else for (const c of ticks) out.push({ key: `${r.id}:${c.id}`, name: ticks.length > 1 ? `${item} · ${c.name}` : item, type: "checkbox", value: r.cells[c.id] === true });
  }
  return out;
}

/** The list's log: the database under it (made the first time), a column for each item. */
function logOf(dbId: number, title: string, columns: DayColumn[]): { id: number; date: Property; byKey: Map<string, Property> } {
  const logs = getPref<Record<string, number>>(LOGS, {});
  let id = logs[dbId];
  if (!id || !getDatabase(id) || getPage(id)?.archivedAt) {
    const date = newProperty(t("Date"), "date");
    id = createPage({ parentId: dbId, title: `${title} · ${t("History")}`, icon: "📜", kind: "database", schema: { titleName: t("Day"), properties: [date], views: [{ id: "v1", name: t("Table"), type: "table", filter: { op: "and", rules: [] }, sorts: [{ prop: date.id, dir: "desc" }], hidden: [] }] } });
    setPref(LOGS, { ...logs, [dbId]: id });
  }
  const schema = getDatabase(id)!.schema;
  // Each column found by its item and field (dayKey) — renamed with them; one from before by its name (and keyed from now on);
  // the items added since get theirs.
  let props = [...schema.properties];
  let touched = false;
  for (const c of columns) {
    const at = props.findIndex((p) => p.dayKey === c.key);
    if (at >= 0) {
      if (props[at].name !== c.name) (props[at] = { ...props[at], name: c.name }), (touched = true);
      continue;
    }
    // (never the log's own date — the day each entry is)
    const old = props.findIndex((p) => !p.dayKey && p.name === c.name && !(p.type === "date" && !p.includeTime));
    if (old >= 0) {
      props[old] = { ...props[old], dayKey: c.key };
      touched = true;
      continue;
    }
    props = [...props, { ...newProperty(c.name, c.type), dayKey: c.key, ...(c.like?.format ? { format: c.like.format } : {}), ...(c.like?.unit ? { unit: c.like.unit } : {}), ...(c.like?.includeTime ? { includeTime: true } : {}) }];
    touched = true;
  }
  if (touched) updateSchema(id, { ...schema, properties: props });
  timesFromHours(id, columns);
  const now = getDatabase(id)!.schema.properties;
  return { id, date: now.find((p) => p.type === "date" && !p.dayKey)!, byKey: new Map(now.filter((p) => p.dayKey).map((p) => [p.dayKey!, p])) };
}

/**
 * A day's entry of a log as the list it is the log of looks: a row per item (the list's order, each of it; one that is gone since at the end), a
 * column per field — as dayColumns named them ("<item> · <field>"). A time as the time of day (another day's with its date), a dose
 * not taken and an unticked tick empty. Null: not an entry of a log.
 */
export function dayEntryTable(rowId: number): { titleName: string; fields: string[]; items: { name: string; cells: string[] }[] } | null {
  const row = getPage(rowId);
  const listId = row?.dbId ? Number(Object.entries(getPref<Record<string, number>>(LOGS, {})).find(([, log]) => log === row.dbId)?.[0]) : NaN;
  const list = Number.isFinite(listId) ? getDatabase(listId) : null;
  const log = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !list || !log) return null;
  const date = log.schema.properties.find((p) => p.type === "date" && !p.includeTime);
  const day = String((date && row.props[date.id]) ?? "");
  const numbers = list.schema.properties.filter((p) => p.type === "number");
  const ticks = list.schema.properties.filter((p) => p.type === "checkbox");
  const fields = list.schema.properties.filter((p) => (p.type === "date" && p.includeTime) || numbers.includes(p) || (!numbers.length && ticks.includes(p)));
  const lone = !numbers.length && ticks.length === 1 ? ticks[0] : null;
  const names = new Map<string, string[]>();
  const shown = (p: Property, v: unknown): string => {
    if (v === undefined || v === null || v === false || v === 0 || v === "") return "";
    if (p.type === "checkbox") return "✓";
    if (p.type === "date") {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(v));
      return !m ? String(v) : `${m[1]}-${m[2]}-${m[3]}` === day ? m[4] : `${m[3]}.${m[2]}. ${m[4]}`;
    }
    return typeof v === "number" ? String(Math.round(v * 1000) / 1000).replace(".", ",") : String(v);
  };
  for (const p of log.schema.properties) {
    if (p === date) continue;
    const f = fields.find((x) => p.name.endsWith(` · ${x.name}`));
    const item = f ? p.name.slice(0, -` · ${f.name}`.length) : lone ? p.name : null;
    const field = f ?? lone;
    if (!item || !field) continue;
    const cells = names.get(item) ?? fields.map(() => "");
    cells[fields.indexOf(field)] = shown(p, row.props[p.id]);
    names.set(item, cells);
  }
  const order = rawRows(listId).map((r) => r.title.trim() || t("Untitled"));
  for (const name of order) if (!names.has(name)) names.set(name, fields.map(() => "")); // (an item without a column that day: there, empty)
  const items = [...names.entries()].sort(([a], [b]) => (order.indexOf(a) < 0 ? 1e9 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 1e9 : order.indexOf(b)));
  return { titleName: list.schema.titleName || t("Name"), fields: fields.map((f) => f.name), items: items.map(([name, cells]) => ({ name, cells })) };
}

/** A list renamed: its log's name follows — while it is the one it was made with ("<list> · History"); one named by hand keeps it. */
export function followListRename(dbId: number, was: string, now: string): void {
  const logId = getPref<Record<string, number>>(LOGS, {})[dbId];
  const log = logId ? getPage(logId) : null;
  if (!log || log.archivedAt || was === now || log.title !== `${was} · ${t("History")}`) return;
  updatePage(log.id, { title: `${now} · ${t("History")}` });
}

/** A log from before with the times as hours (8.25, 24.5): those columns dates with the time, each day's value with them (24.5: 0:30 the day after). */
function timesFromHours(logId: number, columns: DayColumn[]): void {
  const schema = getDatabase(logId)!.schema;
  const old = schema.properties.filter((p) => p.type === "number" && p.format === "hours" && columns.some((c) => c.type === "date" && c.name === p.name));
  const date = schema.properties.find((p) => p.type === "date" && !p.includeTime);
  if (!old.length || !date) return;
  updateSchema(logId, { ...schema, properties: schema.properties.map((p) => (old.includes(p) ? { ...p, type: "date" as const, includeTime: true, format: undefined } : p)) });
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const r of rawRows(logId)) {
    const day = String(r.cells[date.id] ?? "");
    const fix = old.filter((p) => typeof r.cells[p.id] === "number" && /^\d{4}-\d{2}-\d{2}$/.test(day));
    if (!fix.length) continue;
    const locked = !!getPage(r.id)?.locked;
    if (locked) updatePage(r.id, { locked: false });
    for (const p of fix) {
      const minutes = Math.round(Number(r.cells[p.id]) * 60);
      const at = new Date(`${day}T00:00:00`);
      at.setMinutes(minutes);
      setCell(r.id, p.id, `${ymd(at)}T${pad(at.getHours())}:${pad(at.getMinutes())}`, { quiet: true });
    }
    if (locked) updatePage(r.id, { locked: true });
  }
}

/** Whether a day's value is one: a dose, a tick, a time (0, unticked and no time are none). */
const something = (v: DayColumn["value"]) => v !== null && v !== 0 && v !== false;

/**
 * The day's entry of the list's log written as the list is now (made the first time that day). Its id. Today's entry stays open — it is
 * closed when the day turns (startDayIfNew) or by hand (closeDay); a day closed by hand only takes what is ticked after it — added, its
 * values kept (the ticks went off as it was closed).
 */
export function writeDayLog(dbId: number, now = new Date(), day = openDay(dbId, now)): number | null {
  const db = getDatabase(dbId);
  if (!db || !isDayList(db.schema)) return null;
  const columns = dayColumns(db.schema, rawRows(dbId));
  const log = logOf(dbId, db.page.title, columns);
  const had = rawRows(log.id).find((r) => r.cells[log.date.id] === day);
  const id = had?.id ?? addRow(log.id, { title: new Date(`${day}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }), cells: { [log.date.id]: day } });
  const closed = !!had && !!getPage(id)?.locked && (getPref<Record<string, string>>(CLOSED, {})[dbId] ?? "") >= day;
  updatePage(id, { locked: false });
  for (const c of columns) if (!closed || something(c.value)) setCell(id, log.byKey.get(c.key)!.id, c.value);
  if (closed) updatePage(id, { locked: true });
  return id;
}

/** The entries of the days before `day` closed: locked, under "Closed entries" in the tree. */
function lockBefore(dbId: number, day: string): void {
  const logId = getPref<Record<string, number>>(LOGS, {})[dbId];
  const date = logId ? getDatabase(logId)?.schema.properties.find((p) => p.type === "date" && !p.includeTime) : undefined;
  if (logId && date) for (const r of rawRows(logId)) if (String(r.cells[date.id] ?? "") < day && !getPage(r.id)?.locked) updatePage(r.id, { locked: true });
}

/**
 * A new day (after 4:00) on a list: every tick unticked first — the day before stays in the log as it was. Whether it was a new day.
 * The first look at a list only notes the day.
 */
export function startDayIfNew(dbId: number, now = new Date()): boolean {
  const db = getDatabase(dbId);
  if (!db || !isDayList(db.schema)) return false;
  const marks = getPref<Record<string, string>>(RESET, {});
  const day = dayOf(now);
  if (marks[dbId] && marks[dbId] >= day) return false;
  setPref(RESET, { ...marks, [dbId]: day });
  if (!marks[dbId]) return false;
  for (const r of rawRows(dbId)) for (const p of db.schema.properties) if (p.type === "checkbox" && r.cells[p.id] === true) setCell(r.id, p.id, false, { quiet: true });
  // The days before closed now.
  lockBefore(dbId, day);
  return true;
}

/**
 * The day closed by hand ("Close the day"): the day the ticks on the list were made on — today, or the day before when the turn at
 * 4:00 has not happened (closed at 9:00, it is still the day before's). Its entry written and locked, every tick off; the day it is
 * now has begun with it (no second turn). What is ticked later the same day still counts for it (writeDayLog adds it). Once a day.
 * The entry's id.
 */
export function closeDay(dbId: number, now = new Date()): number {
  const db = getDatabase(dbId);
  if (!db || !isDayList(db.schema)) throw new Error(t("Only a daily list has days to close."));
  const day = openDay(dbId, now);
  if ((getPref<Record<string, string>>(CLOSED, {})[dbId] ?? "") >= day) throw new Error(t("This day is closed already."));
  const entry = writeDayLog(dbId, now, day)!;
  updatePage(entry, { locked: true });
  // The ticks taken off (and their times), for an undo.
  const kept = db.schema.properties.filter((p) => (p.type === "checkbox" && p.stampTime) || (p.type === "date" && p.stampOf));
  const cells: LastClose["cells"] = {};
  for (const r of rawRows(dbId)) {
    const c = Object.fromEntries(kept.filter((p) => r.cells[p.id] !== undefined).map((p) => [p.id, r.cells[p.id]]));
    if (Object.keys(c).length) cells[r.id] = c;
    for (const p of db.schema.properties) if (p.type === "checkbox" && r.cells[p.id] === true) setCell(r.id, p.id, false, { quiet: true });
  }
  const marks = getPref<Record<string, string>>(RESET, {});
  setPref(LAST, { ...getPref<Record<string, LastClose>>(LAST, {}), [dbId]: { entry, day, mark: marks[dbId] ?? null, cells } });
  setPref(CLOSED, { ...getPref<Record<string, string>>(CLOSED, {}), [dbId]: day });
  // (The day it is now has begun: the days before it closed, no turn again until the next 4:00.)
  setPref(RESET, { ...marks, [dbId]: dayOf(now) });
  lockBefore(dbId, dayOf(now));
  return entry;
}

/** The last close undone, while nothing was ticked for the next day: the entry open again, the ticks and their times back. */
export function undoCloseDay(dbId: number): void {
  const all = getPref<Record<string, LastClose>>(LAST, {});
  const last = all[dbId];
  if (!last || getPref<Record<string, string>>(CLOSED, {})[dbId] !== last.day) throw new Error(t("Nothing to undo."));
  const logId = getPref<Record<string, number>>(LOGS, {})[dbId];
  const date = logId ? getDatabase(logId)?.schema.properties.find((p) => p.type === "date" && !p.includeTime) : undefined;
  if (logId && date && rawRows(logId).some((r) => String(r.cells[date.id] ?? "") > last.day)) throw new Error(t("Something is ticked for the next day already — the close stays."));
  const { [dbId]: _closed, ...closed } = getPref<Record<string, string>>(CLOSED, {});
  setPref(CLOSED, closed);
  const { [dbId]: _mark, ...marks } = getPref<Record<string, string>>(RESET, {});
  setPref(RESET, last.mark ? { ...marks, [dbId]: last.mark } : marks);
  const { [dbId]: _last, ...rest } = all;
  setPref(LAST, rest);
  if (getPage(last.entry)) updatePage(last.entry, { locked: false });
  const schema = getDatabase(dbId)?.schema;
  for (const [row, c] of Object.entries(last.cells)) {
    if (!getPage(Number(row)) || getPage(Number(row))!.archivedAt) continue;
    // The tick first (it stamps now), then its time as it was.
    for (const [p, v] of Object.entries(c)) if (schema?.properties.find((x) => x.id === p)?.type === "checkbox") setCell(Number(row), p, v, { quiet: true });
    for (const [p, v] of Object.entries(c)) if (schema?.properties.find((x) => x.id === p)?.type === "date") setCell(Number(row), p, v, { quiet: true });
  }
}

/** The log of a list (the database its days are written into), if it has one yet. */
export function logIdOf(dbId: number): number | null {
  const id = getPref<Record<string, number>>(LOGS, {})[dbId];
  return id && getDatabase(id) && !getPage(id)?.archivedAt ? id : null;
}

/** Every list's log (by log id: its list) — the tree keeps them under their list's "History" tab, not as pages of their own. */
export function dayLogIds(): Map<number, number> {
  return new Map(Object.entries(getPref<Record<string, number>>(LOGS, {})).map(([list, log]) => [log, Number(list)]));
}

/** Whether the last close of a list can still be undone (the day closed is the last one, nothing ticked for the next day yet). */
export function canUndoClose(dbId: number): boolean {
  const last = getPref<Record<string, LastClose>>(LAST, {})[dbId];
  return !!last && getPref<Record<string, string>>(CLOSED, {})[dbId] === last.day;
}

/** The day closed by hand last (none: null). */
export const closedDay = (dbId: number): string | null => getPref<Record<string, string>>(CLOSED, {})[dbId] ?? null;

/** The day the list was last started on (its turn at 4:00 noted) — none yet: null. */
export const startedDay = (dbId: number): string | null => getPref<Record<string, string>>(RESET, {})[dbId] ?? null;
