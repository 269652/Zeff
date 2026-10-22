/**
 * The Workspace plugin's storage: pages in a tree, each with a document (see doc.ts); databases are
 * pages whose rows are pages too (so a row has a body of its own); links between pages and to people,
 * todos and tickets (backlinks); a history of earlier versions; a full-text index. Its own tables,
 * made when first needed. Server only.
 */
import { afterJobChange } from "./jobs";
import { syncLinkedFrom } from "./links";
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { isSystemPage, systemPageIds } from "@/lib/prompts/system-pages";
import { inAgentScope, runAgentGuards } from "./agent-scope";
import { emitChange } from "@/lib/events";
import { emitRowEvent, isViaSource } from "./events";
import { workspaceSources } from "./source-point";
import { logChange } from "./activity";
import { parseCustom } from "./field-types";
import { made, touch } from "./undo";
import { docRefs, docText, emptyDoc, sanitizeDoc, withTaskIds, type Doc, type DocRef } from "./doc";
import { sourceTable } from "./source-table";
import { cellText, computeRows, dateRange, defaultSchema, isComputed, SYSTEM_PROPS, newProperty, normalizeSchema, propById, TITLE, type DbSchema, type Labels, type Property, type Row } from "./model";

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_pages (
      id integer primary key autoincrement, parent_id integer, db_id integer, kind text not null default 'page',
      title text not null default '', icon text not null default '', cover text not null default '',
      content text not null default '', body_text text not null default '', props text not null default '{}', schema text,
      position real not null default 0, favorite integer not null default 0, full_width integer not null default 0, small_text integer not null default 0,
      locked integer not null default 0, template integer not null default 0, archived_at text, rev integer not null default 1,
      created_at text not null, updated_at text not null, opened_at text
    );
    create index if not exists ws_pages_parent on ws_pages (parent_id);
    create index if not exists ws_pages_db on ws_pages (db_id);
    create table if not exists ws_versions (id integer primary key autoincrement, page_id integer not null, title text not null default '', content text not null, at text not null);
    create index if not exists ws_versions_page on ws_versions (page_id, id);
    create table if not exists ws_links (page_id integer not null, kind text not null, ref text not null, label text not null default '', primary key (page_id, kind, ref));
    create index if not exists ws_links_ref on ws_links (kind, ref);
    create virtual table if not exists ws_fts using fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
  `);
  return d;
}

const now = () => new Date().toISOString();
const changed = () => emitChange("workspace");
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

export type Page = {
  id: number;
  parentId: number | null;
  dbId: number | null;
  kind: "page" | "database";
  title: string;
  icon: string;
  cover: string;
  content: Doc;
  props: Record<string, unknown>;
  schema: DbSchema | null;
  position: number;
  favorite: boolean;
  fullWidth: boolean;
  smallText: boolean;
  locked: boolean;
  template: boolean;
  archivedAt: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
};

type PRow = { id: number; parent_id: number | null; db_id: number | null; kind: string; title: string; icon: string; cover: string; content: string; props: string; schema: string | null; position: number; favorite: number; full_width: number; small_text: number; locked: number; template: number; archived_at: string | null; rev: number; created_at: string; updated_at: string };

const parse = <T>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

const toPage = (r: PRow): Page => ({
  id: r.id,
  parentId: r.parent_id,
  dbId: r.db_id,
  kind: r.kind === "database" ? "database" : "page",
  title: r.title,
  icon: r.icon,
  cover: r.cover,
  content: r.content ? sanitizeDoc(parse(r.content, null)) : emptyDoc(),
  props: parse<Record<string, unknown>>(r.props, {}),
  schema: r.kind === "database" ? normalizeSchema(parse(r.schema, null)) : null,
  position: r.position,
  favorite: !!r.favorite,
  fullWidth: !!r.full_width,
  smallText: !!r.small_text,
  locked: !!r.locked,
  template: !!r.template,
  archivedAt: r.archived_at,
  rev: r.rev,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function getPage(id: number): Page | null {
  const r = db().prepare("select * from ws_pages where id = ?").get(id) as PRow | undefined;
  return r ? toPage(r) : null;
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type TreeItem = { id: number; parentId: number | null; kind: "page" | "database"; title: string; icon: string; favorite: boolean; position: number; /** A system page: stays (not to the trash, not moved away). */ system?: boolean };

/** Every page of the tree (not the rows of databases, not the trash, not templates), in sibling order. */
export function tree(): TreeItem[] {
  const system = new Set(systemPageIds());
  return (db().prepare("select id, parent_id, kind, title, icon, favorite, position from ws_pages where db_id is null and archived_at is null and template = 0 order by position, id").all() as { id: number; parent_id: number | null; kind: string; title: string; icon: string; favorite: number; position: number }[]).map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind === "database" ? "database" : "page",
    title: r.title,
    icon: r.icon,
    favorite: !!r.favorite,
    position: r.position,
    ...(system.has(r.id) ? { system: true } : {}),
  }));
}

/** The pages above a page, the root first (a row: its database and the ones above that). */
export function breadcrumbs(id: number): { id: number; title: string; icon: string; kind: string }[] {
  const out: { id: number; title: string; icon: string; kind: string }[] = [];
  const seen = new Set<number>();
  let at = db().prepare("select id, parent_id, db_id, title, icon, kind from ws_pages where id = ?").get(id) as { id: number; parent_id: number | null; db_id: number | null; title: string; icon: string; kind: string } | undefined;
  at = at && (at.db_id ?? at.parent_id) ? (db().prepare("select id, parent_id, db_id, title, icon, kind from ws_pages where id = ?").get((at.db_id ?? at.parent_id)!) as typeof at | undefined) : undefined;
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    out.unshift({ id: at.id, title: at.title, icon: at.icon, kind: at.kind });
    at = at.parent_id ? (db().prepare("select id, parent_id, db_id, title, icon, kind from ws_pages where id = ?").get(at.parent_id) as typeof at | undefined) : undefined;
  }
  return out;
}

const maxPosition = (parentId: number | null): number => ((db().prepare("select max(position) m from ws_pages where db_id is null and template = 0 and parent_id is ?").get(parentId) as { m: number | null }).m ?? 0) + 1;

export type NewPage = { parentId?: number | null; title?: string; icon?: string; kind?: "page" | "database"; dbId?: number | null; content?: unknown; props?: Record<string, unknown>; schema?: DbSchema; template?: boolean };

/** Whether a value is already another row's in a field that may not repeat (`TITLE`: the title). Empty values never clash. */
function clashes(dbId: number, propId: string, text: string, exceptRow?: number): boolean {
  const key = text.trim().toLowerCase();
  if (!key) return false;
  const d = getDatabase(dbId);
  const p = propId === TITLE ? undefined : d?.schema.properties.find((q) => q.id === propId);
  return rawRows(dbId).some((r) => r.id !== exceptRow && (propId === TITLE ? r.title : p ? cellText(p, r.cells[p.id]) : "").trim().toLowerCase() === key);
}

/**
 * What the database's protection (schema.protect) lets through - for you and for the AI; a source writing its own records is let through.
 * `fields`: the values a row would have (a new row, or the one cell being set) in the fields that may not repeat.
 */
function protectCheck(dbId: number, act: "add" | "set" | "remove", fields: Record<string, string> = {}, rowId?: number): void {
  const rule = getDatabase(dbId)?.schema.protect;
  if (!rule || isViaSource()) return;
  if (rule.lock) throw new Error("This database is locked — its rows can't be added, changed or removed.");
  if (inAgentScope() && rule.ai && (rule.ai === "read" || act !== "add")) throw new Error(rule.ai === "read" ? "The AI may not change this database (set by you)." : "The AI may only add rows to this database, not change or remove them (set by you).");
  for (const id of rule.unique ?? []) {
    if (id in fields && clashes(dbId, id, fields[id], rowId)) throw new Error(`"${id === TITLE ? "title" : (getDatabase(dbId)?.schema.properties.find((p) => p.id === id)?.name ?? id)}" must be unique — "${fields[id]}" is already taken.`);
  }
}

/** A page made. A row (`dbId`) takes the database's place in the tree; a database gets a default schema. */
export function createPage(v: NewPage = {}): number {
  noAgentOnSystem(v.parentId ?? v.dbId);
  if (v.dbId && getDatabase(v.dbId)?.schema.protect) {
    const schema = getDatabase(v.dbId)!.schema;
    const props = v.props ?? {};
    protectCheck(v.dbId, "add", Object.fromEntries((schema.protect?.unique ?? []).map((id) => [id, id === TITLE ? (v.title ?? "") : cellText(schema.properties.find((p) => p.id === id)!, props[id])])));
  }
  const d = db();
  const kind = v.kind === "database" ? "database" : "page";
  if (v.dbId) {
    const parent = getPage(v.dbId);
    if (!parent || parent.kind !== "database") throw new Error("No such database.");
  }
  if (v.parentId && !getPage(v.parentId)) throw new Error("No such page.");
  const doc = v.content === undefined ? emptyDoc() : withTaskIds(sanitizeDoc(v.content));
  const at = now();
  const r = d
    .prepare("insert into ws_pages (parent_id, db_id, kind, title, icon, content, body_text, props, schema, position, template, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      v.dbId ? null : (v.parentId ?? null),
      v.dbId ?? null,
      kind,
      clip(v.title, 300),
      clip(v.icon, 16),
      JSON.stringify(doc),
      docText(doc),
      JSON.stringify(v.props ?? {}),
      kind === "database" ? JSON.stringify(v.schema ? normalizeSchema(v.schema) : defaultSchema()) : null,
      v.dbId ? Date.now() / 1000 : maxPosition(v.parentId ?? null),
      v.template ? 1 : 0,
      at,
      at,
    );
  const id = Number(r.lastInsertRowid);
  made(id);
  index(id);
  relink(id, doc);
  logChange(id, "created");
  changed();
  return id;
}

/**
 * What a row's cells say, as words for the search: its texts, links, numbers, dates and the names of its choices (a publisher, a
 * sender, tags, a status) - not the ones that are ids (people, relations, todos) and not what Zeff keeps for itself.
 */
function cellWords(dbId: number | null, propsJson: string): string {
  if (!dbId) return "";
  const schema = getDatabase(dbId)?.schema;
  if (!schema) return "";
  const props = parse<Record<string, unknown>>(propsJson, {});
  const skip = new Set(["person", "relation", "todo", "checkbox", "rollup", "formula", "created_time", "updated_time", "ai"]);
  return schema.properties
    .filter((q) => !SYSTEM_PROPS.has(q.id) && !skip.has(q.type) && props[q.id] !== undefined)
    .map((q) => cellText(q, props[q.id]))
    .filter(Boolean)
    .join("\n");
}

function index(id: number) {
  const d = db();
  const p = d.prepare("select title, body_text, archived_at, db_id, props from ws_pages where id = ?").get(id) as { title: string; body_text: string; archived_at: string | null; db_id: number | null; props: string } | undefined;
  d.prepare("delete from ws_fts where rowid = ?").run(id);
  if (p && !p.archived_at) d.prepare("insert into ws_fts (rowid, title, body) values (?, ?, ?)").run(id, p.title, [p.body_text, cellWords(p.db_id, p.props)].filter(Boolean).join("\n"));
}

/**
 * Every page read into the search again, once: the cells of the rows (a publisher, a sender, tags) are in it now, not only titles
 * and texts. A row that is changed later keeps its entry up to date by itself.
 */
export function reindexOnce(): void {
  const flag = "workspace.ftsCells";
  if (getPref<boolean>(flag, false)) return;
  const ids = (db().prepare("select id from ws_pages where archived_at is null").all() as { id: number }[]).map((r) => r.id);
  db().transaction(() => ids.forEach(index))();
  setPref(flag, true);
}

function relink(id: number, doc: Doc) {
  const d = db();
  d.prepare("delete from ws_links where page_id = ?").run(id);
  const ins = d.prepare("insert or ignore into ws_links (page_id, kind, ref, label) values (?, ?, ?, ?)");
  for (const r of docRefs(doc)) ins.run(id, r.kind, r.ref, r.label.slice(0, 200));
}

export type PagePatch = { title?: string; icon?: string; cover?: string; content?: unknown; favorite?: boolean; fullWidth?: boolean; smallText?: boolean; locked?: boolean; template?: boolean };
export type SaveResult = { ok: true; rev: number; updatedAt: string } | { ok: false; conflict: true; rev: number };

/** How long a version stays the newest before another one is kept (minutes). */
const VERSION_EVERY_MS = 10 * 60000;
const VERSIONS_KEPT = 60;

/**
 * A page changed. `rev` is the revision the editor started from: when the page has moved on since (another
 * tab, an agent) and the content would be overwritten, nothing is saved and the conflict is reported.
 */
export function updatePage(id: number, patch: PagePatch, rev?: number): SaveResult {
  noAgentOnSystem(id);
  const d = db();
  const cur = d.prepare("select * from ws_pages where id = ?").get(id) as PRow | undefined;
  if (!cur) throw new Error("No such page.");
  touch(id);
  if (patch.content !== undefined && rev !== undefined && rev !== cur.rev) return { ok: false, conflict: true, rev: cur.rev };
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), args.push(v));
  let doc: Doc | null = null;
  if (patch.title !== undefined) {
    if (cur.db_id && clip(patch.title, 300) !== cur.title) protectCheck(cur.db_id, "set", { [TITLE]: clip(patch.title, 300) }, id);
    set("title", clip(patch.title, 300));
    logChange(id, "title", cur.title, clip(patch.title, 300));
  }
  if (patch.icon !== undefined) set("icon", clip(patch.icon, 16));
  if (patch.cover !== undefined) set("cover", /^(gradient:[a-z0-9-]+|\/api\/workspace\/files\/[\w.-]+|https?:\/\/\S+)?$/i.test(patch.cover) ? patch.cover : "");
  if (patch.favorite !== undefined) set("favorite", patch.favorite ? 1 : 0);
  if (patch.fullWidth !== undefined) set("full_width", patch.fullWidth ? 1 : 0);
  if (patch.smallText !== undefined) set("small_text", patch.smallText ? 1 : 0);
  if (patch.locked !== undefined) set("locked", patch.locked ? 1 : 0);
  if (patch.template !== undefined) set("template", patch.template ? 1 : 0);
  let newRev = cur.rev;
  if (patch.content !== undefined) {
    doc = withTaskIds(sanitizeDoc(patch.content), parse<Doc | null>(cur.content, null));
    const json = JSON.stringify(doc);
    if (json !== cur.content) {
      // The state before this change is kept as a version — at most one every ten minutes.
      const last = d.prepare("select at from ws_versions where page_id = ? order by id desc limit 1").get(id) as { at: string } | undefined;
      if (cur.content && (!last || Date.now() - Date.parse(last.at) > VERSION_EVERY_MS)) {
        d.prepare("insert into ws_versions (page_id, title, content, at) values (?, ?, ?, ?)").run(id, cur.title, cur.content, now());
        d.prepare("delete from ws_versions where page_id = ? and id not in (select id from ws_versions where page_id = ? order by id desc limit ?)").run(id, id, VERSIONS_KEPT);
      }
      set("content", json);
      set("body_text", docText(doc));
      logChange(id, "text");
      newRev = cur.rev + 1;
      set("rev", newRev);
    } else doc = null;
  }
  if (!sets.length) return { ok: true, rev: cur.rev, updatedAt: cur.updated_at };
  const at = now();
  // Only a change of what the page says moves "edited" (a favorite star isn't an edit).
  const editing = patch.title !== undefined || patch.content !== undefined || patch.icon !== undefined || patch.cover !== undefined;
  if (editing) set("updated_at", at);
  d.prepare(`update ws_pages set ${sets.join(", ")} where id = ?`).run(...args, id);
  if (patch.title !== undefined || doc) index(id);
  if (doc) relink(id, doc);
  changed();
  if (cur.db_id && patch.title !== undefined) afterTodoRowChange(id);
  if (cur.db_id && (patch.title !== undefined || doc)) syncLinkedFrom(id); // (its copies in other databases follow — links.ts)
  // A page with to-do lists that feed the Todo engine (or did): the engine follows (task-lists.ts).
  if (doc && (cur.content.includes('"engine":true') || JSON.stringify(doc).includes('"engine":true'))) void import("./task-lists").then((m) => m.syncPageLists(id)).catch(() => undefined);
  return { ok: true, rev: newRev, updatedAt: editing ? at : cur.updated_at };
}

export const touchOpened = (id: number) => void db().prepare("update ws_pages set opened_at = ? where id = ?").run(now(), id);

// ---------------------------------------------------------------------------
// Moving, trash, copies
// ---------------------------------------------------------------------------


/** Everything below a page: its sub-pages and, for a database, its rows (and theirs). */
export function subtree(id: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([id]);
  const q = [id];
  const stmt = db().prepare("select id from ws_pages where parent_id = ? or db_id = ?");
  while (q.length) {
    const at = q.shift()!;
    for (const r of stmt.all(at, at) as { id: number }[]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r.id);
        q.push(r.id);
      }
    }
  }
  return out;
}

/** A page moved under another (null: the top), before a sibling (or last). Not into itself or what is below it; rows stay in their database. */
export function movePage(id: number, parentId: number | null, beforeId?: number | null): void {
  keepSystem(id, parentId);
  const d = db();
  const p = getPage(id);
  if (!p || p.dbId) throw new Error("No such page.");
  if (parentId !== null) {
    const target = getPage(parentId);
    if (!target || target.archivedAt) throw new Error("No such page.");
    if (parentId === id || subtree(id).includes(parentId)) throw new Error("A page can't go inside itself.");
  }
  const siblings = (d.prepare("select id, position from ws_pages where db_id is null and template = 0 and archived_at is null and parent_id is ? and id != ? order by position, id").all(parentId, id) as { id: number; position: number }[]);
  let position: number;
  const at = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  if (at >= 0) {
    const prev = at > 0 ? siblings[at - 1].position : siblings[at].position - 2;
    position = (prev + siblings[at].position) / 2;
  } else position = (siblings.length ? siblings[siblings.length - 1].position : 0) + 1;
  touch(id);
  d.prepare("update ws_pages set parent_id = ?, position = ?, updated_at = ? where id = ?").run(parentId, position, now(), id);
  changed();
}

/** To the trash: the page, what is below it, and its rows. */
/** A system page, or a page under one (My prompts' pages, the detail views). */
export function isProtectedPage(id: number | null | undefined): boolean {
  for (let cur = id ?? null, hops = 0; cur && hops < 30; hops++) {
    if (isSystemPage(cur)) return true;
    cur = (db().prepare("select parent_id from ws_pages where id = ?").get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null;
  }
  return false;
}

/** The AI's tools may read system pages, not change them (or make pages under them). */
function noAgentOnSystem(id: number | null | undefined): void {
  if (!inAgentScope()) return;
  if (isProtectedPage(id)) throw new Error("System pages (the prompts, the detail views, the instructions) can only be changed by you, not by the AI.");
  runAgentGuards(id ?? null); // (an agent routine's permissions)
}

/** A system page (System, its prompts) stays: not archived, deleted or moved to another parent. */
function keepSystem(id: number, parentId?: number | null): void {
  noAgentOnSystem(id);
  if (!isSystemPage(id)) return;
  if (parentId !== undefined && getPage(id)?.parentId === parentId) return; // reordered among its siblings: fine
  throw new Error("A system page stays where it is (System → Prompts): change its text, or reset it.");
}

export function archivePage(id: number): void {
  keepSystem(id);
  const target = getPage(id);
  if (target?.dbId) protectCheck(target.dbId, "remove");
  logChange(id, "trash");
  const was = getPage(id);
  const ids = [id, ...subtree(id)];
  touch(...ids);
  const at = now();
  const d = db();
  d.transaction(() => {
    for (const x of ids) {
      d.prepare("update ws_pages set archived_at = ? where id = ? and archived_at is null").run(at, x);
      index(x);
    }
  })();
  changed();
  if (was?.dbId && !was.archivedAt) emitRowEvent("row.removed", { db: was.dbId, row: id });
  if (was?.dbId) afterTodoRowChange(id);
}

/**
 * Pages put back as an undone action had them (`rows`: their raw state before), and the pages it made sent to the trash.
 * A page that was removed since comes back; the search index follows. Used by undo.ts.
 */
export function restoreRaw(rows: Record<string, unknown>[], madeIds: number[]): { restored: number; trashed: number } {
  const d = db();
  let restored = 0;
  let trashed = 0;
  d.transaction(() => {
    for (const row of rows) {
      const id = Number(row.id);
      const cols = Object.keys(row).filter((k) => k !== "id");
      const found = d.prepare(`update ws_pages set ${cols.map((c) => `${c} = ?`).join(", ")} where id = ?`).run(...cols.map((c) => row[c] as never), id).changes;
      if (!found) d.prepare(`insert into ws_pages (id, ${cols.join(", ")}) values (?, ${cols.map(() => "?").join(", ")})`).run(id, ...cols.map((c) => row[c] as never));
      index(id);
      restored++;
    }
    for (const id of madeIds) {
      if (rows.some((r) => Number(r.id) === id)) continue;
      trashed += d.prepare("update ws_pages set archived_at = ? where id = ? and archived_at is null").run(now(), id).changes;
      index(id);
    }
  })();
  changed();
  return { restored, trashed };
}

export function restorePage(id: number): void {
  const d = db();
  const p = getPage(id);
  if (!p) return;
  logChange(id, "restored");
  const ids = [id, ...subtree(id)];
  touch(...ids);
  d.transaction(() => {
    // A page whose parent is in the trash too comes back to the top.
    if (p.parentId) {
      const parent = getPage(p.parentId);
      if (!parent || parent.archivedAt) d.prepare("update ws_pages set parent_id = null where id = ?").run(id);
    }
    for (const x of ids) {
      d.prepare("update ws_pages set archived_at = null where id = ?").run(x);
      index(x);
    }
  })();
  changed();
}

/** Gone for good, with what is below it. */
export function deletePage(id: number): void {
  keepSystem(id);
  const d = db();
  const ids = [id, ...subtree(id)];
  d.transaction(() => {
    for (const x of ids) {
      d.prepare("delete from ws_fts where rowid = ?").run(x);
      d.prepare("delete from ws_links where page_id = ?").run(x);
      d.prepare("delete from ws_versions where page_id = ?").run(x);
      d.prepare("delete from ws_pages where id = ?").run(x);
    }
    // Rows that pointed at it lose the pointer.
    for (const x of ids) cleanRelations(x);
  })();
  changed();
}

/** Remove a deleted page's id from the relation cells that hold it. */
function cleanRelations(pageId: number) {
  const d = db();
  for (const dbRow of d.prepare("select id, schema from ws_pages where kind = 'database'").all() as { id: number; schema: string | null }[]) {
    const schema = normalizeSchema(parse(dbRow.schema, null));
    const rel = schema.properties.filter((p) => p.type === "relation" && !p.backOf);
    if (!rel.length) continue;
    for (const r of d.prepare("select id, props from ws_pages where db_id = ?").all(dbRow.id) as { id: number; props: string }[]) {
      const props = parse<Record<string, unknown>>(r.props, {});
      let dirty = false;
      for (const p of rel) {
        const v = props[p.id];
        if (Array.isArray(v) && v.includes(pageId)) {
          const rest = v.filter((x) => x !== pageId);
          if (rest.length) props[p.id] = rest;
          else delete props[p.id];
          dirty = true;
        }
      }
      if (dirty) (touch(r.id), d.prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify(props), r.id));
    }
  }
}

/** The trash: what was archived and whose parent wasn't archived with it (the roots), newest first. */
export function trash(): { id: number; title: string; icon: string; kind: string; archivedAt: string; below: number }[] {
  const rows = db()
    .prepare(
      "select p.id, p.title, p.icon, p.kind, p.archived_at at from ws_pages p where p.archived_at is not null and p.db_id is null and (p.parent_id is null or not exists (select 1 from ws_pages q where q.id = p.parent_id and q.archived_at is not null)) order by p.archived_at desc",
    )
    .all() as { id: number; title: string; icon: string; kind: string; at: string }[];
  return rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, kind: r.kind, archivedAt: r.at, below: subtree(r.id).length }));
}

export function emptyTrash(): number {
  const roots = trash();
  for (const r of roots) deletePage(r.id);
  return roots.length;
}

/** A copy of a page with what is below it (a database: with its rows); "(copy)" added to the title. Returns the new id. */
export function duplicatePage(id: number, opts: { parentId?: number | null; dbId?: number | null; suffix?: boolean } = {}): number {
  const p = getPage(id);
  if (!p) throw new Error("No such page.");
  const idMap = new Map<number, number>();
  const copy = (src: Page, parentId: number | null, dbId: number | null, top: boolean): number => {
    const nid = createPage({
      parentId,
      dbId,
      kind: src.kind,
      title: top && opts.suffix !== false ? `${src.title || "Untitled"} (copy)` : src.title,
      icon: src.icon,
      content: src.content,
      props: src.props,
      schema: src.schema ?? undefined,
      template: src.template,
    });
    idMap.set(src.id, nid);
    const x = db();
    x.prepare("update ws_pages set cover = ?, full_width = ?, small_text = ? where id = ?").run(src.cover, src.fullWidth ? 1 : 0, src.smallText ? 1 : 0, nid);
    for (const c of x.prepare("select id from ws_pages where parent_id = ? and archived_at is null order by position, id").all(src.id) as { id: number }[]) copy(getPage(c.id)!, nid, null, false);
    if (src.kind === "database") for (const r of x.prepare("select id from ws_pages where db_id = ? and archived_at is null order by id").all(src.id) as { id: number }[]) copy(getPage(r.id)!, null, nid, false);
    return nid;
  };
  const top = copy(p, opts.dbId ? null : opts.parentId === undefined ? p.parentId : opts.parentId, opts.dbId ?? p.dbId, true);
  // Relations between pages that were copied together point at the copies.
  const d = db();
  for (const [from, to] of idMap) {
    const copied = getPage(to)!;
    if (copied.dbId && Object.keys(copied.props).length) {
      let dirty = false;
      const props = { ...copied.props };
      for (const [k, v] of Object.entries(props)) {
        if (Array.isArray(v) && v.some((x) => idMap.has(Number(x)) && typeof x === "number")) {
          props[k] = v.map((x) => (typeof x === "number" && idMap.has(x) ? idMap.get(x)! : x));
          dirty = true;
        }
      }
      if (dirty) d.prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify(props), to);
    }
    void from;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Lists and search
// ---------------------------------------------------------------------------

export type PageRef = { id: number; title: string; icon: string; kind: string; updatedAt: string; dbId: number | null };

const refOf = (r: { id: number; title: string; icon: string; kind: string; updated_at: string; db_id: number | null }): PageRef => ({ id: r.id, title: r.title, icon: r.icon, kind: r.kind, updatedAt: r.updated_at, dbId: r.db_id });

const FAVORITE_ORDER = "workspace.favoriteOrder";

/** The favorites in the order you put them in (those not placed yet follow, by title). */
export function favorites(): PageRef[] {
  const list = (db().prepare("select id, title, icon, kind, updated_at, db_id from ws_pages where favorite = 1 and archived_at is null order by title").all() as never[]).map(refOf);
  const order = getPref<number[]>(FAVORITE_ORDER, []);
  const rank = (id: number) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

/** The favorites' order, as put by dragging. */
export function setFavoriteOrder(ids: number[]): void {
  setPref(FAVORITE_ORDER, ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200));
  changed();
}

/** The last pages you opened or edited. */
export const recent = (limit = 12): PageRef[] =>
  (db().prepare("select id, title, icon, kind, updated_at, db_id from ws_pages where archived_at is null and template = 0 order by max(coalesce(opened_at, ''), updated_at) desc limit ?").all(limit) as never[]).map(refOf);

export type Hit = PageRef & { snippet: string; path: string };

/** Pages by what they say and what they are called — words by their beginnings, titles first. */
export function search(q: string, limit = 20): Hit[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  const match = words.map((w) => `"${w}"*`).join(" ");
  let rows: { id: number; title: string; icon: string; kind: string; updated_at: string; db_id: number | null; snip: string }[] = [];
  try {
    rows = db()
      .prepare(
        "select p.id, p.title, p.icon, p.kind, p.updated_at, p.db_id, snippet(ws_fts, 1, '', '', '…', 14) snip from ws_fts join ws_pages p on p.id = ws_fts.rowid where ws_fts match ? and p.archived_at is null and p.template = 0 order by bm25(ws_fts, 8.0, 1.0) limit ?",
      )
      .all(match, limit) as typeof rows;
  } catch {
    rows = [];
  }
  return rows.map((r) => ({ ...refOf(r), snippet: r.snip, path: breadcrumbs(r.id).map((b) => b.title || "Untitled").join(" / ") }));
}

/** Pages whose title starts with / contains the words — for the @ menu (quick, no index). */
export function suggestPages(q: string, limit = 8): PageRef[] {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return (db().prepare("select id, title, icon, kind, updated_at, db_id from ws_pages where archived_at is null and template = 0 and title like ? order by (title like ?) desc, updated_at desc limit ?").all(like, `${q.replace(/[%_]/g, "")}%`, limit) as never[]).map(refOf);
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** The pages that link to a page (a mention or a link in their text). */
export const backlinks = (id: number): PageRef[] =>
  (
    db()
      .prepare("select p.id, p.title, p.icon, p.kind, p.updated_at, p.db_id from ws_links l join ws_pages p on p.id = l.page_id where l.kind = 'page' and l.ref = ? and p.archived_at is null and p.id != ? order by p.updated_at desc")
      .all(String(id), id) as never[]
  ).map(refOf);

/** The pages that name a person, a todo or a ticket. */
export const pagesMentioning = (kind: DocRef["kind"], ref: string | number, limit = 20): PageRef[] =>
  (db().prepare("select p.id, p.title, p.icon, p.kind, p.updated_at, p.db_id from ws_links l join ws_pages p on p.id = l.page_id where l.kind = ? and l.ref = ? and p.archived_at is null and p.template = 0 order by p.updated_at desc limit ?").all(kind, String(ref), limit) as never[]).map(refOf);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type Version = { id: number; at: string; title: string; size: number };
export const versions = (pageId: number): Version[] => (db().prepare("select id, at, title, length(content) size from ws_versions where page_id = ? order by id desc").all(pageId) as Version[]);
export const getVersion = (id: number): { id: number; pageId: number; at: string; title: string; content: Doc } | null => {
  const r = db().prepare("select * from ws_versions where id = ?").get(id) as { id: number; page_id: number; at: string; title: string; content: string } | undefined;
  return r ? { id: r.id, pageId: r.page_id, at: r.at, title: r.title, content: sanitizeDoc(parse(r.content, null)) } : null;
};

/** A page's content put back to a version (the state before is kept as a version first). */
export function restoreVersion(versionId: number): void {
  const v = getVersion(versionId);
  if (!v) throw new Error("No such version.");
  const cur = getPage(v.pageId);
  if (!cur) throw new Error("No such page.");
  db().prepare("insert into ws_versions (page_id, title, content, at) values (?, ?, ?, ?)").run(cur.id, cur.title, JSON.stringify(cur.content), now());
  updatePage(cur.id, { title: v.title, content: v.content });
}

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

export function getDatabase(id: number): { page: Page; schema: DbSchema } | null {
  const p = getPage(id);
  return p && p.kind === "database" && p.schema ? { page: p, schema: p.schema } : null;
}

/** A database's rows as stored (computed properties not filled in). Not the archived, not the templates. */
export function rawRows(dbId: number, opts: { templates?: boolean } = {}): Row[] {
  return (db().prepare("select id, title, icon, props, created_at, updated_at from ws_pages where db_id = ? and archived_at is null and template = ? order by position, id").all(dbId, opts.templates ? 1 : 0) as { id: number; title: string; icon: string; props: string; created_at: string; updated_at: string }[]).map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    cells: parse<Record<string, unknown>>(r.props, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** The rows of a database with the computed properties filled in. */
export function rowsOf(dbId: number): { schema: DbSchema; rows: Row[] } | null {
  const d = getDatabase(dbId);
  if (!d) return null;
  const lookup = (id: number | string) => {
    if (typeof id === "string") return sourceTable(id);
    const o = getDatabase(id);
    return o ? { schema: o.schema, rows: rawRows(id) } : null;
  };
  return { schema: d.schema, rows: computeRows(d.schema, rawRows(dbId), lookup, dbId) };
}

/** What the views show for the ids in cells: the people, pages and todos by name. */
export async function labelsFor(schema: DbSchema, rows: Row[]): Promise<{ people: Record<number, string>; personHref: Record<number, string>; pages: Record<number, { title: string; icon: string }>; todos: Record<number, string> }> {
  const people = new Set<number>();
  const pages = new Set<number>();
  const todos = new Set<number>();
  const ids = (v: unknown) => (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  for (const p of schema.properties) {
    const bag = p.type === "person" ? people : p.type === "relation" ? pages : p.type === "todo" ? todos : null;
    if (!bag || (p.type === "relation" && p.relationSource !== undefined)) continue; // (a source's rows are no pages)
    for (const r of rows) for (const n of ids(r.cells[p.id])) bag.add(n);
    if (p.type === "rollup" || p.type === "formula") continue;
  }
  const out = { people: {} as Record<number, string>, personHref: {} as Record<number, string>, pages: {} as Record<number, { title: string; icon: string }>, todos: {} as Record<number, string> };
  if (people.size) {
    const { getPerson } = await import("@/plugins/people/store");
    const { personHref } = await import("./people-database");
    for (const id of people) {
      out.people[id] = getPerson(id)?.name ?? `#${id}`;
      out.personHref[id] = personHref(id);
    }
  }
  for (const id of pages) {
    const p = db().prepare("select title, icon from ws_pages where id = ?").get(id) as { title: string; icon: string } | undefined;
    out.pages[id] = { title: p?.title || "Untitled", icon: p?.icon ?? "" };
  }
  if (todos.size) {
    const { getTodo } = await import("@/lib/boards/store");
    for (const id of todos) out.todos[id] = getTodo(id)?.ref ?? `T-${id}`;
  }
  return out;
}

