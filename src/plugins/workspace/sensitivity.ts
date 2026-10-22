import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { defaultDatabaseLabel, isLabel, maxLabel, type Label } from "@/lib/boundaries/shared";

/**
 * A Workspace database's sensitivity (open, personal, secret — lib/boundaries): kept with its other switches (briefing,
 * knowledge) in the pref `workspace.collections`, as `labels` by database. Without one: personal when the database or a
 * page above it is named like a journal, health, money or a private chat (or a sync of WhatsApp, Signal, the bank keeps
 * it), else open. A row carries its database's label, a page under a row too. Reads the pages by SQL only (no store
 * import), so the MCP server, the export and the AI layer can ask cheaply. Server only.
 */

const SWITCHES = "workspace.collections";
type Switches = { briefing?: number[]; knowledge?: number[]; labels?: Record<string, Label> };

const explicit = (): Record<string, Label> => {
  const l = getPref<Switches>(SWITCHES, {}).labels ?? {};
  return Object.fromEntries(Object.entries(l).filter(([, v]) => isLabel(v)));
};

/** A database's own label (null: back to its default). */
export function setDatabaseLabel(dbId: number, label: Label | null): void {
  const s = getPref<Switches>(SWITCHES, {});
  const labels = { ...(s.labels ?? {}) };
  if (label && isLabel(label)) labels[dbId] = label;
  else delete labels[dbId];
  setPref(SWITCHES, { briefing: [], knowledge: [], ...s, labels });
}

/** Whether a database's label is its own (set by you) rather than its default. */
export const hasOwnLabel = (dbId: number): boolean => String(dbId) in explicit();

/** The databases set to secret by you (a default is never secret). */
export const secretDatabases = (): number[] => Object.entries(explicit()).flatMap(([id, l]) => (l === "secret" ? [Number(id)] : []));

type Node = { id: number; parent_id: number | null; db_id: number | null; kind: string; title: string };

/**
 * Labels of databases and pages, looked up with what was read once remembered — for a batch (a search's hits, the tree).
 * `database(id)`: a database's label; `page(id)`: the strictest label of the databases at or above a page.
 */
export function labelResolver(): { database: (dbId: number) => Label; page: (pageId: number) => Label } {
  const own = explicit();
  const sources = getPref<Record<string, string>>("workspace.sources", {});
  const nodes = new Map<number, Node | null>();
  const node = (id: number): Node | null => {
    if (!nodes.has(id)) {
      let n: Node | null = null;
      try {
        n = (getSqlite().prepare("select id, parent_id, db_id, kind, title from ws_pages where id = ?").get(id) as Node | undefined) ?? null;
      } catch {
        n = null; // (no Workspace yet)
      }
      nodes.set(id, n);
    }
    return nodes.get(id)!;
  };
  const up = (n: Node) => n.db_id ?? n.parent_id;
  const dbLabels = new Map<number, Label>();
  const database = (dbId: number): Label => {
    if (own[dbId]) return own[dbId];
    if (!dbLabels.has(dbId)) {
      const names: string[] = [];
      for (let cur: number | null = dbId, hops = 0; cur && hops < 40; hops++) {
        const n = node(cur);
        if (!n) break;
        names.push(n.title);
        cur = up(n);
      }
      dbLabels.set(dbId, defaultDatabaseLabel(names, sources[dbId] ?? null));
    }
    return dbLabels.get(dbId)!;
  };
  const page = (pageId: number): Label => {
    let label: Label = "open";
    for (let cur: number | null = pageId, hops = 0; cur && hops < 40; hops++) {
      const n = node(cur);
      if (!n) break;
      if (n.kind === "database") label = maxLabel(label, database(n.id));
      cur = up(n);
    }
    return label;
  };
  return { database, page };
}

/** A database's label: yours, else its default. */
export const databaseLabel = (dbId: number): Label => labelResolver().database(dbId);

/** A page's label: the strictest of the databases at or above it (a row: its database's); open when none. */
export const pageLabel = (pageId: number): Label => labelResolver().page(pageId);

/** The text of the secret databases' rows — titles, pages and cells — to be left out of what goes to an AI. */
export function secretRowTexts(): string[] {
  const ids = secretDatabases();
  if (!ids.length) return [];
  try {
    const rows = getSqlite()
      .prepare(`select title, body_text, props from ws_pages where db_id in (${ids.map(() => "?").join(", ")}) and template = 0`)
      .all(...ids) as { title: string; body_text: string; props: string }[];
    return rows.flatMap((r) => {
      let cells: string[] = [];
      try {
        cells = Object.values(JSON.parse(r.props || "{}") as Record<string, unknown>).filter((v): v is string => typeof v === "string");
      } catch {
        cells = [];
      }
      return [r.title, r.body_text, ...cells].filter(Boolean);
    });
  } catch {
    return [];
  }
}
