import { getSqlite } from "@/db";
import { cellText, isComputed, type Property } from "./model";
import { addRow, coerceCell, getDatabase, getPage, setCell, updatePage } from "./store";

/**
 * Rows sent between databases, linked. A database opens to receive rows (schema.receive: the column they land in); a row sent
 * from any other database — a board, a derived one, a locked synced one — arrives there as a copy that stays linked: what the
 * source changes (its title, the fields of the same name, its text while the copy's text is as it was sent) the copy follows,
 * the copy's own column and fields never. Unlinked, the copy is a plain row. One source, one copy per database.
 */

const ready = new WeakSet<object>();
function table() {
  const d = getSqlite();
  if (!ready.has(d)) {
    d.exec(
      "create table if not exists ws_row_links (target_row integer primary key, source_row integer not null, target_db integer not null, content_hash text, created_at text not null);" +
        "create index if not exists ws_row_links_source on ws_row_links (source_row)",
    );
    ready.add(d);
  }
  return d;
}

/** Databases that receive rows (not archived), for the "send to …" choices. */
export function receivingDatabases(): { id: number; title: string; icon: string; column: string }[] {
  const rows = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[];
  return rows.flatMap(({ id }) => {
    const d = getDatabase(id);
    const r = d?.schema.receive;
    if (!d || !r) return [];
    const column = d.schema.properties.find((p) => p.id === r.prop)?.options?.find((o) => o.id === r.value)?.name ?? "";
    return [{ id, title: d.page.title || "Untitled", icon: d.page.icon, column }];
  });
}

/** What a copy is linked to: its source row, its title, its database's name — none for a plain row. */
export function linkOf(targetRow: number): { source: number; sourceTitle: string; sourceDb: string } | null {
  const l = table().prepare("select source_row from ws_row_links where target_row = ?").get(targetRow) as { source_row: number } | undefined;
  const src = l ? getPage(l.source_row) : null;
  if (!l || !src || src.archivedAt) return null;
  return { source: src.id, sourceTitle: src.title, sourceDb: src.dbId ? (getPage(src.dbId)?.title ?? "") : "" };
}

/** Which of these rows are linked copies (one query): by row. */
export function linksIn(rowIds: number[]): Record<number, { source: number; sourceTitle: string; sourceDb: string }> {
  if (!rowIds.length) return {};
  const out: Record<number, { source: number; sourceTitle: string; sourceDb: string }> = {};
  const rows = table().prepare(`select target_row, source_row from ws_row_links where target_row in (${rowIds.map(() => "?").join(",")})`).all(...rowIds) as { target_row: number; source_row: number }[];
  for (const l of rows) {
    const src = getPage(l.source_row);
    if (src && !src.archivedAt) out[l.target_row] = { source: src.id, sourceTitle: src.title, sourceDb: src.dbId ? (getPage(src.dbId)?.title ?? "") : "" };
  }
  return out;
}

/** The copies of a row, as rows (sent once per database). */
export function copiesOf(sourceRow: number): { row: number; db: number }[] {
  return (table().prepare("select target_row, target_db from ws_row_links where source_row = ?").all(sourceRow) as { target_row: number; target_db: number }[])
    .filter((x) => !getPage(x.target_row)?.archivedAt)
    .map((x) => ({ row: x.target_row, db: x.target_db }));
}

const hashOf = (content: unknown): string => JSON.stringify(content);

/** A source's value as the target's property takes it: by name for a choice, as text for text-like, else the same kind as it is. */
function valueFor(sp: Property, tp: Property, v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (tp.type === "select" || tp.type === "status") {
    const name = cellText(sp, v).toLowerCase();
    return tp.options?.find((o) => o.name.toLowerCase() === name)?.id ?? null;
  }
  if (tp.type === "multi_select") {
    const names = cellText(sp, v).split(/,\s*/).map((x) => x.toLowerCase());
    const ids = names.map((n) => tp.options?.find((o) => o.name.toLowerCase() === n)?.id).filter(Boolean);
    return ids.length ? ids : null;
  }
  if (["text", "markdown", "url", "email", "phone", "ai"].includes(tp.type)) return cellText(sp, v);
  if (tp.type === "number") return typeof v === "number" ? v : Number(cellText(sp, v).replace(",", ".")) || null;
  if (tp.type === "checkbox") return v === true;
  if (tp.type === "date") return sp.type === "date" ? v : null;
  return null;
}