export function labelFns(l: Awaited<ReturnType<typeof labelsFor>>): Labels {
  return { person: (id) => l.people[id] ?? `#${id}`, page: (id) => l.pages[id]?.title ?? `#${id}`, todo: (id) => l.todos[id] ?? `T-${id}` };
}

/** The schema changed (properties, views). A removed property's cells go away with it. */
export function updateSchema(id: number, next: unknown): DbSchema {
  noAgentOnSystem(id);
  const cur = getDatabase(id);
  if (!cur) throw new Error("No such database.");
  const schema = normalizeSchema(next);
  const ids = new Set(schema.properties.map((p) => p.id));
  for (const p of schema.properties) {
    if (p.type === "relation" && p.relationDb !== undefined && !getDatabase(p.relationDb)) throw new Error(`Relation "${p.name}" points to a database that isn't there.`);
    if (p.type === "relation" && p.backOf) {
      const other = getDatabase(p.relationDb ?? -1);
      if (!other?.schema.properties.some((q) => q.id === p.backOf)) throw new Error(`"${p.name}" has no relation on the other side.`);
    }
  }
  const dropped = cur.schema.properties.filter((p) => !ids.has(p.id)).map((p) => p.id);
  const d = db();
  touch(id);
  d.transaction(() => {
    d.prepare("update ws_pages set schema = ?, updated_at = ? where id = ?").run(JSON.stringify(schema), now(), id);
    if (dropped.length) {
      for (const r of d.prepare("select id, props from ws_pages where db_id = ?").all(id) as { id: number; props: string }[]) {
        const props = parse<Record<string, unknown>>(r.props, {});
        let dirty = false;
        for (const k of dropped) {
          if (k in props) {
            delete props[k];
            dirty = true;
          }
        }
        if (dirty) (touch(r.id), d.prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify(props), r.id));
      }
    }
  })();
  changed();
  return schema;
}

