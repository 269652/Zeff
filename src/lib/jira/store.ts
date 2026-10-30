import { isOwnKey } from "@/lib/ticket-keys";
import { itemTicketCards } from "@/lib/items/tickets";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { JiraBoard, JiraStatusCategory, JiraTicket } from "@/db/schema";
import type { NormalizedTicket } from "./normalize";
import type { TicketCard } from "./ticket-card-shared";

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

/** You, as Jira names you (the assignee of the tickets synced as yours), if known. */
export function myJiraName(): string | null {
  return getDb().select({ a: jiraTickets.assignee }).from(jiraTickets).where(eq(jiraTickets.mine, true)).limit(1).get()?.a ?? null;
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
          description: t.description !== undefined ? t.description : undefined,
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
          description: t.description !== undefined ? t.description : undefined,
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

/** Ticket keys booked in Zeff that have no title in jira_tickets yet (not in the assignee sync). */
export function bookedTicketKeysMissingTitle(): string[] {
  const db = getDb();
  const have = new Set(
    db.select({ key: jiraTickets.key }).from(jiraTickets).where(sql`${jiraTickets.summary} <> ''`).all().map((r) => r.key.toUpperCase()),
  );
  const rows = db
    .selectDistinct({ ticket: schema.timeEntries.ticket })
    .from(schema.timeEntries)
    .where(sql`${schema.timeEntries.ticket} is not null and ${schema.timeEntries.ticket} <> ''`)
    .all();
  const out: string[] = [];
  for (const r of rows) {
    const t = r.ticket;
    if (t && !have.has(t.toUpperCase())) out.push(t);
  }
  return out;
}

/**
 * Store title-only tickets (booked in Zeff but not assigned to the user) as
 * INACTIVE, so their {ticket-name} is available to the report without letting
 * them into the ticket dropdown or Analysis (which filter to active/enabled).
 */
export function insertTitleOnlyTickets(tickets: NormalizedTicket[]): number {
  const db = getDb();
  const now = new Date().toISOString();
  let n = 0;
  for (const t of tickets) {
    const existing = getJiraTicket(t.key);
    if (existing) {
      db.update(jiraTickets)
        .set({
          summary: t.summary,
          description: t.description !== undefined ? t.description : undefined,
          status: t.status,
          statusCategory: t.statusCategory,
          issueType: t.issueType ?? existing.issueType,
          openedAt: t.openedAt ?? existing.openedAt,
          updatedAt: t.updatedAt ?? existing.updatedAt,
          resolvedAt: t.resolvedAt ?? existing.resolvedAt,
          syncedAt: now,
        })
        .where(eq(jiraTickets.id, existing.id))
        .run();
    } else {
      db.insert(jiraTickets)
        .values({
          key: t.key,
          summary: t.summary,
          description: t.description !== undefined ? t.description : undefined,
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
          active: false,
          syncedAt: now,
        })
        .run();
    }
    n++;
  }
  return n;
}

/**
 * Which tickets the Analysis metrics cover: `keys` (lower-case ticket keys, e.g. the
 * ones you booked time on) are taken as-is on any board; without keys, the board scope
 * from {@link enabledBoardTicketCond} applies.
 */
function scopeCond(keys?: Set<string>) {
  return keys ? undefined : enabledBoardTicketCond();
}
function onlyKeys<T extends { key: string }>(rows: T[], keys?: Set<string>): T[] {
  return keys ? rows.filter((r) => keys.has(r.key.toLowerCase())) : rows;
}

export function jiraStats(keys?: Set<string>): JiraStats {
  const rows = onlyKeys(getDb().select().from(jiraTickets).where(scopeCond(keys)).all(), keys);
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
 * board default). When any board is enabled, only tickets on an enabled board — or
 * assigned to me, unless their project's boards are all switched off — are offered
 * (stale boards are curated out); with no enabled boards it falls back to all active
 * tickets so the dropdown is never empty by surprise.
 */
export function ticketSuggestions(): { ticket: string; summary: string; jobNumber: string | null; done: boolean; assignee: string | null; mine: boolean }[] {
  const filterByBoards = hasEnabledBoards();
  const off = filterByBoards ? disabledProjects() : [];
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
      assignee: jiraTickets.assignee,
      mine: jiraTickets.mine,
    })
    .from(jiraTickets)
    .leftJoin(jiraBoards, boardJoin)
    .where(eq(jiraTickets.active, true))
    .orderBy(asc(jiraTickets.statusCategory), asc(jiraTickets.key))
    .all()
    // When filtering by boards, keep tickets on an enabled board, or mine on a project not switched off.
    .filter((r) => !filterByBoards || r.boardId !== null || (r.mine && !inProjects(r.ticket, off)))
    .map((r) => ({
      ticket: r.ticket,
      summary: r.summary,
      jobNumber: r.jobNumber ?? r.boardJob ?? null,
      done: r.statusCategory === "done",
      assignee: r.assignee ?? null,
      mine: r.mine,
    }));
}

