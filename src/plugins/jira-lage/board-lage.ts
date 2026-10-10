import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { ATTENTIONS, type BoardTicket } from "@/lib/boards/shared";
import { dateOf, FIELDS, LIMITS, plain, ticketBlock, who, type Issue } from "@/lib/boards/collect";
import { keepComments } from "@/lib/jira/comments";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { followedTickets } from "@/lib/boards/followed";
import { myJiraName } from "@/lib/jira/store";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { emitChange } from "@/lib/events";
import { errorMessage } from "@/lib/errors";

/**
 * The Board-Lage (Jira Lage plugin): the Lage for the tickets on your boards that are relevant now
 * — open, and moved in the last weeks or in progress — besides those the Ticket-Lage reads: the
 * ones you're in (on you, followed, commented, with your todos or bookings), or — on request — all. Each read fresh from Jira (comments, history), with what Zeff knows (Teams, GitLab,
 * mails, git), as the Ticket-Lage reads its tickets; the AI says per ticket how it stands, what
 * happened, what's at risk — no todos (they're others' tickets). Only those that changed since
 * they were last read go through the AI again. For the Kanban cards.
 */

const { jiraTickets, jiraBoards, boardRuns } = schema;

/** Relevant: moved within this many days (or in progress). */
const RECENT_DAYS = 30;
/** At most this many tickets per run (the newest changes first). */
const MAX_TICKETS = 150;
const BATCH_CHARS = 18000;
const PARALLEL = 3;

export type BoardLage = {
  key: string;
  attention: string;
  lead: string;
  summary: string;
  happened: { when: string; who?: string; what: string }[];
  flags: string[];
};