/** A schema saved, with what hangs on it: a relation asked to show on the other side gets its back property there (computed from this one). */
export function saveSchema(id: number, next: unknown, fallbackName = "Relation"): DbSchema {
  const saved = updateSchema(id, next);
  const here = getPage(id);
  for (const p of saved.properties) {
    if (p.type !== "relation" || p.backOf || !p.twoWay || p.relationDb === undefined || p.relationDb === id) continue;
    const other = getDatabase(p.relationDb);
    if (!other || other.schema.properties.some((q) => q.backOf === p.id)) continue;
    updateSchema(other.page.id, { ...other.schema, properties: [...other.schema.properties, { ...newProperty(here?.title || fallbackName, "relation"), relationDb: id, backOf: p.id }] });
  }
  return saved;
}

/** A cell value made to fit its property: what can't be is dropped (null). */
export function coerceCell(p: Property, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (p.type) {
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      return v === "" || Number.isNaN(n) ? null : n;
    }
    case "checkbox":
      return !!v;
    case "select":
    case "status":
      return p.options?.some((o) => o.id === v) ? v : null;
    case "multi_select": {
      const a = (Array.isArray(v) ? v : [v]).filter((x) => p.options?.some((o) => o.id === x));
      return a.length ? [...new Set(a)] : null;
    }
    case "date": {
      const r = dateRange(v);
      if (!r || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(r.start) || (r.end !== undefined && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(r.end))) return null;
      return r.end ? { start: r.start, end: r.end } : r.start;
    }
    case "person":
    case "todo":
    case "relation": {
      const a = (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      return a.length ? [...new Set(a)] : null;
    }
    case "ticket": {
      const a = (Array.isArray(v) ? v : [v]).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9]+-\d+$/.test(x));
      return a.length ? [...new Set(a)] : null;
    }
    case "url":
    case "email":
    case "phone":
      return String(v).trim().slice(0, 500) || null;
    case "custom":
      return parseCustom(p.custom, v);
    case "text":
    case "markdown":
    case "ai":
      return String(v).slice(0, 20000) || null;
    default:
      return null; // computed: never stored
  }
}

