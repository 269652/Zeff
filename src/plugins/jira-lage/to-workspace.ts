import { inArray } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { setCollection } from "@/lib/items";
import { KEY_PROP, setDatabaseSource } from "@/plugins/workspace/collections";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property } from "@/plugins/workspace/model";
import { addRow, archivePage, createPage, getDatabase, placeRow, rawRows, setCell, updatePage, updateSchema } from "@/plugins/workspace/store";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { ensureMyBriefingPage } from "@/plugins/workspace/ai-block";
import { lageBoard, lageBoards } from "./board";

/**
 * Jira as a data source of the Workspace: each Jira board (and "My briefing") a board database the
 * sync keeps — its tickets rows (Key PROJ-…), their column the status (the columns as on the Jira
 * board, else the status categories), type, priority, assignee, when changed, the link to Jira; in
 * the order the board shows them (most pressing first). Read-only and marked as Jira's: what changes,
 * changes in Jira; its tickets come into the Lage from Jira (not again from the database). The
 * Lage, the todos, the stripe come with the key, like on any card.
 */

function db() {
  const d = getSqlite();
  d.exec("create table if not exists jira_board_dbs (board_id text primary key, db_id integer not null)");
  return d;
}

/** The database a Jira board (jira-<id>, jira-lage) is kept in (null: none yet, or it's gone). */
export function jiraBoardDatabase(boardId: string): number | null {
  const r = db().prepare("select db_id from jira_board_dbs where board_id = ?").get(boardId) as { db_id: number } | undefined;
  return r && getDatabase(r.db_id) ? r.db_id : null;
}

const UNASSIGNED = /^(unassigned|nicht zugewiesen|nicht zugeordnet)$/i;
const STATUS = "jirastatus";
const TYPE = "jiratype";
const PRIORITY = "jirapriority";
const ASSIGNEE = "jiraassignee";
const UPDATED = "jiraupdated";
const URL = "jiraurl";

const option = (name: string, i: number, group?: Option["group"]): Option => ({ id: newId("o"), name, color: COLORS[(i + 1) % COLORS.length], ...(group ? { group } : {}) });

/** The options of a select kept in step with the names seen (the known ones keep their ids; new ones added). */
function withNames(p: Property, names: string[], group?: (name: string, i: number) => Option["group"]): Property {
  const known = new Map((p.options ?? []).map((o) => [o.name.toLowerCase(), o]));
  const ordered = names.map((n, i) => {
    const o = known.get(n.toLowerCase()) ?? option(n, i);
    return group ? { ...o, group: group(n, i) } : o;
  });
  const rest = (p.options ?? []).filter((o) => !names.some((n) => n.toLowerCase() === o.name.toLowerCase()));
  return { ...p, options: [...ordered, ...rest] };
}

function newSchema(): DbSchema {
  const status: Property = { id: STATUS, name: "Status", type: "status", options: [] };
  return {
    titleName: "Summary",
    properties: [status, { id: TYPE, name: "Type", type: "select", options: [] }, { id: PRIORITY, name: "Priority", type: "select", options: [] }, { id: ASSIGNEE, name: "Assignee", type: "text" }, { id: UPDATED, name: "Updated", type: "date", includeTime: true }, { id: URL, name: "Jira", type: "url" }, { ...newProperty("Key", "text"), id: KEY_PROP }],
    views: [{ ...newView("Board", "board"), groupBy: STATUS, hidden: [KEY_PROP, URL, UPDATED] }, newView("Table", "table")],
  };
}

type Counts = { boards: number; created: number; updated: number; archived: number };

