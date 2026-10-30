import { getSqlite } from "@/db";
import { dateRange, normalizeSchema, type Row } from "./model";
import { getPage, rawRows } from "./store";
import { localDay } from "@/lib/dates";

/**
 * The deadline radar (the Workspace plugin): every date field set to remind (`remind`: so many days before) in any database —
 * a contract's cancel-by, a task's due day, an instalment — its rows whose day is near or past, the done ones left out. What
 * "Needs attention" shows beside the todos. Server only.
 */

export type Deadline = { dbId: number; db: string; rowId: number; title: string; field: string; date: string; days: number };

const DAY = 864e5;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** The deadlines within their reminder (and the past ones), the nearest first. `today`: YYYY-MM-DD. */
export function deadlines(today = localDay()): Deadline[] {
  let dbs: { id: number; title: string; schema: string | null }[] = [];
  try {
    dbs = getSqlite().prepare("select id, title, schema from ws_pages where kind = 'database' and archived_at is null and schema like '%\"remind\"%'").all() as typeof dbs;
  } catch {
    // no Workspace pages kept yet
    return [];
  }
  const out: Deadline[] = [];
  for (const d of dbs) {
    const schema = normalizeSchema(JSON.parse(d.schema ?? "{}"));
    const dates = schema.properties.filter((p) => p.type === "date" && Number(p.remind) > 0);
    if (!dates.length) continue;
    // Done: a status in its done group, or a checkbox that says so (a todo list's).
    const status = schema.properties.find((p) => p.type === "status");
    const doneIds = new Set((status?.options ?? []).filter((o) => o.group === "done").map((o) => o.id));
    const doneBox = schema.todoList?.done;
    const done = (r: Row) => (status && doneIds.has(String(r.cells[status.id] ?? ""))) || (!!doneBox && r.cells[doneBox] === true);
    for (const r of rawRows(d.id)) {
      if (done(r) || getPage(r.id)?.archivedAt) continue;
      for (const p of dates) {
        const range = dateRange(r.cells[p.id]);
        if (!range) continue;
        const days = Math.round((dayOf(range.start) - dayOf(today)) / DAY);
        if (days > Number(p.remind)) continue;
        out.push({ dbId: d.id, db: d.title, rowId: r.id, title: r.title, field: p.name, date: range.start.slice(0, 10), days });
      }
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
