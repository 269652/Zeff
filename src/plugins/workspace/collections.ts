import { getSqlite } from "@/db";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { CollectionProvider } from "@/lib/items/point";
import { getPref, setPref } from "@/lib/prefs";
import type { Collection, Item, ItemAction } from "@/lib/items/shared";
import { getPerson } from "@/plugins/people/store";
import { docText } from "./doc";
import type { DbSchema, Row } from "./model";
import { getDatabase, getPage, rawRows, setCell, tree, updatePage } from "./store";

/**
 * Your Workspace databases as collections (workspace:<id>), their rows as items (page:<id>). What
 * an item has comes from the first property of its kind: a status (its group is the phase), a date
 * (a range: its start), a person, a multi-select (the labels). A database with a board view by its
 * status is a board. A row's ticket key: its Key (the property `ticketkey` — a moved Kanban card keeps
 * KB-<id> there), else WS-<id>; a note's row (one with its own ref) is no ticket. A row's ref: its own
 * (the property `noteref` — a moved Keep note keeps keep:n<id> there), else page:<id>. A note's colour
 * and pinned: the properties `color` (a select) and `pinned` (a checkbox).
 */

/** The property id of a row's own ticket key (a moved Kanban card's KB-<id>). */
export const KEY_PROP = "ticketkey";
/** The property ids of a note's row: its own ref (a moved Keep note's keep:n<id>), its colour, pinned. */
export const NOTE_PROP = "noteref";
export const COLOR_PROP = "color";
export const PINNED_PROP = "pinned";
const ownKey = (id: number) => `WS-${id}`;

const collectionId = (dbId: number) => `workspace:${dbId}`;

/** A row's ticket key: its Key, else WS-<id> — none for a note's row (one with its own ref). */
export function rowKey(r: Pick<Row, "id" | "cells">): string | null {
  const key = r.cells[KEY_PROP];
  const note = r.cells[NOTE_PROP];
  return typeof key === "string" && key.trim() ? key.trim().toUpperCase() : typeof note === "string" && note ? null : ownKey(r.id);
}

/** The databases in the briefing and in the knowledge (none at first). */
const SWITCHES = "workspace.collections";
type Switches = { briefing: number[]; knowledge: number[] };
const switches = (): Switches => ({ briefing: [], knowledge: [], ...getPref<Partial<Switches>>(SWITCHES, {}) });

/** The databases a sync keeps (Jira's boards, Google Keep): their source, by database. */
const SOURCES = "workspace.sources";
const sources = (): Record<string, string> => getPref<Record<string, string>>(SOURCES, {});
/** A database marked as kept by a sync from `source` (null: its own again). */
export function setDatabaseSource(dbId: number, source: string | null): void {
  const next = { ...sources() };
  if (source) next[dbId] = source;
  else delete next[dbId];
  setPref(SOURCES, next);
}
const named = (icon: string, title: string) => [icon, title || "Untitled"].filter(Boolean).join(" ");

