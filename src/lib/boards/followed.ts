import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { myJiraName } from "@/lib/jira/store";
import { isJiraKey } from "@/lib/ticket-keys";

const { jiraTickets, todos, timeEntries, jiraComments } = schema;

/** How long activity of yours keeps a ticket followed by itself. */
const ACTIVE_DAYS = 7;

/**
 * The tickets the Ticket-Lage follows besides the boards' filter, and why: by hand ("Weiter
 * verfolgen"), or by themselves while you're active on them — open todos, a booking or a
 * comment of yours in the last 7 days (a ticket handed on to someone else that you're still
 * working on). "Nicht mehr verfolgen" (followed = -1) keeps one out.
 */
export function followedTickets(): Map<string, string> {
  const db = getDb();
  const out = new Map<string, string>();
  const off = new Set(
    db
      .select({ key: jiraTickets.key })
      .from(jiraTickets)
      .where(eq(jiraTickets.followed, -1))
      .all()
      .map((r) => r.key.toUpperCase()),
  );
  const add = (key: string | null | undefined, why: string) => {
    const k = key?.trim().toUpperCase();
    // Jira's only (a Kanban card KB-… is read from Zeff, not Jira).
    if (k && isJiraKey(k) && !off.has(k) && !out.has(k)) out.set(k, why);
  };
  for (const r of db.select({ key: jiraTickets.key }).from(jiraTickets).where(eq(jiraTickets.followed, 1)).all()) add(r.key, "von dir verfolgt");
  for (const r of db.selectDistinct({ key: todos.ticket }).from(todos).where(eq(todos.status, "open")).all()) add(r.key, "offene Todos");
  const since = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString();
  for (const r of db
    .selectDistinct({ key: timeEntries.ticket })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.ticket), gte(timeEntries.date, since.slice(0, 10))))
    .all())
    add(r.key, "kürzlich gebucht");
  const me = myJiraName();
  if (me)
    for (const r of db
      .selectDistinct({ key: jiraComments.ticket })
      .from(jiraComments)
      .where(and(eq(jiraComments.author, me), gte(jiraComments.at, since)))
      .all())
      add(r.key, "dein Kommentar");
  return out;
}

/** Follow a ticket by hand (1), not any more (-1), or as it comes (0). */
export function setFollowed(key: string, value: 1 | -1 | 0): void {
  const k = key.trim().toUpperCase();
  getDb()
    .update(jiraTickets)
    .set({ followed: value })
    .where(sql`upper(${jiraTickets.key}) = ${k}`)
    .run();
}
