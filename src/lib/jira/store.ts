import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { JiraBoard, JiraStatusCategory, JiraTicket } from "@/db/schema";
import type { NormalizedTicket } from "./normalize";

const { jiraTickets, jiraBoards } = schema;

export type JiraStats = {
  total: number;
  byCategory: Record<JiraStatusCategory, number>;
  withJob: number;
  lastSyncedAt: string | null;
};

export function listJiraTickets(opts: { activeOnly?: boolean; category?: JiraStatusCategory } = {}): JiraTicket[] {
  const conds = [];
  if (opts.activeOnly) conds.push(eq(jiraTickets.active, true));
  if (opts.category) conds.push(eq(jiraTickets.statusCategory, opts.category));
  const boardCond = enabledBoardTicketCond();
  if (boardCond) conds.push(boardCond);
  return getDb()
    .select()
    .from(jiraTickets)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(jiraTickets.statusCategory), desc(jiraTickets.updatedAt))
    .all();
}

export function getJiraTicket(key: string): JiraTicket | undefined {
  return getDb()
    .select()
    .from(jiraTickets)
    .where(sql`lower(${jiraTickets.key}) = lower(${key})`)
    .get();
}

/** The Zeff job a ticket is linked to in the Jira store (if any). */
export function getJiraJobForTicket(key: string): string | undefined {
  return getJiraTicket(key)?.jobNumber ?? undefined;
}

export function setTicketJob(key: string, jobNumber: string | null): void {
  getDb()
    .update(jiraTickets)
    .set({ jobNumber: jobNumber || null })
    .where(sql`lower(${jiraTickets.key}) = lower(${key})`)
    .run();
}

export type UpsertResult = { inserted: number; updated: number; deactivated: number; total: number };

/**
 * Upsert normalized tickets by key, preserving any locally-assigned jobNumber.
 * When `scope` is given, tickets with that scope not present in this batch are
 * marked inactive (a full sync); otherwise existing tickets are left as-is.
 */
export function upsertTickets(tickets: NormalizedTicket[], opts: { markMissingInactive?: boolean } = {}): UpsertResult {
  const db = getDb();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const keys: string[] = [];

  for (const t of tickets) {
    keys.push(t.key);
    const existing = getJiraTicket(t.key);
    if (existing) {
      db.update(jiraTickets)
        .set({
          summary: t.summary,
          status: t.status,
          statusCategory: t.statusCategory,
          issueType: t.issueType ?? null,
          priority: t.priority ?? null,
          assignee: t.assignee ?? null,
          url: t.url ?? existing.url,
          openedAt: t.openedAt ?? existing.openedAt,
          updatedAt: t.updatedAt ?? existing.updatedAt,
          resolvedAt: t.resolvedAt ?? existing.resolvedAt,
          respondedAt: t.respondedAt ?? existing.respondedAt,
          active: true,
          syncedAt: now,
        })
        .where(eq(jiraTickets.id, existing.id))
        .run();
      updated++;
    } else {
      db.insert(jiraTickets)
        .values({
          key: t.key,
          summary: t.summary,
          status: t.status,
          statusCategory: t.statusCategory,
          issueType: t.issueType ?? null,
          priority: t.priority ?? null,
          assignee: t.assignee ?? null,
          url: t.url ?? null,
          openedAt: t.openedAt ?? null,
          updatedAt: t.updatedAt ?? null,
          resolvedAt: t.resolvedAt ?? null,
          respondedAt: t.respondedAt ?? null,
          active: true,
          syncedAt: now,
        })
        .run();
      inserted++;
    }
  }

  let deactivated = 0;
  if (opts.markMissingInactive) {
    const res = keys.length
      ? db.update(jiraTickets).set({ active: false }).where(sql`${jiraTickets.key} not in ${keys}`).run()
      : db.update(jiraTickets).set({ active: false }).run();
    deactivated = res.changes ?? 0;
  }

  return { inserted, updated, deactivated, total: keys.length };
}

export function clearJiraTickets(): void {
  getDb().delete(jiraTickets).run();
}

export function jiraStats(): JiraStats {
  const rows = getDb().select().from(jiraTickets).where(enabledBoardTicketCond()).all();
  const byCategory: Record<JiraStatusCategory, number> = { todo: 0, inprogress: 0, done: 0, unknown: 0 };
  let withJob = 0;
  let lastSyncedAt: string | null = null;
  for (const r of rows) {
    byCategory[r.statusCategory]++;
    if (r.jobNumber) withJob++;
    if (!lastSyncedAt || r.syncedAt > lastSyncedAt) lastSyncedAt = r.syncedAt;
  }
  return { total: rows.length, byCategory, withJob, lastSyncedAt };
}