/** One cell of a row set (null clears it). Computed properties can't be set. */
export function setCell(rowId: number, propId: string, value: unknown): void {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error("No such row.");
  if (propId === TITLE) {
    updatePage(rowId, { title: String(value ?? "") });
    return;
  }
  const schema = getDatabase(row.dbId)?.schema;
  const p = schema && propById(schema.properties, propId);
  if (!p) throw new Error("No such property.");
  if (isComputed(p)) throw new Error(`"${p.name}" is computed — it can't be set.`);
  noAgentOnSystem(rowId);
  // A field the source keeps, on a row it brought: the source's (what it says is what its record says).
  if (row.props.srcref && !isViaSource() && sourceLocked(row.dbId).includes(propId)) throw new Error(`"${p.name}" comes from the source (${String(row.props.srcref).split(":")[0]}) — it isn't changed here.`);
  const props = { ...row.props };
  const v = coerceCell(p, value);
  protectCheck(row.dbId, "set", { [p.id]: cellText(p, v) }, rowId);
  const was = cellText(p, props[propId]);
  if (v === null) delete props[propId];
  else props[propId] = v;
  logChange(rowId, p.name, was, cellText(p, v));
  touch(rowId);
  db().prepare("update ws_pages set props = ?, updated_at = ? where id = ?").run(JSON.stringify(props), now(), rowId);
  index(rowId); // (what a cell says is searchable)
  changed();
  syncLinkedFrom(rowId); // (its copies in other databases follow — links.ts)
  afterJobChange(rowId, propId); // (a card moved into Ready: the agents take it — jobs.ts)
  emitRowEvent("row.changed", { db: row.dbId, row: rowId, field: p.name, value: cellText(p, v) });
  afterTodoRowChange(rowId);
}

