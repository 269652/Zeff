import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { workRef } from "./shared";
import { runsByStatus, updateRun } from "./store";

const { workRuns } = schema;

/**
 * A session's side work: it works on other todos too when its instruction says so ("mach T-38").
 * The worker marks them itself through Zeff's MCP (start_todo, as agent "W-<run> · Session") — an
 * agent run each, shown as being worked on; Zeff ends them with the session's run, which is the
 * one booked.
 */
/** The name the agent run of a session's side work carries — to find (and end) it with the session. */
export const sideWorker = (runId: number) => `${workRef(runId)} · Session`;

/** The todos a session's runs worked on besides their own (start-todo actions): newest first, once each — and whether one still goes on. */
export function sideTodos(runIds: number[]): { todoId: number; active: boolean }[] {
  const names = new Set(runIds.map(sideWorker));
  const out = new Map<number, boolean>();
  for (const r of getDb().select().from(workRuns).where(and(eq(workRuns.provider, "agent"), inArray(workRuns.model, [...names]))).orderBy(desc(workRuns.id)).all())
    if (!out.has(r.todoId)) out.set(r.todoId, r.status === "running");
  return [...out].map(([todoId, active]) => ({ todoId, active }));
}

/** The runs' side work over with the session: its agent runs end (no booking of their own: the session's run is booked). */
export function endSideWork(runId: number, summary: string | null, outcome: string | null): void {
  for (const r of runsByStatus(["running"]).filter((x) => x.provider === "agent" && x.model === sideWorker(runId))) {
    updateRun(r.id, { status: "done", outcome: outcome ?? "partial", summary: summary ? `Teil von ${workRef(runId)}: ${summary}`.slice(0, 20000) : `Teil von ${workRef(runId)}`, finishedAt: new Date().toISOString() });
  }
}
