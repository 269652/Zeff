import type Database from "better-sqlite3";

/**
 * Parallel work used to be kept as "items" under a group entry (the table entry_items), with the
 * entries they came from removed. Now every task stays a real entry in a span (entry_spans) — so
 * the items left in a database are turned back into entries, once: each becomes an entry of the
 * group's job, booking 0 under its group (what it worked is in `worked_hours`), with its tags, and
 * its todos, runs, time records and suggestion pointing at it again. The item row goes. Idempotent;
 * run when a database is opened.
 */

type Item = { id: number; entry_id: number; date: string; hours: number; start: string | null; description: string; ticket: string | null; type: string | null; tags: string; reported_by: string; todo_ids: string; run_ids: string; time_ids: string; suggestion_id: number | null; created_at: string };
type Head = { id: number; job_id: number; project_id: number | null; date: string; group_kind: string | null };

const ids = (json: string): number[] => {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
};
const names = (json: string): string[] => {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export function convertLegacyItems(sqlite: Database.Database): number {
  if (!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = 'entry_items'").get()) return 0;
  const items = sqlite.prepare("select * from entry_items order by id").all() as Item[];
  if (!items.length) return 0;
  const types = new Set((sqlite.prepare("select key from entry_types").all() as { key: string }[]).map((r) => r.key));
  const now = new Date().toISOString();
  let n = 0;
  sqlite.transaction(() => {
    for (const item of items) {
      const head = sqlite.prepare("select id, job_id, project_id, date, group_kind from time_entries where id = ?").get(item.entry_id) as Head | undefined;
      if (!head) continue; // its group is gone: nothing to put it under (the row stays, harmless)
      let span = sqlite.prepare("select id from entry_spans where head_id = ?").get(head.id) as { id: string } | undefined;
      if (!span) {
        const combine = head.group_kind === "combine";
        span = { id: `g${head.id}` };
        sqlite.prepare("insert or ignore into entry_spans (id, date, mode, head_id, head_auto, created_at) values (?, ?, ?, ?, ?, ?)").run(span.id, head.date, combine ? "combine" : "collect", head.id, combine ? 1 : 0, now);
        sqlite.prepare("update time_entries set is_group = 1, group_kind = ? where id = ?").run(combine ? "combine" : "collect", head.id);
      }
      const type = item.type && types.has(item.type) ? item.type : item.ticket && types.has("ticket") ? "ticket" : "other";
      const entryId = sqlite
        .prepare(
          "insert into time_entries (job_id, project_id, date, hours, worked_hours, description, type, ticket, reported_by, source, start, span_id, is_group, created_at, updated_at) values (?, ?, ?, 0, ?, ?, ?, ?, ?, 'web', ?, ?, 0, ?, ?)",
        )
        .run(head.job_id, head.project_id, item.date, item.hours, item.description, type, item.ticket, item.reported_by || "unknown", item.start, span.id, item.created_at || now, now).lastInsertRowid as number;
      for (const name of names(item.tags)) {
        sqlite.prepare("insert or ignore into tags (name) values (?)").run(name);
        const tag = sqlite.prepare("select id from tags where name = ?").get(name) as { id: number } | undefined;
        if (tag) sqlite.prepare("insert or ignore into entry_tags (entry_id, tag_id) values (?, ?)").run(entryId, tag.id);
      }
      // Its evidence was put on the group entry: back on the entry it belongs to.
      const repoint = (table: string, list: number[]) => {
        for (const id of list) sqlite.prepare(`update ${table} set entry_id = ? where id = ? and entry_id = ?`).run(entryId, id, head.id);
      };
      repoint("todos", ids(item.todo_ids));
      repoint("work_runs", ids(item.run_ids));
      repoint("todo_time", ids(item.time_ids));
      if (item.suggestion_id) repoint("entry_suggestions", [item.suggestion_id]);
      sqlite.prepare("delete from entry_items where id = ?").run(item.id);
      n++;
    }
  })();
  return n;
}