const SCHEMA = {
  type: "object",
  required: ["tickets"],
  properties: {
    tickets: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "attention", "lead", "summary", "happened", "flags"],
        properties: {
          key: { type: "string" },
          attention: { type: "string", enum: [...ATTENTIONS] },
          lead: { type: "string" },
          summary: { type: "string" },
          happened: { type: "array", items: { type: "object", required: ["when", "what"], properties: { when: { type: "string" }, who: { type: "string" }, what: { type: "string" } } } },
          flags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const instructions = (me: string | null, today: string) => `Du schätzt die Lage einzelner Tickets eines Jira-Boards ein — für ein Kanban-Board, auf dem jede Karte zeigt, wie ihr Ticket steht. Heute ist ${today}.${me ? ` Ich bin ${me}; die Tickets gehören meist anderen.` : ""} Deutsch, nüchtern, konkret: Daten, Namen, was offen ist — nichts erfinden.

Gib für JEDES Ticket unten (key wie angegeben):
- attention: feedback (eine Rückfrage ist offen / wartet auf Antwort), active (es wird daran gearbeitet), check (im Test, Review, Abnahme), spec (Anforderung/Spezifikation unklar, in Klärung), blocked (wartet auf andere / extern), ready (bereit zum Weitermachen, nichts blockiert), stale (liegt seit Wochen ohne Bewegung).
- lead: EIN Satz — wie es steht, was als Nächstes passieren muss (und wer dran ist).
- summary: 2–4 Sätze — der Stand mit den wichtigen Fakten (letzte Entscheidungen, offene Fragen, Merge Requests, Termine).
- happened: die 3–5 letzten wichtigen Ereignisse, älteste zuerst — when (Datum JJJJ-MM-TT), who, what (ein Satz).
- flags: Risiken und Auffälliges in wenigen Worten (z. B. „Rückfrage seit 03.10. offen“, „MR mit Konflikt“), sonst leer.

Antworte nur mit JSON nach diesem Schema:
${JSON.stringify(SCHEMA)}`;

function ensureTable(): void {
  getSqlite().exec(
    "create table if not exists ticket_lage (key text primary key, hash text not null, result text not null, model text, analyzed_at text not null)",
  );
}

/**
 * The tickets relevant now on the enabled boards — open, moved lately or in progress — but those
 * the Ticket-Lage just read; of them the ones you're in (on you, followed, commented, your todos,
 * your bookings) — or all (`all`: also those without you, where you have only what Jira says).
 */
function relevantKeys(all: boolean): string[] {
  const db = getDb();
  const boards = db.select({ id: jiraBoards.id }).from(jiraBoards).where(eq(jiraBoards.enabled, true)).all().map((b) => b.id);
  if (!boards.length) return [];
  const since = Date.now() - RECENT_DAYS * 864e5;
  const last = db.select({ tickets: boardRuns.tickets }).from(boardRuns).where(eq(boardRuns.status, "ok")).orderBy(desc(boardRuns.id)).limit(1).get();
  let mine = new Set<string>();
  try {
    mine = new Set((JSON.parse(last?.tickets ?? "[]") as BoardTicket[]).filter((t) => t.analyzed).map((t) => t.key.toUpperCase()));
  } catch {
    mine = new Set();
  }
  const involved = all
    ? null
    : new Set([
        ...followedTickets().keys(),
        ...db
          .select({ key: jiraTickets.key })
          .from(jiraTickets)
          .where(eq(jiraTickets.mine, true))
          .all()
          .map((r) => r.key.toUpperCase()),
      ]);
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

/** What makes a ticket's Lage outdated: a change, a comment, another status or assignee. */
const hashOf = (i: Issue) => [i.updated ?? "", i.status?.name ?? "", who(i.assignee), (i.comments ?? []).length, i.comments?.[i.comments.length - 1]?.id ?? ""].join("|");

const state = globalThis as unknown as { __zeffBoardLage?: Promise<BoardLageResult> | null; __zeffBoardLageAll?: boolean };
export type BoardLageResult = { ok: boolean; all: boolean; relevant: number; analyzed: number; unchanged: number; failed: number; error?: string };

/** The next run's scope (set by the button before it starts the step): all tickets, or the ones you're in. */
export function setBoardLageScope(all: boolean): void {
  state.__zeffBoardLageAll = all;
}

/** The Board-Lage now (one at a time): the relevant tickets read from Jira, the changed ones through the AI. */
export function runBoardLage(opts: { force?: boolean; all?: boolean } = {}): Promise<BoardLageResult> {
  if (state.__zeffBoardLage) return state.__zeffBoardLage;
  const all = opts.all ?? !!state.__zeffBoardLageAll;
  state.__zeffBoardLageAll = false;
  const run = (async (): Promise<BoardLageResult> => {
    ensureTable();
    const keys = relevantKeys(all);
    if (!keys.length) return { ok: true, all, relevant: 0, analyzed: 0, unchanged: 0, failed: 0 };
    const cfg = getJiraSyncConfig();
    if (!cfg.configured || !cfg.command) return { ok: false, all, relevant: keys.length, analyzed: 0, unchanged: 0, failed: 0, error: "Jira ist nicht eingerichtet." };
    // Read from Jira: each with its comments and history.
    const issues: Issue[] = await runStdioSession(
      { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira (Board-Lage)" },
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
    keepComments(
      issues.flatMap((i) =>
        (i.comments ?? []).flatMap((c) => (c.id ? [{ id: c.id, ticket: i.key, author: who(c.author), at: dateOf(c.created)?.toISOString() ?? "", body: plain(c.body, 4000) }] : [])),
      ),
    );
    // Only the changed ones (or all: force).
    const known = new Map((getSqlite().prepare("select key, hash from ticket_lage").all() as { key: string; hash: string }[]).map((r) => [r.key, r.hash]));
    const todo = issues.filter((i) => opts.force || known.get(i.key) !== hashOf(i));
    const unchanged = issues.length - todo.length;
    // In batches that fit a prompt, as the Ticket-Lage sees each ticket.
    const blocks = todo.map((i) => ({ issue: i, text: ticketBlock(i, null, LIMITS[1]) }));
    const batches: (typeof blocks)[] = [];
    let cur: typeof blocks = [];
    let size = 0;
    for (const b of blocks) {
      if (cur.length && size + b.text.length > BATCH_CHARS) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(b);
      size += b.text.length;
    }
    if (cur.length) batches.push(cur);
    const me = myJiraName();
    const today = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const { llm } = await import("@/plugins/llm/run");
    const save = getSqlite().prepare(
      "insert into ticket_lage (key, hash, result, model, analyzed_at) values (?, ?, ?, ?, ?) on conflict(key) do update set hash = excluded.hash, result = excluded.result, model = excluded.model, analyzed_at = excluded.analyzed_at",
    );
    let analyzed = 0;
    let failed = 0;
    let lastError = "";
    const one = async (batch: typeof blocks): Promise<void> => {
      try {
        const prompt = `${instructions(me, today)}\n\n# Tickets (${batch.length})\n\n${batch.map((b) => b.text).join("\n\n")}`;
        const r = await llm<{ tickets: BoardLage[] }>("board-lage", prompt, SCHEMA, { timeoutMs: 360000 });
        const byKey = new Map((r.output?.tickets ?? []).map((t) => [t.key?.toUpperCase(), t]));
        for (const b of batch) {
          const t = byKey.get(b.issue.key.toUpperCase());
          if (!t) continue;
          save.run(b.issue.key, hashOf(b.issue), JSON.stringify({ ...t, key: b.issue.key }), r.model, new Date().toISOString());
          analyzed++;
        }
        emitChange("kanban");
      } catch (e) {
        if (batch.length > 1) {
          const half = Math.ceil(batch.length / 2);
          await one(batch.slice(0, half));
          await one(batch.slice(half));
        } else {
          failed++;
          lastError = errorMessage(e);
        }
      }
    };
    let next = 0;
    const worker = async () => {
      while (next < batches.length) await one(batches[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
    return { ok: failed === 0 || analyzed > 0, all, relevant: keys.length, analyzed, unchanged, failed, error: failed ? lastError.slice(0, 300) : undefined };
  })()
    .catch((e) => ({ ok: false, all, relevant: 0, analyzed: 0, unchanged: 0, failed: 0, error: errorMessage(e).slice(0, 300) }))
    .finally(() => {
      state.__zeffBoardLage = null;
      emitChange("kanban");
    });
  state.__zeffBoardLage = run;
  return run;
}