/** Every Jira board (and My briefing) into its database: rows made, changed, archived as Jira has them now. */
export async function syncJiraBoardDatabases(): Promise<Counts> {
  const out: Counts = { boards: 0, created: 0, updated: 0, archived: 0 };
  const ownBriefing = getPref<number | null>(BRIEFING_PIPELINE, null);
  for (const summary of lageBoards()) {
    // My briefing as a pipeline database: its pipeline keeps it, not this sync.
    if (summary.id === "jira-lage" && ownBriefing) continue;
    const board = await lageBoard(summary.id);
    if (!board) continue;
    out.boards++;
    const keys = board.columns.flatMap((c) => c.cards.map((x) => x.ref.toUpperCase()));
    const tickets = new Map(keys.length ? getDb().select().from(schema.jiraTickets).where(inArray(schema.jiraTickets.key, keys)).all().map((t) => [t.key.toUpperCase(), t]) : []);

    let dbId = jiraBoardDatabase(summary.id);
    if (!dbId) {
      dbId = createPage({ kind: "database", title: board.name, schema: newSchema() });
      updatePage(dbId, { fullWidth: true, locked: true });
      db().prepare("insert or replace into jira_board_dbs (board_id, db_id) values (?, ?)").run(summary.id, dbId);
      setDatabaseSource(dbId, "jira");
      setCollection(`workspace:${dbId}`, { briefing: false });
    } else if (getDatabase(dbId)!.page.title !== board.name) updatePage(dbId, { title: board.name });

    // The columns, types, priorities as now (known options keep their ids).
    const cur = getDatabase(dbId)!.schema;
    const names = board.columns.map((c) => c.name);
    const groupOf = (_: string, i: number): Option["group"] => (i === names.length - 1 && names.length > 1 ? "done" : i === 0 ? "todo" : "doing");
    const seen = (f: (t: (typeof schema.jiraTickets)["$inferSelect"]) => string | null) => [...new Set([...tickets.values()].map(f).filter((x): x is string => !!x))];
    const next: DbSchema = {
      ...cur,
      properties: cur.properties.map((p) => (p.id === STATUS ? withNames(p, names, groupOf) : p.id === TYPE ? withNames(p, seen((t) => t.issueType)) : p.id === PRIORITY ? withNames(p, seen((t) => t.priority)) : p)),
    };
    if (JSON.stringify(next.properties) !== JSON.stringify(cur.properties)) updateSchema(dbId, next);
    const opt = (propId: string, name: string | null | undefined) => (name ? next.properties.find((p) => p.id === propId)?.options?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.id : undefined);

    // The rows: made, changed (only what differs), archived when off the board.
    const rows = new Map(rawRows(dbId).map((r) => [String(r.cells[KEY_PROP] ?? "").toUpperCase(), r]));
    const order: number[] = [];
    for (const col of board.columns)
      for (const card of col.cards) {
        const key = card.ref.toUpperCase();
        const t = tickets.get(key);
        const assignee = card.assignee && !UNASSIGNED.test(card.assignee.trim()) ? card.assignee : undefined;
        const cells: Record<string, unknown> = {
          [STATUS]: opt(STATUS, col.name),
          [TYPE]: opt(TYPE, t?.issueType),
          [PRIORITY]: opt(PRIORITY, t?.priority),
          [ASSIGNEE]: assignee,
          [UPDATED]: (card.updatedAt ?? t?.updatedAt ?? undefined)?.slice(0, 16),
          [URL]: card.url ?? t?.url ?? undefined,
          [KEY_PROP]: key,
        };
        const row = rows.get(key);
        if (!row) {
          order.push(addRow(dbId, { title: card.title, cells }));
          out.created++;
          continue;
        }
        rows.delete(key);
        order.push(row.id);
        let changed = false;
        if (row.title !== card.title) {
          updatePage(row.id, { title: card.title });
          changed = true;
        }
        for (const [prop, v] of Object.entries(cells)) {
          const have = row.cells[prop] ?? undefined;
          if (JSON.stringify(have) !== JSON.stringify(v ?? undefined)) {
            setCell(row.id, prop, v ?? null);
            changed = true;
          }
        }
        if (changed) out.updated++;
      }
    for (const gone of rows.values()) {
      archivePage(gone.id);
      out.archived++;
    }
    // The board's order (most pressing first), only when it differs.
    const now = rawRows(dbId).map((r) => r.id);
    if (now.join() !== order.join()) order.forEach((id, i) => placeRow(id, { after: i ? order[i - 1] : null, before: null }));
  }
  return out;
}

const BRIEFING_PIPELINE = "workspace.briefingPipeline";

/**
 * My briefing becomes a database like any other — once: its rows from a pipeline (Jira: on you or followed, open), the
 * Lage as its AI steps (attention, lead, summary — what the Ticket-Lage writes stays theirs); yours to change, the Jira
 * sync leaves it. Its rows stay the same rows (each by its key), with their Lage. The database, or null: nothing to do.
 */
export async function briefingToPipelineOnce(): Promise<number | null> {
  if (getPref<number | null>(BRIEFING_PIPELINE, null)) return null;
  const dbId = jiraBoardDatabase("jira-lage");
  if (!dbId) return null;
  const d = getDatabase(dbId)!;
  const { lageFieldDefs } = await import("@/plugins/workspace/lage-fields");
  const { runPipeline, SRC_REF } = await import("@/plugins/workspace/pipeline");
  const steps = [
    { id: newId("s"), kind: "source" as const, from: "jira" as const, jira: { mine: true, involved: true, briefed: true, openOnly: true, doneDays: 3 } },
    ...lageFieldDefs().map((f) => ({ id: newId("s"), kind: "ai" as const, output: "field" as const, prop: f.id, name: f.name, prompt: f.aiPrompt, choices: f.aiChoices })),
  ];
  // The status takes Jira's statuses now (its options were the Lage's lanes).
  const properties = [...d.schema.properties.map((p) => (p.id === STATUS ? { ...p, options: [] } : p)), ...(d.schema.properties.some((p) => p.id === SRC_REF) ? [] : [{ id: SRC_REF, name: "Source", type: "text" as const }])];
  updateSchema(dbId, { ...d.schema, properties, pipeline: { steps }, review: { ...(d.schema.review ?? {}), on: true } });
  for (const r of rawRows(dbId)) if (r.cells[KEY_PROP]) setCell(r.id, SRC_REF, String(r.cells[KEY_PROP]));
  updatePage(dbId, { locked: false });
  setDatabaseSource(dbId, null);
  setCollection(`workspace:${dbId}`, { briefing: false });
  setPref(BRIEFING_PIPELINE, dbId);
  await runPipeline(dbId, { ai: false });
  return dbId;
}

/** Where an old link to a Jira board (/kanban/jira-…) leads now: its database — My briefing: the page Meine Lage over it; null: not kept yet. */
export const jiraBoardHref = (boardId: string): string | null => {
  const dbId = jiraBoardDatabase(boardId);
  if (!dbId) return null;
  if (boardId === "jira-lage") return `/workspace/${ensureMyBriefingPage(dbId, t("My briefing"))}`;
  return `/workspace/${dbId}`;
};
