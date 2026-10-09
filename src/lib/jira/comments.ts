import { asc, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { jiraComments, boardRuns } = schema;

export type KeptComment = {
  id: string;
  ticket: string;
  author: string;
  at: string;
  body: string;
};

/** Keep these Jira comments (each replacing its last copy). */
export function keepComments(list: KeptComment[]): void {
  const rows = list.filter((c) => c.id && c.ticket);
  if (!rows.length) return;
  getDb().transaction((tx) => {
    for (const c of rows) {
      const v = {
        ticket: c.ticket.toUpperCase(),
        author: c.author,
        at: c.at,
        body: c.body,
      };
      tx.insert(jiraComments)
        .values({ id: c.id, ...v })
        .onConflictDoUpdate({ target: jiraComments.id, set: v })
        .run();
    }
  });
}

/** The kept comments with these ids, by id. */
export function commentsByIds(ids: string[]): Map<string, KeptComment> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  return new Map(
    getDb()
      .select()
      .from(jiraComments)
      .where(inArray(jiraComments.id, wanted))
      .all()
      .map((r) => [r.id, r]),
  );
}

/** The kept comments on these tickets — each ticket's last `max`, oldest first. */
export function commentsOfTickets(
  tickets: string[],
  max = 15,
): Map<string, KeptComment[]> {
  const keys = [
    ...new Set(tickets.filter(Boolean).map((t) => t.toUpperCase())),
  ];
  const out = new Map<string, KeptComment[]>();
  if (!keys.length) return out;
  for (const r of getDb()
    .select()
    .from(jiraComments)
    .where(inArray(jiraComments.ticket, keys))
    .orderBy(asc(jiraComments.at))
    .all()) {
    out.set(r.ticket, [...(out.get(r.ticket) ?? []), r]);
  }
  for (const [k, list] of out) out.set(k, list.slice(-max));
  return out;
}

/** Once, when none are kept yet: the comments every past Ticket-Lage run read. How many. */
export function keepCommentsFromRuns(): number {
  const db = getDb();
  if (
    (db
      .select({ n: sql<number>`count(*)` })
      .from(jiraComments)
      .get()?.n ?? 0) > 0
  )
    return 0;
  const all: KeptComment[] = [];
  for (const r of db
    .select({ tickets: boardRuns.tickets })
    .from(boardRuns)
    .all()) {
    try {
      for (const t of JSON.parse(r.tickets ?? "[]") as {
        key: string;
        recent?: { id: string; author: string; at: string; text: string }[];
      }[])
        for (const c of t.recent ?? [])
          all.push({
            id: c.id,
            ticket: t.key,
            author: c.author,
            at: c.at,
            body: c.text,
          });
    } catch {
      // a run without readable tickets
    }
  }
  keepComments(all);
  return all.length;
}