/**
 * Autocomplete source: active tickets with their effective job (explicit or the
 * board default). When any board is enabled, only tickets on an enabled board are
 * offered (stale boards are curated out); with no enabled boards it falls back to
 * all active tickets so the dropdown is never empty by surprise.
 */
export function ticketSuggestions(): { ticket: string; summary: string; jobNumber: string | null; done: boolean }[] {
  const filterByBoards = hasEnabledBoards();
  const boardJoin = filterByBoards
    ? and(eq(jiraBoards.id, jiraTickets.boardId), eq(jiraBoards.enabled, true))
    : eq(jiraBoards.id, jiraTickets.boardId);
  return getDb()
    .select({
      ticket: jiraTickets.key,
      summary: jiraTickets.summary,
      jobNumber: jiraTickets.jobNumber,
      boardJob: jiraBoards.jobNumber,
      boardId: jiraBoards.id,
      statusCategory: jiraTickets.statusCategory,
    })
    .from(jiraTickets)
    .leftJoin(jiraBoards, boardJoin)
    .where(eq(jiraTickets.active, true))
    .orderBy(asc(jiraTickets.statusCategory), asc(jiraTickets.key))
    .all()
    // When filtering by boards, keep only tickets matched to an enabled board.
    .filter((r) => !filterByBoards || r.boardId !== null)
    .map((r) => ({ ticket: r.ticket, summary: r.summary, jobNumber: r.jobNumber ?? r.boardJob ?? null, done: r.statusCategory === "done" }));
}

/** Count of tickets resolved (done) within an inclusive date range, by resolvedAt. */
export function ticketsClosedBetween(fromIso: string, toIso: string): JiraTicket[] {
  return getDb()
    .select()
    .from(jiraTickets)
    .where(
      and(
        eq(jiraTickets.statusCategory, "done"),
        sql`${jiraTickets.resolvedAt} is not null`,
        gte(sql`substr(${jiraTickets.resolvedAt}, 1, 10)`, fromIso),
        lte(sql`substr(${jiraTickets.resolvedAt}, 1, 10)`, toIso),
        enabledBoardTicketCond(),
      ),
    )
    .all();
}

export type TicketLifecycle = {
  key: string;
  statusCategory: JiraStatusCategory;
  openedAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
  respondedAt: string | null;
};

/** Opened/responded/updated/resolved dates for every ticket that has an opened date — cycle time, WIP, reaction. */
export function ticketLifecycles(): TicketLifecycle[] {
  return getDb()
    .select({
      key: jiraTickets.key,
      statusCategory: jiraTickets.statusCategory,
      openedAt: jiraTickets.openedAt,
      updatedAt: jiraTickets.updatedAt,
      resolvedAt: jiraTickets.resolvedAt,
      respondedAt: jiraTickets.respondedAt,
    })
    .from(jiraTickets)
    .where(and(sql`${jiraTickets.openedAt} is not null`, enabledBoardTicketCond()))
    .all();
}

/** Earliest known Jira day (min of opened/resolved dates), YYYY-MM-DD, or null. */
export function earliestJiraDate(): string | null {
  const row = getDb()
    .select({
      minOpen: sql<string | null>`min(substr(${jiraTickets.openedAt}, 1, 10))`,
      minResolved: sql<string | null>`min(substr(${jiraTickets.resolvedAt}, 1, 10))`,
    })
    .from(jiraTickets)
    .where(enabledBoardTicketCond())
    .get();
  const days = [row?.minOpen, row?.minResolved].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.length ? days.sort()[0] : null;
}