/**
 * A row placed between two others of its database (a card dragged on the board): `after` / `before`
 * its new neighbours as shown (null: the start / the end). When the gap is too small to split, the
 * database's rows are numbered afresh first.
 */
export function placeRow(rowId: number, at: { after: number | null; before: number | null }): void {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error("No such row.");
  const d = db();
  const pos = (id: number | null): number | null => {
    if (id === null) return null;
    const r = d.prepare("select db_id, position from ws_pages where id = ?").get(id) as { db_id: number | null; position: number } | undefined;
    if (!r || r.db_id !== row.dbId) throw new Error(`#${id} is not a row of the same database.`);
    return r.position;
  };
  const between = () => {
    const lo = pos(at.after);
    const hi = pos(at.before);
    return lo === null && hi === null ? null : lo === null ? hi! - 1 : hi === null ? lo + 1 : (lo + hi) / 2;
  };
  d.transaction(() => {
    let p = between();
    const lo = pos(at.after);
    const hi = pos(at.before);
    if (p !== null && lo !== null && hi !== null && !(p > Math.min(lo, hi) && p < Math.max(lo, hi))) {
      const set = d.prepare("update ws_pages set position = ? where id = ?");
      (d.prepare("select id from ws_pages where db_id = ? order by position, id").all(row.dbId) as { id: number }[]).forEach((r, i) => set.run(i + 1, r.id));
      p = between();
    }
    if (p !== null) (touch(rowId), d.prepare("update ws_pages set position = ? where id = ?").run(p, rowId));
  })();
  changed();
}