/** The fields a copy takes from its source: the properties of the same name — not its own column, nothing computed. */
function copyFields(sourceRow: number, targetRow: number): void {
  const s = getPage(sourceRow);
  const t = getPage(targetRow);
  const sd = s?.dbId ? getDatabase(s.dbId) : null;
  const td = t?.dbId ? getDatabase(t.dbId) : null;
  if (!s || !t || !sd || !td) return;
  for (const tp of td.schema.properties) {
    if (isComputed(tp) || tp.id === td.schema.receive?.prop || tp.type === "status") continue;
    const sp = sd.schema.properties.find((x) => x.name.toLowerCase() === tp.name.toLowerCase());
    if (!sp) continue;
    const v = valueFor(sp, tp, s.props[sp.id]);
    const cur = t.props[tp.id];
    if (JSON.stringify(coerceCell(tp, v) ?? null) !== JSON.stringify(cur ?? null)) setCell(targetRow, tp.id, v);
  }
}

/**
 * Send a row to a receiving database: a linked copy in its landing column (its title, the fields of the same name, its text).
 * Sent once: sending again gives the same copy back.
 */
export function sendRow(sourceRow: number, targetDb: number): { row: number; existing: boolean } {
  const src = getPage(sourceRow);
  if (!src?.dbId) throw new Error("Only a row of a database can be sent.");
  const td = getDatabase(targetDb);
  const r = td?.schema.receive;
  if (!td || !r) throw new Error("This database doesn't receive rows — switch “Receive tickets” on in its menu.");
  if (targetDb === src.dbId) throw new Error("A row can't be sent to its own database.");
  const known = copiesOf(sourceRow).find((c) => c.db === targetDb);
  if (known) return { row: known.row, existing: true };
  const row = addRow(targetDb, { title: src.title, cells: { [r.prop]: r.value } });
  copyFields(sourceRow, row);
  if (src.content.content?.length) updatePage(row, { content: src.content });
  table().prepare("insert into ws_row_links (target_row, source_row, target_db, content_hash, created_at) values (?, ?, ?, ?, ?)").run(row, sourceRow, targetDb, hashOf(getPage(row)!.content), new Date().toISOString());
  return { row, existing: false };
}

/** The link taken off: the copy is a plain row from now on. False: it wasn't linked. */
export function unlink(targetRow: number): boolean {
  return table().prepare("delete from ws_row_links where target_row = ?").run(targetRow).changes > 0;
}

const syncing = new Set<number>();

/**
 * A row changed: its copies follow — title, same-named fields, and the text while the copy's own text is as it was last synced.
 * Called by the store after a row's change; cheap when the row has no copies.
 */
export function syncLinkedFrom(sourceRow: number): void {
  if (syncing.has(sourceRow)) return;
  const d = table();
  const links = d.prepare("select target_row, content_hash from ws_row_links where source_row = ?").all(sourceRow) as { target_row: number; content_hash: string | null }[];
  if (!links.length) return;
  const src = getPage(sourceRow);
  if (!src) return;
  syncing.add(sourceRow);
  try {
    for (const l of links) {
      const t = getPage(l.target_row);
      if (!t || t.archivedAt) continue;
      if (t.title !== src.title) updatePage(t.id, { title: src.title });
      copyFields(sourceRow, t.id);
      // The text: only while the copy hasn't been written in since the last sync (then it isn't the copy's own).
      if (hashOf(t.content) === l.content_hash && hashOf(src.content) !== l.content_hash) {
        updatePage(t.id, { content: src.content });
        d.prepare("update ws_row_links set content_hash = ? where target_row = ?").run(hashOf(getPage(t.id)!.content), t.id);
      }
    }
  } finally {
    syncing.delete(sourceRow);
  }
}