function itemsOf(dbId: number, schema: DbSchema, rows: Row[]): Item[] {
  const first = (type: string) => schema.properties.find((p) => p.type === type);
  const status = first("status");
  const date = first("date");
  const person = first("person");
  const tags = first("multi_select");
  return rows.map((r): Item => {
    const page = getPage(r.id);
    const opt = status && status.options?.find((o) => o.id === r.cells[status.id]);
    const d = date ? r.cells[date.id] : null;
    const who = person ? (r.cells[person.id] as number[] | null)?.[0] : undefined;
    const tagIds = tags ? ((r.cells[tags.id] as string[] | null) ?? []) : [];
    const note = r.cells[NOTE_PROP];
    const color = schema.properties.find((p) => p.id === COLOR_PROP)?.options?.find((o) => o.id === r.cells[COLOR_PROP]);
    return {
      ref: typeof note === "string" && note ? note : `page:${r.id}`,
      key: rowKey(r),
      collectionId: collectionId(dbId),
      kind: "row",
      title: r.title,
      text: docText(page?.content),
      labels: tagIds.flatMap((id) => tags!.options?.find((o) => o.id === id)?.name ?? []),
      status: opt ? { name: opt.name, phase: opt.group ?? "todo" } : null,
      due: typeof d === "string" ? d : d && typeof d === "object" && "start" in d ? String(d.start) : null,
      assignee: who ? (getPerson(who)?.name ?? null) : null,
      color: color?.name ?? null,
      pinned: r.cells[PINNED_PROP] === true,
      archived: !!page?.archivedAt,
      parentRef: null,
      href: `/workspace/${r.id}`,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/** The rows (not archived) whose property `prop` is one of `values` (any case). */
function rowsWhere(prop: string, values: string[]): number[] {
  if (!values.length) return [];
  tree(); // (the table is made when first needed)
  return (getSqlite()
    .prepare(`select id from ws_pages where db_id is not null and archived_at is null and template = 0 and upper(json_extract(props, '$.${prop}')) in (${values.map(() => "?").join(", ")})`)
    .all(...values.map((v) => v.toUpperCase())) as { id: number }[]).map((r) => r.id);
}

/** The items of these rows, by their databases. */
function itemsOfRows(ids: Iterable<number>): Item[] {
  const byDb = new Map<number, number[]>();
  for (const id of ids) {
    const p = getPage(id);
    if (p?.dbId) byDb.set(p.dbId, [...(byDb.get(p.dbId) ?? []), id]);
  }
  const out: Item[] = [];
  for (const [dbId, rowIds] of byDb) {
    const d = getDatabase(dbId);
    if (!d) continue;
    out.push(...itemsOf(dbId, d.schema, rawRows(dbId).filter((r) => rowIds.includes(r.id))));
  }
  return out;
}

/** The rows with these ticket keys (WS-<id>, or their Key). */
export const rowsByKeys = (keys: string[]): number[] => [...keys.flatMap((k) => (/^WS-\d+$/.test(k) ? [Number(k.slice(3))] : [])), ...rowsWhere(KEY_PROP, keys.filter((k) => !/^WS-\d+$/.test(k)))];

/** A Lage suggestion on a row (its ticket key): a move sets its status; a note goes on its page, dated. */
function rowAction(rowId: number, action: ItemAction): string {
  const page = getPage(rowId)!;
  const status = getDatabase(page.dbId!)?.schema.properties.find((p) => p.type === "status");
  if (action.type === "transition" && status) {
    const want = (action.to ?? "").trim().toLowerCase();
    const opts = status.options ?? [];
    const hit = opts.find((o) => o.name.trim().toLowerCase() === want) ?? opts.find((o) => !!want && o.name.toLowerCase().includes(want));
    if (!hit) throw new Error(t("No status “{name}” — there are: {statuses}.", { name: action.to ?? "", statuses: opts.map((o) => o.name).join(", ") }));
    setCell(rowId, status.id, hit.id);
    return `→ ${hit.name}`;
  }
  if (action.type === "comment" && action.comment?.trim()) {
    const note = `— ${formatDate(new Date(), { weekday: false, year: true })}: ${action.comment.trim()}`;
    updatePage(rowId, { content: { ...page.content, content: [...page.content.content, { type: "paragraph", content: [{ type: "text", text: note }] }] } });
    return t("Note on the card");
  }
  throw new Error(t("That doesn't work on a row (no assignment)."));
}

export const workspaceCollections: CollectionProvider = {
  collections: () => {
    const on = switches();
    const from = sources();
    return tree()
      .filter((p) => p.kind === "database")
      .map((p): Collection => {
        const page = getPage(p.id);
        const schema = page?.schema;
        const status = schema?.properties.find((x) => x.type === "status");
        const board = !!status && !!schema?.views.some((v) => v.type === "board" && v.groupBy === status.id);
        return {
          id: collectionId(p.id),
          plugin: "workspace",
          kind: board ? "board" : "database",
          name: named(p.icon, p.title),
          description: "",
          color: null,
          href: `/workspace/${p.id}`,
          readOnly: !!page?.locked,
          briefing: on.briefing.includes(p.id),
          knowledge: on.knowledge.includes(p.id),
          items: rawRows(p.id).length,
          ...(board ? { statuses: status!.options?.map((o) => o.name) ?? [] } : {}),
          ...(from[p.id] ? { source: from[p.id] } : {}),
        };
      });
  },
  set(id, patch) {
    const m = /^workspace:(\d+)$/.exec(id);
    if (!m || !getDatabase(Number(m[1]))) return false;
    const dbId = Number(m[1]);
    const on = switches();
    const flip = (list: number[], v: boolean | undefined) => (v === undefined ? list : [...list.filter((x) => x !== dbId), ...(v ? [dbId] : [])]);
    setPref(SWITCHES, { briefing: flip(on.briefing, patch.briefing), knowledge: flip(on.knowledge, patch.knowledge) });
    return true;
  },
  items(id) {
    const m = /^workspace:(\d+)$/.exec(id);
    const d = m ? getDatabase(Number(m[1])) : null;
    if (!d || d.page.archivedAt) return null;
    return itemsOf(d.page.id, d.schema, rawRows(d.page.id));
  },
  byKeys(keys) {
    const wanted = new Set(keys);
    return itemsOfRows(rowsByKeys(keys)).filter((it) => it.key && wanted.has(it.key));
  },
  act(key, action) {
    const row = rowsByKeys([key]).find((id) => itemsOfRows([id]).some((it) => it.key === key));
    return row ? rowAction(row, action) : null;
  },
  byRefs(refs) {
    const pages = refs.flatMap((r) => (/^page:\d+$/.test(r) ? [Number(r.slice(5))] : []));
    const own = rowsWhere(NOTE_PROP, refs.filter((r) => !/^page:\d+$/.test(r)));
    const wanted = new Set(refs);
    return itemsOfRows(new Set([...pages, ...own])).filter((it) => wanted.has(it.ref));
  },
};