export type NewRow = { title?: string; cells?: Record<string, unknown>; templateId?: number; /** Values for the {{placeholders}} of a template. */ params?: Record<string, string> };

const PLACEHOLDER = /\{\{\s*([\p{L}\p{N} _.-]{1,40}?)\s*\}\}/gu;

/** The {{placeholders}} a row template holds - in its title, its texts and its page - in the order they first appear. */
export function templateParams(templateId: number): string[] {
  const tpl = getPage(templateId);
  if (!tpl) return [];
  const found: string[] = [];
  const scan = (s: unknown) => {
    for (const m of String(s ?? "").matchAll(PLACEHOLDER)) if (!found.includes(m[1]) && !(m[1] in builtinParams())) found.push(m[1]);
  };
  scan(tpl.title);
  for (const v of Object.values(tpl.props)) if (typeof v === "string") scan(v);
  scan(JSON.stringify(tpl.content));
  return found;
}

/** The placeholders every template knows without being asked: the day, the week (ISO number), the month, the weekday. */
export function builtinParams(now = new Date()): Record<string, string> {
  const p = (n: number) => String(n).padStart(2, "0");
  const thursday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 3 - ((now.getDay() + 6) % 7)));
  const week = Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return { date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, week: String(week), month: `${now.getFullYear()}-${p(now.getMonth() + 1)}`, weekday: now.toLocaleDateString(undefined, { weekday: "long" }) };
}

