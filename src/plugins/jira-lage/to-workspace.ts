import { inArray } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { setCollection } from "@/lib/items";
import { KEY_PROP, setDatabaseSource } from "@/plugins/workspace/collections";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property } from "@/plugins/workspace/model";
import { addRow, archivePage, createPage, getDatabase, placeRow, rawRows, setCell, updatePage, updateSchema } from "@/plugins/workspace/store";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { lageBoard, lageBoards } from "./board";

/**
 * Jira as a data source of the Workspace: each Jira board a board database the
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

/** Every Jira board into its database: rows made, changed, archived as Jira has them now. */
export async function syncJiraBoardDatabases(): Promise<Counts> {
  const out: Counts = { boards: 0, created: 0, updated: 0, archived: 0 };
  for (const summary of lageBoards()) {
    // (My briefing isn't a board of its own any more: Meine Lage is a database with a pipeline.)
    if (summary.id === "jira-lage") continue;
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

/** The database "Meine Lage" (null: none, or it's gone). */
const BRIEFING_DB = "workspace.briefingDb";
const REPLACED = "workspace.briefingReplaced";
export function briefingDatabase(): number | null {
  const id = getPref<number | null>(BRIEFING_DB, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/**
 * "Meine Lage", once (where Jira is in use): a database like any other (it replaced My briefing, the board the Jira sync kept
 * — gone in both accounts since 2026-10): a pipeline (Jira: on you or followed, open, done in the last days), its AI steps the Lage — attention, a sentence per
 * ticket — and one overall summary; its own AI review reads every row. Its rows come at once (what Zeff has from Jira).
 */
export async function replaceBriefingOnce(): Promise<number | null> {
  if (getPref<boolean>(REPLACED, false)) return null;
  const { lageFieldDefs, LAGE_FIELDS } = await import("@/plugins/workspace/lage-fields");
  const def = (id: string) => lageFieldDefs().find((f) => f.id === id)!;
  // The Lage's rules, as an instruction its AI steps choose (to change in KI-Anweisungen → Lage).
  const { listInstructions } = await import("@/plugins/workspace/instructions");
  const lage = listInstructions().find((i) => i.title === "Lage")?.id;
  const instructions = lage ? [lage] : undefined;
  const steps = [
    { id: newId("s"), kind: "source" as const, from: "jira" as const, jira: { mine: true, involved: true, openOnly: true, doneDays: 3 } },
    { id: newId("s"), kind: "ai" as const, output: "field" as const, name: "Attention", prompt: def(LAGE_FIELDS.attention).aiPrompt, choices: def(LAGE_FIELDS.attention).aiChoices, instructions },
    { id: newId("s"), kind: "ai" as const, output: "field" as const, name: "Lage", prompt: def(LAGE_FIELDS.lead).aiPrompt, instructions },
    { id: newId("s"), kind: "ai" as const, output: "summary" as const, prompt: "Die Gesamtlage: was gerade brennt, was als Nächstes kommt, worauf ich warte — in wenigen Sätzen, die wichtigsten Tickets mit Schlüssel.", instructions },
    { id: newId("s"), kind: "sort" as const, by: "Attention" },
  ];
  const id = createPage({ kind: "database", title: "Meine Lage", icon: "🧭", schema: { titleName: "Ticket", properties: [], views: [newView("Board", "board"), newView("Table", "table")], pipeline: { steps }, review: { on: true } } });
  updatePage(id, { fullWidth: true });
  setPref(BRIEFING_DB, id);
  setPref(REPLACED, true);
  await (await import("@/plugins/workspace/pipeline")).runPipeline(id, { ai: false });
  return id;
}

/** Where an old link to a Jira board (/kanban/jira-…) leads now: its database — My briefing: Meine Lage; null: not kept yet. */
export const jiraBoardHref = (boardId: string): string | null => {
  const dbId = boardId === "jira-lage" ? briefingDatabase() : jiraBoardDatabase(boardId);
  return dbId ? `/workspace/${dbId}` : null;
};

/** What a database is to the Jira briefing: Meine Lage ("briefing"), a Jira board's ("board"), or nothing of it (null). */
export function lageDatabaseKind(dbId: number): "briefing" | "board" | null {
  if (briefingDatabase() === dbId) return "briefing";
  return db().prepare("select 1 from jira_board_dbs where db_id = ? and board_id != 'jira-lage'").get(dbId) ? "board" : null;
}
