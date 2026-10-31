/** The Ticket-Lage's settings and its runs: started, finished, the latest and the last good one. */
// "Do in Zeff" (what plugins offer to the AI): the checks of the actions an AI proposes are registered by this.
import "@/plugins/actions/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { BoardRun, BoardSettings } from "@/db/schema";
import type { BoardResult, BoardRunView, BoardTicket } from "./shared";

const { boardSettings, boardRuns } = schema;

export function getBoardSettings(): BoardSettings {
  const db = getDb();
  const row = db.select().from(boardSettings).limit(1).get();
  if (row) return row;
  // Several processes may get here at once on a fresh database (next build's workers): one insert wins.
  db.insert(boardSettings).values({ id: 1 }).onConflictDoNothing().run();
  return db.select().from(boardSettings).limit(1).get()!;
}

export function updateBoardSettings(patch: Partial<Omit<BoardSettings, "id">>): BoardSettings {
  getBoardSettings(); // ensure the row exists
  return getDb().update(boardSettings).set(patch).returning().get();
}

export const parse = <T>(json: string | null, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toRun = (r: BoardRun): BoardRunView => ({
  id: r.id,
  status: r.status === "ok" || r.status === "error" ? r.status : "running",
  jql: r.jql,
  model: r.model,
  tickets: parse<BoardTicket[]>(r.tickets, []),
  result: parse<BoardResult | null>(r.result, null),
  error: r.error,
  costUsd: r.costUsd,
  durationMs: r.durationMs,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
});

/** A run begins (its tickets and answer come when it finishes). */
export function startRun(jql: string, model: string | null): number {
  return getDb().insert(boardRuns).values({ jql, model, status: "running" }).returning().get().id;
}

export function finishRun(
  id: number,
  patch: { status: "ok" | "error"; tickets?: BoardTicket[]; result?: BoardResult; error?: string; model?: string | null; costUsd?: number | null; durationMs?: number | null },
): void {
  getDb()
    .update(boardRuns)
    .set({
      status: patch.status,
      ...(patch.tickets ? { tickets: JSON.stringify(patch.tickets) } : {}),
      ...(patch.result ? { result: JSON.stringify(patch.result) } : {}),
      ...(patch.error !== undefined ? { error: patch.error.slice(0, 2000) } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
      ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
      finishedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(eq(boardRuns.id, id))
    .run();
  // What it says about each ticket, into the Lage fields of the Workspace's rows with its key (the cards read the fields).
  if (patch.status === "ok" && patch.result?.tickets?.length) {
    const tickets = patch.result.tickets;
    void import("@/plugins/state")
      .then(async ({ isInstalled }) => (isInstalled("workspace") ? (await import("@/plugins/workspace/lage-fields")).applyTicketLage(tickets) : 0))
      .catch((e) => console.error("[boards] the Lage into the Workspace's fields failed", e));
  }
}

/** A run by its number. */
export function getBoardRun(id: number): BoardRunView | null {
  const r = getDb().select().from(boardRuns).where(eq(boardRuns.id, id)).get();
  return r ? toRun(r) : null;
}

/** The newest run, whatever became of it. */
export function latestRun(): BoardRunView | null {
  const r = getDb().select().from(boardRuns).orderBy(desc(boardRuns.id)).limit(1).get();
  return r ? toRun(r) : null;
}

/** The newest run that worked (before the given one). */
export function lastGoodRun(before?: number): BoardRunView | null {
  const r = getDb()
    .select()
    .from(boardRuns)
    .where(before ? and(eq(boardRuns.status, "ok"), lt(boardRuns.id, before)) : eq(boardRuns.status, "ok"))
    .orderBy(desc(boardRuns.id))
    .limit(1)
    .get();
  return r ? toRun(r) : null;
}

/** Runs left "running" by a server that stopped mid-run: failed. How many. */
export function failInterruptedRuns(): number {
  const error = "Stopped — the server restarted during the run.";
  const runs = getDb().update(boardRuns).set({ status: "error", error, finishedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(boardRuns.status, "running")).returning().all().length;
  // A day's recap too: left "running", that day would never be recapped again.
  const recaps = getDb().update(schema.dayRecaps).set({ status: "error", error, finishedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(schema.dayRecaps.status, "running")).returning().all().length;
  return runs + recaps;
}
