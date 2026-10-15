import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { dateOf, FIELDS, plain, who, type Issue } from "@/lib/boards/collect";
import { followedTickets } from "@/lib/boards/followed";
import { analyzedByTicketLage } from "@/lib/boards/ticket-lage";
import { keepComments } from "@/lib/jira/comments";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { emitChange } from "@/lib/events";
import { errorMessage } from "@/lib/errors";

/**
 * The Board-Lage — the review step of every board, done by the Workspace's AI review: each board database (the Jira
 * boards the sync keeps, your own boards) has the Lage fields (attention, lead, summary — see workspace/lage-fields) and
 * the review fills them for the open cards that changed lately, not those the Ticket-Lage read. Before, the Jira tickets
 * that matter now are read fresh from Jira (comments, history) — the review reads them from what Zeff keeps.
 */

const { jiraTickets, jiraBoards } = schema;

/** Relevant: moved within this many days (or in progress). */
const RECENT_DAYS = 30;
/** At most this many tickets read from Jira per run (the newest changes first). */
const MAX_TICKETS = 150;

/**
 * The Jira tickets relevant now on the enabled boards — open, moved lately or in progress — but those the Ticket-Lage just
 * read; of them the ones you're in (on you, followed) — or all (`all`).
 */
function relevantKeys(all: boolean): string[] {
  const db = getDb();
  const boards = db.select({ id: jiraBoards.id }).from(jiraBoards).where(eq(jiraBoards.enabled, true)).all().map((b) => b.id);
  if (!boards.length) return [];
  const since = Date.now() - RECENT_DAYS * 864e5;
  const mine = analyzedByTicketLage();
  const involved = all ? null : new Set([...followedTickets().keys(), ...db.select({ key: jiraTickets.key }).from(jiraTickets).where(eq(jiraTickets.mine, true)).all().map((r) => r.key.toUpperCase())]);
  return db
    .select({ key: jiraTickets.key, updatedAt: jiraTickets.updatedAt, category: jiraTickets.statusCategory })
    .from(jiraTickets)
    .where(and(inArray(jiraTickets.boardId, boards), isNull(jiraTickets.resolvedAt), ne(jiraTickets.statusCategory, "done")))
    .all()
    .filter((t) => !mine.has(t.key.toUpperCase()) && (!involved || involved.has(t.key.toUpperCase())) && (t.category === "inprogress" || (dateOf(t.updatedAt)?.getTime() ?? 0) >= since))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MAX_TICKETS)
    .map((t) => t.key);
}

/** The relevant Jira tickets read fresh from Jira: their comments kept (the review reads them). The number read. */
async function freshFromJira(keys: string[]): Promise<number> {
  const cfg = getJiraSyncConfig();
  if (!keys.length || !cfg.configured || !cfg.command) return 0;
  const issues: Issue[] = await runStdioSession(
    { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira (board briefing)" },
    async (call) => {
      const out: Issue[] = [];
      for (let i = 0; i < keys.length; i += 50) {
        const chunk = keys.slice(i, i + 50);
        const p = resultToPayload(await call("jira_search", { jql: `key in (${chunk.join(",")})`, limit: chunk.length, fields: FIELDS, expand: "changelog" })) as { issues?: Issue[] };
        out.push(...(p.issues ?? []).filter((x) => x?.key));
      }
      return out;
    },
    240000,
  );
  keepComments(issues.flatMap((i) => (i.comments ?? []).flatMap((c) => (c.id ? [{ id: c.id, ticket: i.key, author: who(c.author), at: dateOf(c.created)?.toISOString() ?? "", body: plain(c.body, 4000) }] : []))));
  return issues.length;
}

const state = globalThis as unknown as { __zeffBoardLage?: Promise<BoardLageResult> | null; __zeffBoardLageAll?: boolean };
export type BoardLageResult = { ok: boolean; all: boolean; relevant: number; analyzed: number; unchanged: number; failed: number; error?: string };

/** The next run's scope (set by the button before it starts the step): all Jira tickets read fresh, or the ones you're in. */
export function setBoardLageScope(all: boolean): void {
  state.__zeffBoardLageAll = all;
}

/** The Board-Lage now (one at a time): Jira's relevant tickets read fresh, every board with its Lage fields, the reviews. */
export function runBoardLage(opts: { force?: boolean; all?: boolean } = {}): Promise<BoardLageResult> {
  if (state.__zeffBoardLage) return state.__zeffBoardLage;
  const all = opts.all ?? !!state.__zeffBoardLageAll;
  state.__zeffBoardLageAll = false;
  const run = (async (): Promise<BoardLageResult> => {
    let note: string | undefined;
    await freshFromJira(relevantKeys(all)).catch((e) => void (note = errorMessage(e).slice(0, 300)));
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("workspace")) return { ok: !note, all, relevant: 0, analyzed: 0, unchanged: 0, failed: 0, ...(note ? { error: note } : {}) };
    await (await import("@/plugins/workspace/lage-fields")).ensureBoardReviews();
    const results = await (await import("@/plugins/workspace/review")).reviewDatabases({ force: opts.force });
    const sum = (k: "reviewed" | "unchanged" | "failed") => results.reduce((n, r) => n + r[k], 0);
    const failed = sum("failed");
    const error = note ?? results.find((r) => r.error)?.error;
    return { ok: failed === 0 || sum("reviewed") > 0, all, relevant: sum("reviewed") + sum("unchanged") + failed, analyzed: sum("reviewed"), unchanged: sum("unchanged"), failed, ...(error ? { error } : {}) };
  })()
    .catch((e) => ({ ok: false, all, relevant: 0, analyzed: 0, unchanged: 0, failed: 0, error: errorMessage(e).slice(0, 300) }))
    .finally(() => {
      state.__zeffBoardLage = null;
      emitChange("kanban");
      emitChange("workspace");
    });
  state.__zeffBoardLage = run;
  return run;
}
