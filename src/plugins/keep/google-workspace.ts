import { getSqlite } from "@/db";
import { setCollection } from "@/lib/items";
import { getPref, setPref } from "@/lib/prefs";
import { COLOR_PROP, NOTE_PROP, PINNED_PROP, setDatabaseSource } from "@/plugins/workspace/collections";
import { markdownToDoc } from "@/plugins/workspace/doc";
import { COLORS, newId, newView, type DbSchema, type Option, type Property } from "@/plugins/workspace/model";
import { addRow, archivePage, createPage, getDatabase, rawRows, setCell, updatePage, updateSchema } from "@/plugins/workspace/store";
import { KEEP_COLORS } from "./colors";
import { allKeepNotes, type KeepNote } from "./store";

/**
 * Google Keep as a data source of the Workspace: its notes (as the Keep sync reads them) kept in a gallery database
 * "Google Keep" — each note a row with its ref (keep:<Google's id>), colour, pinned, labels, text and checklists as its
 * page; read-only (Google Keep is where they change), in the briefing and the knowledge as Google Keep was. Each sync
 * writes only what changed (a note's last edit in Google is kept with it); notes gone from Keep go to the trash.
 */

const DB = "keep.googleDb";
const LABELS = "labels";
/** When Google last changed the note (what decides whether it's written again). */
const EDITED = "keepedited";

const WS_COLOR: Record<string, string> = { teal: "green", cerulean: "blue" };
const wsColor = (c: string) => WS_COLOR[c] ?? ((COLORS as readonly string[]).includes(c) ? c : "gray");
const option = (name: string, color: string): Option => ({ id: newId("o"), name, color });
const iso = (t: string | null) => new Date(t ?? Date.now()).toISOString();
const firstLine = (text: string) => text.split(/\r?\n/)[0].replace(/^- \[[ xX]\] /, "").slice(0, 120);

/** The database Google Keep is kept in (null: none yet, or it's gone). */
export function googleKeepDatabase(): number | null {
  const id = getPref<number | null>(DB, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** Where Keep's Google view leads now: its database; null: not kept yet. */
export const googleKeepHref = (): string | null => {
  const id = googleKeepDatabase();
  return id ? `/workspace/${id}` : null;
};

function newSchema(): DbSchema {
  const color: Property = { id: COLOR_PROP, name: "Color", type: "select", options: Object.keys(KEEP_COLORS).map((c) => option(c, wsColor(c))) };
  const pinned: Property = { id: PINNED_PROP, name: "Pinned", type: "checkbox" };
  const labels: Property = { id: LABELS, name: "Labels", type: "multi_select", options: [] };
  const ref: Property = { id: NOTE_PROP, name: "Note", type: "text" };
  const edited: Property = { id: EDITED, name: "Edited in Keep", type: "text" };
  return {
    titleName: "Title",
    properties: [color, pinned, labels, ref, edited],
    views: [{ ...newView("Notes", "gallery"), sorts: [{ prop: PINNED_PROP, dir: "desc" }], hidden: [NOTE_PROP, PINNED_PROP, EDITED] }, newView("Table", "table")],
  };
}

function ensureDatabase(): number {
  const known = googleKeepDatabase();
  if (known) return known;
  // (No icon: its name is its space in the knowledge — "Google Keep" as before.)
  const id = createPage({ kind: "database", title: "Google Keep", schema: newSchema() });
  updatePage(id, { fullWidth: true, locked: true });
  setDatabaseSource(id, "google-keep");
  setCollection(`workspace:${id}`, { briefing: true, knowledge: true });
  setPref(DB, id);
  return id;
}

export type GoogleKeepSync = { notes: number; created: number; updated: number; archived: number };

/** Google Keep's notes (not the archived) into their database: rows made, changed (only what differs), gone ones to the trash. */
export function syncGoogleKeepDatabase(): GoogleKeepSync {
  const notes = allKeepNotes().filter((n) => !n.archived);
  const out: GoogleKeepSync = { notes: notes.length, created: 0, updated: 0, archived: 0 };
  const dbId = ensureDatabase();
  // The labels as now (known ones keep their ids).
  const cur = getDatabase(dbId)!.schema;
  const labelProp = cur.properties.find((p) => p.id === LABELS)!;
  const known = new Map((labelProp.options ?? []).map((o) => [o.name, o]));
  const names = [...new Set(notes.flatMap((n) => n.labels))];
  const fresh = names.filter((n) => !known.has(n));
  if (fresh.length) {
    const options = [...(labelProp.options ?? []), ...fresh.map((n, i) => option(n, COLORS[(known.size + i + 3) % COLORS.length]))];
    updateSchema(dbId, { ...cur, properties: cur.properties.map((p) => (p.id === LABELS ? { ...p, options } : p)) });
  }
  const schema = getDatabase(dbId)!.schema;
  const colorOpt = (c: string | null) => (c ? schema.properties.find((p) => p.id === COLOR_PROP)?.options?.find((o) => o.name === c)?.id : undefined);
  const labelIds = (ls: string[]) => ls.map((l) => schema.properties.find((p) => p.id === LABELS)!.options!.find((o) => o.name === l)!.id);

  const rows = new Map(rawRows(dbId).map((r) => [String(r.cells[NOTE_PROP] ?? ""), r]));
  const times = getSqlite().prepare("update ws_pages set created_at = ?, updated_at = ? where id = ?");
  const write = (row: number, n: KeepNote) => {
    updatePage(row, { content: markdownToDoc(n.text) });
    times.run(iso(n.createdAt), iso(n.updatedAt ?? n.createdAt), row);
  };
  for (const n of notes) {
    const ref = `keep:${n.id}`;
    const title = n.title || firstLine(n.text);
    const cells: Record<string, unknown> = { [COLOR_PROP]: colorOpt(n.color), [PINNED_PROP]: n.pinned || undefined, [LABELS]: n.labels.length ? labelIds(n.labels) : undefined, [NOTE_PROP]: ref, [EDITED]: n.updatedAt ?? "" };
    const row = rows.get(ref);
    if (!row) {
      const id = addRow(dbId, { title, cells });
      write(id, n);
      out.created++;
      continue;
    }
    rows.delete(ref);
    const changed = row.title !== title || Object.entries(cells).some(([k, v]) => JSON.stringify(row.cells[k] ?? undefined) !== JSON.stringify(v ?? undefined));
    if (!changed) continue;
    if (row.title !== title) updatePage(row.id, { title });
    for (const [k, v] of Object.entries(cells)) if (JSON.stringify(row.cells[k] ?? undefined) !== JSON.stringify(v ?? undefined)) setCell(row.id, k, v ?? null);
    write(row.id, n);
    out.updated++;
  }
  for (const gone of rows.values()) {
    archivePage(gone.id);
    out.archived++;
  }
  return out;
}