const fill = (s: string, params: Record<string, string>) => s.replace(PLACEHOLDER, (all, name: string) => (name in params ? params[name] : all));
/** A document with the placeholders of its texts filled in (a text node is changed, nothing else). */
function fillDoc(node: unknown, params: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((x) => fillDoc(x, params));
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "text" && typeof v === "string" ? fill(v, params) : fillDoc(v, params)]));
  }
  return node;
}

/** A row added: its title and cells (fitted to the properties); from a template: its content and cells come along. */
/** Whether rows may be made in a database by anyone but its source: not in one that only shows a source's records (the automations, their runs). */
export function rowsAddable(dbId: number): boolean {
  if (isViaSource()) return true;
  const step = getDatabase(dbId)?.schema.pipeline?.steps.find((s) => s.kind === "source" && s.from === "ext");
  if (!step?.ext) return true;
  return !workspaceSources.list().some((c) => c.impl.some((s) => s.id === step.ext && s.noNewRows));
}

/** The fields a database's source keeps on the rows it brought (none: no source, or it locks nothing). */
export function sourceLocked(dbId: number): string[] {
  const step = getDatabase(dbId)?.schema.pipeline?.steps.find((s) => s.kind === "source" && s.from === "ext");
  if (!step?.ext) return [];
  return workspaceSources.list().flatMap((c) => c.impl.filter((s) => s.id === step.ext).flatMap((s) => s.lockedFields ?? []));
}