export function hasJiraData(): boolean {
  const row = getDb().select({ n: sql<number>`count(*)` }).from(jiraTickets).get();
  return Number(row?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Boards (Jira Agile boards -> default job)
// ---------------------------------------------------------------------------

export type BoardInput = { id: number; name: string; type?: string | null; projectKey?: string | null };

/** Upsert boards by id, preserving any locally-assigned jobNumber. */
export function upsertBoards(boards: BoardInput[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  for (const b of boards) {
    const existing = db.select().from(jiraBoards).where(eq(jiraBoards.id, b.id)).get();
    if (existing) {
      db.update(jiraBoards)
        .set({ name: b.name, type: b.type ?? existing.type, projectKey: b.projectKey ?? existing.projectKey, syncedAt: now })
        .where(eq(jiraBoards.id, b.id))
        .run();
    } else {
      db.insert(jiraBoards)
        .values({ id: b.id, name: b.name, type: b.type ?? null, projectKey: b.projectKey ?? null, syncedAt: now })
        .run();
    }
  }
}

export function setBoardMemberCount(id: number, n: number): void {
  getDb().update(jiraBoards).set({ memberCount: n }).where(eq(jiraBoards.id, id)).run();
}

export function setBoardJob(id: number, jobNumber: string | null): void {
  getDb().update(jiraBoards).set({ jobNumber: jobNumber || null }).where(eq(jiraBoards.id, id)).run();
}

export function setBoardEnabled(id: number, enabled: boolean): void {
  getDb().update(jiraBoards).set({ enabled }).where(eq(jiraBoards.id, id)).run();
}

/** Enabled boards first, then the ones with the most of your tickets — stale/empty boards sink. */
export function listJiraBoards(): JiraBoard[] {
  return getDb()
    .select()
    .from(jiraBoards)
    .orderBy(desc(jiraBoards.enabled), desc(jiraBoards.memberCount), asc(jiraBoards.name))
    .all();
}

export function enabledBoardIds(): number[] {
  return getDb().select({ id: jiraBoards.id }).from(jiraBoards).where(eq(jiraBoards.enabled, true)).all().map((r) => r.id);
}

export function hasEnabledBoards(): boolean {
  return getDb().select({ n: sql<number>`count(*)` }).from(jiraBoards).where(eq(jiraBoards.enabled, true)).get()?.n
    ? true
    : false;
}

/**
 * A WHERE condition limiting tickets to those on an ENABLED board, or undefined
 * for "no restriction". Undefined when no board is enabled, so scoped views (the
 * Jira tab list & stats, Analysis, the dropdown) fall back to all tickets rather
 * than going empty. This is the single definition of "tickets that count".
 */
function enabledBoardTicketCond() {
  if (!hasEnabledBoards()) return undefined;
  return inArray(jiraTickets.boardId, enabledBoardIds());
}

/**
 * Apply board membership from a board sync: reset board_id on every considered
 * ticket, then set it for the members. `considered` are all ticket keys that were
 * checked (so tickets that left a board are cleared).
 */
export function assignTicketBoards(considered: string[], assignments: { key: string; boardId: number }[]): void {
  const db = getDb();
  for (let i = 0; i < considered.length; i += 400) {
    const chunk = considered.slice(i, i + 400);
    if (chunk.length) db.update(jiraTickets).set({ boardId: null }).where(inArray(jiraTickets.key, chunk)).run();
  }
  for (const m of assignments) {
    db.update(jiraTickets).set({ boardId: m.boardId }).where(sql`lower(${jiraTickets.key}) = lower(${m.key})`).run();
  }
}

/** The board-derived default job for a ticket (its ENABLED board's mapped job), or null. */
export function getBoardJobForTicket(key: string): string | null {
  const row = getDb()
    .select({ jobNumber: jiraBoards.jobNumber })
    .from(jiraTickets)
    .innerJoin(jiraBoards, eq(jiraBoards.id, jiraTickets.boardId))
    .where(and(sql`lower(${jiraTickets.key}) = lower(${key})`, eq(jiraBoards.enabled, true)))
    .get();
  return row?.jobNumber ?? null;
}

/** The effective default job for a ticket: its explicit job, else its board's job. */
export function getTicketDefaultJob(key: string): string | null {
  const t = getJiraTicket(key);
  if (t?.jobNumber) return t.jobNumber;
  return getBoardJobForTicket(key);
}

/** All Jira ticket titles by upper-cased key — for the {ticket-name} report placeholder. */
export function getTicketSummaries(): Map<string, string> {
  const rows = getDb().select({ key: jiraTickets.key, summary: jiraTickets.summary }).from(jiraTickets).all();
  const m = new Map<string, string>();
  for (const r of rows) if (r.summary) m.set(r.key.toUpperCase(), r.summary);
  return m;
}

export function hasBoardData(): boolean {
  const row = getDb().select({ n: sql<number>`count(*)` }).from(jiraBoards).get();
  return Number(row?.n ?? 0) > 0;
}

