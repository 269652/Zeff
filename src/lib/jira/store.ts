import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { JiraStatusCategory, JiraTicket } from "@/db/schema";
import type { NormalizedTicket } from "./normalize";

const { jiraTickets } = schema;

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
  const rows = getDb().select().from(jiraTickets).all();
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

/** Autocomplete source: open (not-done) tickets first, with their linked job. */
export function ticketSuggestions(): { ticket: string; summary: string; jobNumber: string | null; done: boolean }[] {
  return getDb()
    .select({
      ticket: jiraTickets.key,
      summary: jiraTickets.summary,
      jobNumber: jiraTickets.jobNumber,
      statusCategory: jiraTickets.statusCategory,
    })
    .from(jiraTickets)
    .where(eq(jiraTickets.active, true))
    .orderBy(asc(jiraTickets.statusCategory), asc(jiraTickets.key))
    .all()
    .map((r) => ({ ticket: r.ticket, summary: r.summary, jobNumber: r.jobNumber, done: r.statusCategory === "done" }));
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
};

/** Opened/updated/resolved dates for every ticket that has an opened date — for cycle time and WIP. */
export function ticketLifecycles(): TicketLifecycle[] {
  return getDb()
    .select({
      key: jiraTickets.key,
      statusCategory: jiraTickets.statusCategory,
      openedAt: jiraTickets.openedAt,
      updatedAt: jiraTickets.updatedAt,
      resolvedAt: jiraTickets.resolvedAt,
    })
    .from(jiraTickets)
    .where(sql`${jiraTickets.openedAt} is not null`)
    .all();
}

export function hasJiraData(): boolean {
  const row = getDb().select({ n: sql<number>`count(*)` }).from(jiraTickets).get();
  return Number(row?.n ?? 0) > 0;
}