/** Count of tickets resolved (done) within an inclusive date range, by resolvedAt. */
export function ticketsClosedBetween(fromIso: string, toIso: string, keys?: Set<string>): JiraTicket[] {
  const rows = getDb()
    .select()
    .from(jiraTickets)
    .where(
      and(
        eq(jiraTickets.statusCategory, "done"),
        sql`${jiraTickets.resolvedAt} is not null`,
        gte(sql`substr(${jiraTickets.resolvedAt}, 1, 10)`, fromIso),
        lte(sql`substr(${jiraTickets.resolvedAt}, 1, 10)`, toIso),
        scopeCond(keys),
      ),
    )
    .all();
  return onlyKeys(rows, keys);
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
export function ticketLifecycles(keys?: Set<string>): TicketLifecycle[] {
  const rows = getDb()
    .select({
      key: jiraTickets.key,
      statusCategory: jiraTickets.statusCategory,
      openedAt: jiraTickets.openedAt,
      updatedAt: jiraTickets.updatedAt,
      resolvedAt: jiraTickets.resolvedAt,
      respondedAt: jiraTickets.respondedAt,
    })
    .from(jiraTickets)
    .where(and(sql`${jiraTickets.openedAt} is not null`, scopeCond(keys)))
    .all();
  return onlyKeys(rows, keys);
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
 * Projects (upper-case keys) whose boards are all switched off — e.g. AINEWS once both its
 * boards are deselected on the Jira tab.
 */
function disabledProjects(): string[] {
  return getDb()
    .select({ key: jiraBoards.projectKey })
    .from(jiraBoards)
    .where(sql`${jiraBoards.projectKey} is not null`)
    .groupBy(jiraBoards.projectKey)
    .having(sql`max(${jiraBoards.enabled}) = 0`)
    .all()
    .map((r) => String(r.key).toUpperCase());
}

/** Whether a ticket key belongs to one of these projects ("AINEWS-52" → AINEWS). */
const inProjects = (key: string, projects: string[]) => projects.some((p) => key.toUpperCase().startsWith(`${p}-`));

/**
 * A WHERE condition limiting tickets to those on an ENABLED board, or undefined
 * for "no restriction". Undefined when no board is enabled, so scoped views (the
 * Jira tab list & stats, Analysis, the dropdown) fall back to all tickets rather
 * than going empty. This is the single definition of "tickets that count".
 */
function enabledBoardTicketCond() {
  if (!hasEnabledBoards()) return undefined;
  // Tickets on an enabled board, or assigned to me — so my tickets don't hide on a stale or
  // unsynced board — unless every board of their project is switched off (left out on purpose).
  const off = disabledProjects().map((p) => sql`substr(upper(${jiraTickets.key}), 1, ${p.length + 1}) <> ${`${p}-`}`);
  return or(inArray(jiraTickets.boardId, enabledBoardIds()), and(eq(jiraTickets.mine, true), ...off));
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

/** Flag which tickets (within `scope`) are assigned to the current user; the rest of `scope` is cleared. */
export function setTicketsMine(mineKeys: string[], scopeKeys: string[]): void {
  const db = getDb();
  const up = (keys: string[]) => keys.map((k) => k.toUpperCase());
  for (let i = 0; i < scopeKeys.length; i += 400) {
    const chunk = up(scopeKeys.slice(i, i + 400));
    if (chunk.length) db.update(jiraTickets).set({ mine: false }).where(inArray(jiraTickets.key, chunk)).run();
  }
  for (let i = 0; i < mineKeys.length; i += 400) {
    const chunk = up(mineKeys.slice(i, i + 400));
    if (chunk.length) db.update(jiraTickets).set({ mine: true }).where(inArray(jiraTickets.key, chunk)).run();
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


/** "https://jira.example.com/browse/" from any synced ticket's URL — to link tickets Zeff hasn't synced. */
function jiraBrowseBase(): string | null {
  const row = getDb()
    .select({ url: jiraTickets.url })
    .from(jiraTickets)
    .where(sql`${jiraTickets.url} like '%/browse/%'`)
    .limit(1)
    .get();
  const url = row?.url;
  return url ? url.slice(0, url.indexOf("/browse/") + "/browse/".length) : null;
}

/** Hover-card data for ticket keys (by upper-case key); unsynced tickets get just a link. */
export function getTicketCards(keys: (string | null | undefined)[]): Record<string, TicketCard> {
  const all = [...new Set(keys.flatMap((k) => (k?.trim() ? [k.trim().toUpperCase()] : [])))];
  if (all.length === 0) return {};
  // Your own (KB-…, WS-…): a row's card (a moved Kanban card's too): title, status, a link to the row.
  const own = all.filter((k) => isOwnKey(k));
  const kanbanCards = own.length ? itemTicketCards(own) : {};
  const wanted = all.filter((k) => !kanbanCards[k]);
  if (wanted.length === 0) return kanbanCards;
  const rows = getDb().select().from(jiraTickets).where(inArray(jiraTickets.key, wanted)).all();
  const byKey = new Map(rows.map((r) => [r.key.toUpperCase(), r]));
  const base = jiraBrowseBase();
  const cards: Record<string, TicketCard> = {};
  for (const key of wanted) {
    const r = byKey.get(key);
    cards[key] = r
      ? {
          key,
          url: r.url ?? (base ? base + key : null),
          synced: true,
          summary: r.summary,
          description: r.description,
          status: r.status,
          statusCategory: r.statusCategory,
          issueType: r.issueType,
          priority: r.priority,
          assignee: r.assignee,
          openedAt: r.openedAt,
          resolvedAt: r.resolvedAt,
          jobNumber: r.jobNumber,
        }
      : {
          key,
          url: base ? base + key : null,
          synced: false,
          summary: "",
          description: null,
          status: "",
          statusCategory: "unknown",
          issueType: null,
          priority: null,
          assignee: null,
          openedAt: null,
          resolvedAt: null,
          jobNumber: null,
        };
  }
  return { ...cards, ...kanbanCards };
}
