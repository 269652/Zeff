import { t } from "@/lib/i18n/server";
import { dateRange, type Property, type Row } from "@/plugins/workspace/model";
import { getDatabase, rowsOf } from "@/plugins/workspace/store";
import { getSqlite } from "@/db";
import { hoursOfDay } from "@/plugins/workspace/day-log";
import { filled } from "./days";
import type { Series, SeriesInfo, SeriesProvider, SeriesRange } from "./series-point";

/**
 * The series of your own Workspace databases — any with a date (a journal, a workout log, a sleep diary): per day its numbers (also a
 * formula's or a rollup's), a select as its option's place (Hard = 1 … Great = 5, the options' order), a tick and each tag of a
 * multi-select as 0/1, a date field with the time beside the row's date as hours of its day (22:45 → 22.75; the day turns at 4:00,
 * so 0:30 is 24.5 — a medicine taken, going to bed), and how many entries the day has. A day is the row's date (the first date field); days without an entry have
 * no value (not a 0) — except the count, 0 from the first entry on. Databases filled by a source (mails, messages, calendars) are not
 * diaries and are left out, as are todo lists (their date is when a thing is due, not a day lived).
 */

type Acc = Map<string, number[]>;
const push = (acc: Acc, day: string, v: number) => {
  const list = acc.get(day);
  if (list) list.push(v);
  else acc.set(day, [v]);
};
const average = (acc: Acc) => new Map([...acc].sort(([a], [b]) => a.localeCompare(b)).map(([d, vs]) => [d, vs.reduce((s, x) => s + x, 0) / vs.length]));
const anyOf = (acc: Acc) => new Map([...acc].sort(([a], [b]) => a.localeCompare(b)).map(([d, vs]) => [d, Math.max(...vs)]));

/** The databases a person keeps by hand with a date field — not those a source fills. */
function diaryDatabases(): number[] {
  const ids = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and template = 0 order by id").all() as { id: number }[]).map((r) => r.id);
  return ids.filter((id) => {
    const s = getDatabase(id)?.schema;
    return !!s && !s.dataType && !s.pipeline?.steps?.length && !s.jobs && !s.rules && !s.todoList && s.properties.some((p) => p.type === "date");
  });
}

const dayOf = (row: Row, date: Property): string | null => {
  const r = dateRange(row.cells[date.id]);
  return r && /^\d{4}-\d{2}-\d{2}/.test(r.start) ? r.start.slice(0, 10) : null;
};

/** The series of one database in the period. */
export function databaseSeries(dbId: number, range: SeriesRange): Series[] {
  const d = rowsOf(dbId);
  const page = getDatabase(dbId)?.page;
  if (!d || !page) return [];
  const date = d.schema.properties.find((p) => p.type === "date");
  if (!date) return [];
  const name = page.title || t("Untitled");
  const dated = d.rows.map((r) => ({ row: r, day: dayOf(r, date) })).filter((x): x is { row: Row; day: string } => !!x.day);
  const inRange = dated.filter((x) => x.day >= range.from && x.day <= range.to);
  const out: Series[] = [];
  const base = (id: string, label: string) => ({ id: `db:${dbId}:${id}`, label: `${name} › ${label}`, group: name });

  for (const p of d.schema.properties) {
    if (p.type === "number" || p.type === "formula" || p.type === "rollup") {
      const acc: Acc = new Map();
      for (const { row, day } of inRange) {
        const v = row.cells[p.id];
        if (typeof v === "number" && Number.isFinite(v)) push(acc, day, v);
      }
      if (acc.size || p.type === "number") out.push({ ...base(p.id, p.name), kind: "number", ...(p.format === "hours" ? { unit: "h" } : p.format === "euro" ? { unit: "€" } : p.format === "unit" && p.unit ? { unit: p.unit } : {}), values: average(acc) });
    } else if ((p.type === "select" || p.type === "status") && p.options?.length) {
      const place = new Map(p.options.map((o, i) => [o.id, i + 1]));
      const acc: Acc = new Map();
      for (const { row, day } of inRange) {
        const at = place.get(String(row.cells[p.id] ?? ""));
        if (at) push(acc, day, at);
      }
      out.push({ ...base(p.id, p.name), kind: "ordinal", levels: p.options.map((o) => o.name), values: average(acc) });
    } else if (p.type === "multi_select" && p.options?.length) {
      for (const o of p.options) {
        const acc: Acc = new Map();
        for (const { row, day } of inRange) {
          const v = row.cells[p.id];
          push(acc, day, Array.isArray(v) && v.includes(o.id) ? 1 : 0);
        }
        out.push({ ...base(`${p.id}:${o.id}`, `${p.name}: ${o.name}`), kind: "binary", values: anyOf(acc) });
      }
    } else if (p.type === "checkbox") {
      const acc: Acc = new Map();
      for (const { row, day } of inRange) push(acc, day, row.cells[p.id] ? 1 : 0);
      out.push({ ...base(p.id, p.name), kind: "binary", values: anyOf(acc) });
    } else if (p.type === "date" && p.includeTime && p.id !== date.id) {
      const acc: Acc = new Map();
      for (const { row, day } of inRange) {
        const h = hoursOfDay(dateRange(row.cells[p.id])?.start ?? "");
        if (h !== null) push(acc, day, h);
      }
      out.push({ ...base(p.id, p.name), kind: "number", unit: "h", values: average(acc) });
    }
  }

  // How many entries a day has — a log of things that happen (a headache, a workout): 0 on the days between.
  if (dated.length) {
    const first = dated.reduce((m, x) => (x.day < m ? x.day : m), dated[0].day);
    const counts = new Map<string, number>();
    for (const { day } of inRange) counts.set(day, (counts.get(day) ?? 0) + 1);
    const values = filled(counts, range, first);
    out.push({ ...base("entries", t("Entries per day")), kind: "number", values });
  }
  return out;
}

/** A database's series without their values, from its fields alone (quick: the widget's choice of a target). */
export function databaseCatalog(dbId: number): SeriesInfo[] {
  const d = getDatabase(dbId);
  if (!d) return [];
  const name = d.page.title || t("Untitled");
  const base = (id: string, label: string) => ({ id: `db:${dbId}:${id}`, label: `${name} › ${label}`, group: name });
  return d.schema.properties.flatMap((p): SeriesInfo[] => {
    if (p.type === "number") return [{ ...base(p.id, p.name), kind: "number" }];
    if ((p.type === "select" || p.type === "status") && p.options?.length) return [{ ...base(p.id, p.name), kind: "ordinal", levels: p.options.map((o) => o.name) }];
    if (p.type === "multi_select") return (p.options ?? []).map((o) => ({ ...base(`${p.id}:${o.id}`, `${p.name}: ${o.name}`), kind: "binary" as const }));
    if (p.type === "checkbox") return [{ ...base(p.id, p.name), kind: "binary" }];
    if (p.type === "date" && p.includeTime && p.id !== d.schema.properties.find((x) => x.type === "date")?.id) return [{ ...base(p.id, p.name), kind: "number" }];
    return [];
  });
}

export const WORKSPACE_SERIES: SeriesProvider = {
  id: "workspace.databases",
  series: (range) => diaryDatabases().flatMap((id) => databaseSeries(id, range)),
  catalog: () => diaryDatabases().flatMap(databaseCatalog),
};