/** A row of a todo list that feeds the Todo engine was changed: its todo follows (todo-engine.ts). */
function afterTodoRowChange(rowId: number): void {
  const row = getPage(rowId);
  if (row?.dbId && getDatabase(row.dbId)?.schema.todoList?.engine) void import("./todo-engine").then((m) => m.syncRow(rowId)).catch(() => undefined);
}

export function addRow(dbId: number, v: NewRow = {}): number {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  if (!rowsAddable(dbId)) throw new Error("This database only shows records from its source — rows cannot be added here.");
  const tpl = v.templateId ? getPage(v.templateId) : null;
  const props: Record<string, unknown> = {};
  for (const [k, val] of Object.entries({ ...(tpl?.dbId === dbId ? tpl.props : {}), ...(v.cells ?? {}) })) {
    const p = propById(d.schema.properties, k);
    if (!p || isComputed(p)) continue;
    const c = coerceCell(p, val);
    if (c !== null) props[k] = c;
  }
  // (A date that starts with today — a journal's day.)
  for (const p of d.schema.properties) if (p.type === "date" && p.defaultToday && props[p.id] === undefined) props[p.id] = new Date().toLocaleDateString("sv-SE");
  const params = tpl?.dbId === dbId ? { ...builtinParams(), ...(v.params ?? {}) } : (v.params ?? {});
  if (tpl?.dbId === dbId && Object.keys(params).length) for (const [k, val] of Object.entries(props)) if (typeof val === "string") props[k] = fill(val, params);
  const title = v.title ?? (tpl && tpl.dbId === dbId ? tpl.title : "");
  const id = createPage({ dbId, title: Object.keys(params).length ? fill(title, params) : title, icon: tpl?.icon, content: tpl?.dbId === dbId ? (Object.keys(params).length ? (fillDoc(tpl.content, params) as typeof tpl.content) : tpl.content) : undefined, props });
  emitRowEvent("row.added", { db: dbId, row: id });
  afterTodoRowChange(id);
  return id;
}

/** The row templates of a database. */
export const rowTemplates = (dbId: number): Row[] => rawRows(dbId, { templates: true });

/** For the search of everything Zeff keeps (rag.ts): pages as hits, by words. */
export function pageHits(words: string[]): { ref: string; title: string; text: string; when: string; score: number }[] {
  return search(words.join(" "), 10).map((h, i) => ({
    ref: `page:${h.id}`,
    title: `${h.icon ? `${h.icon} ` : ""}${h.title || "Untitled"}${h.path ? ` (${h.path})` : ""}`,
    text: (h.snippet || docText(getPage(h.id)?.content)).slice(0, 400),
    when: h.updatedAt.slice(0, 10),
    score: words.length + (10 - i) / 20,
  }));
}

/** Every mail, chat and inbox database's unread rows (its "Unread" field) — the sidebar's counters, as a mail client's folders have them. */
export function unreadCounts(): Record<number, number> {
  const d = db();
  const out: Record<number, number> = {};
  // (The document inbox too: its unread documents.)
  const field: Record<string, string> = { mail: "$.mailunread", message: "$.msgunread", inbox: "$.communread", documents: "$.docunread" };
  const dbs = d.prepare(`select id, json_extract(schema, '$.dataType') as dt from ws_pages where kind = 'database' and archived_at is null and json_extract(schema, '$.dataType') in ('mail', 'message', 'inbox', 'documents')`).all() as { id: number; dt: string }[];
  // A snoozed row (an inbox's, until a time in the future) is not counted.
  const count = d.prepare("select count(*) as n from ws_pages where db_id = ? and archived_at is null and template = 0 and json_extract(props, ?) = 1 and coalesce(json_extract(props, '$.commsnooze'), '') <= ?");
  const now = new Date().toISOString();
  for (const x of dbs) out[x.id] = (count.get(x.id, field[x.dt], now) as { n: number }).n;
  return out;
}

// ---------------------------------------------------------------------------
// Several rows at once
// ---------------------------------------------------------------------------

/**
 * Rows moved to another database: each becomes a row there - with its title, icon, its page, and the cells whose property has the same
 * name and kind there (a choice by the name of its option, one the target lacks is dropped) - and the old row goes to the trash. What
 * could not come along is named. The new rows' ids.
 */
export function moveRowsToDatabase(ids: number[], targetId: number): { moved: number[]; dropped: string[] } {
  const target = getDatabase(targetId);
  if (!target) throw new Error("No such database.");
  const moved: number[] = [];
  const dropped = new Set<string>();
  const sameKind = (a: Property, b: Property) => a.type === b.type;
  for (const id of ids) {
    const row = getPage(id);
    const from = row?.dbId ? getDatabase(row.dbId) : null;
    if (!row || !from || row.dbId === targetId) continue;
    const cells: Record<string, unknown> = {};
    for (const q of from.schema.properties) {
      const v = row.props[q.id];
      if (v === undefined || SYSTEM_PROPS.has(q.id) || isComputed(q)) continue;
      const t = target.schema.properties.find((x) => x.name.toLowerCase() === q.name.toLowerCase() && sameKind(x, q) && !isComputed(x));
      if (!t) {
        dropped.add(q.name);
        continue;
      }
      if (q.type === "select" || q.type === "status" || q.type === "multi_select") {
        const names = (Array.isArray(v) ? v : [v]).map((o) => q.options?.find((x) => x.id === o)?.name).filter((n): n is string => !!n);
        const ids2 = names.map((n) => t.options?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x);
        if (ids2.length < names.length) dropped.add(q.name);
        if (ids2.length) cells[t.id] = q.type === "multi_select" ? ids2 : ids2[0];
      } else cells[t.id] = v;
    }
    const nid = addRow(targetId, { title: row.title, cells });
    updatePage(nid, { icon: row.icon, content: row.content });
    archivePage(id);
    moved.push(nid);
  }
  return { moved, dropped: [...dropped] };
}
