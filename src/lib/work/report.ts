import { desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { currentAccountId } from "@/db/accounts";
import { workReports, workRuns, type WorkReport, type WorkRun } from "@/db/schema";
import { todoRef } from "@/lib/boards/shared";
// (outcome.ts imports this file too: both only use the other's functions when called, never while loading.)
import { normalizeResult } from "./outcome";
import { workRef, type WorkResult } from "./shared";

/**
 * A finished run's report: the worker's answer in one fixed shape — result, what it did, changes,
 * checks, what is open, where it lies — kept whole in `work_reports` (the comment on the todo is cut
 * short) and read by the knowledge server (Zeff · Berichte). Every run that answers leaves one; a
 * worker that left out a part gets it told ("keine Prüfung gemeldet"), so a gap shows.
 */

const OUTCOME_LABEL: Record<WorkResult["outcome"], string> = { done: "Erledigt", partial: "Teilweise erledigt", blocked: "Blockiert" };

export type BuiltReport = { title: string; body: string; changes: string[]; checks: string[]; openItems: string[] };

const bullets = (items: string[]) => items.map((i) => `- ${i.replace(/\n+/g, " ")}`).join("\n");

/** The report as Markdown, from a run and its (cleaned) answer. Pure. */
export function buildReport(run: Pick<WorkRun, "id" | "ticket" | "todoId" | "mode" | "model" | "repo" | "branch">, res: WorkResult): BuiltReport {
  const summary = res.summary.trim();
  const title = res.entry.trim() || summary.split("\n").find((l) => l.trim())?.replace(/^[#*\s]+/, "").slice(0, 120) || `${workRef(run.id)} · ${todoRef(run.todoId)}`;
  const changes = res.changes ?? [];
  const checks = res.checks ?? [];
  const openItems = res.followUps.map((f) => f.text);
  // Work on code owes its changes and checks; a message draft or a posted comment doesn't.
  const code = run.mode === "code" || run.mode === "instruct";
  // A section the worker wrote into its summary stays as it wrote it (its lists are kept in the columns); only the missing ones are added.
  const has = (name: string) => new RegExp(String.raw`^#{1,4}\s*(${name})\b`, "im").test(summary);
  const parts = [
    `# ${title}`,
    `**Ergebnis:** ${OUTCOME_LABEL[res.outcome]} · ${workRef(run.id)}${run.model ? ` (${run.model})` : ""} · ${todoRef(run.todoId)}${run.ticket ? ` · ${run.ticket}` : ""}`,
    summary && summary,
    has("Änderungen") ? "" : changes.length ? `## Änderungen\n${bullets(changes)}` : code && res.outcome !== "blocked" ? "## Änderungen\n- Keine Änderungen gemeldet." : "",
    has("Geprüft|Getestet|Tests") ? "" : checks.length ? `## Geprüft\n${bullets(checks)}` : code && res.outcome !== "blocked" ? "## Geprüft\n- Keine Prüfung gemeldet." : "",
    has("Offen") || !openItems.length ? "" : `## Offen\n${bullets(openItems)}`,
    has("Ort") ? "" : [
      run.branch ? `Branch \`${run.branch}\`${run.repo ? ` (${run.repo})` : ""}` : "",
      res.completedTodos.length ? `Als erledigt gemeldet: ${res.completedTodos.map((id) => todoRef(id)).join(", ")}` : "",
    ]
      .filter(Boolean)
      .map((l) => `- ${l}`)
      .join("\n")
      .replace(/^(?=.)/, "## Ort\n"),
  ];
  return { title, body: parts.filter(Boolean).join("\n\n"), changes, checks, openItems };
}

/** A run's report kept (one per run; a second answer of the same run replaces it). Returns its id. */
export function saveReport(run: WorkRun, res: WorkResult): number | null {
  if (!res.summary.trim() && !res.entry.trim()) return null;
  const built = buildReport(run, res);
  const now = new Date().toISOString();
  const row = {
    runId: run.id,
    todoId: run.todoId,
    ticket: run.ticket,
    outcome: res.outcome,
    title: built.title,
    summary: res.summary.trim(),
    body: built.body,
    changes: JSON.stringify(built.changes),
    checks: JSON.stringify(built.checks),
    openItems: JSON.stringify(built.openItems),
    completedTodos: JSON.stringify(res.completedTodos),
    repo: run.repo ?? null,
    branch: run.branch ?? null,
    byWho: `${workRef(run.id)}${run.model ? ` · ${run.model}` : ""}`,
    updatedAt: now,
  };
  const db = getDb();
  const existing = db.select({ id: workReports.id }).from(workReports).where(eq(workReports.runId, run.id)).get();
  if (existing) {
    db.update(workReports).set(row).where(eq(workReports.id, existing.id)).run();
    return existing.id;
  }
  return db.insert(workReports).values({ ...row, createdAt: now }).returning({ id: workReports.id }).get().id;
}

export function getReport(id: number): WorkReport | undefined {
  return getDb().select().from(workReports).where(eq(workReports.id, id)).get();
}

/** The reports filed under a todo — the runs on it, and those that reported it done — newest first. */
export function reportsForTodo(todoId: number): WorkReport[] {
  return getDb()
    .select()
    .from(workReports)
    .where(or(eq(workReports.todoId, todoId), sql`exists (select 1 from json_each(coalesce(${workReports.completedTodos}, '[]')) where value = ${todoId})`))
    .orderBy(desc(workReports.createdAt))
    .all();
}

export const reportList = (r: WorkReport, key: "changes" | "checks" | "openItems" | "completedTodos"): string[] => {
  try {
    const v = JSON.parse(r[key] ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * Reports for the runs that finished before reports were kept: made from the answer each stored
 * (work_runs.result) — once per account and server start (it's cheap again: a run with a report is skipped).
 * How many were made.
 */
export function backfillReports(): number {
  const flag = globalThis as { __zeffReportsBackfilled?: Set<string> };
  const done = (flag.__zeffReportsBackfilled ??= new Set());
  const account = currentAccountId();
  if (done.has(account)) return 0;
  done.add(account);
  const db = getDb();
  const rows = db.select().from(workRuns).where(sql`${workRuns.result} is not null and ${workRuns.id} not in (select run_id from work_reports)`).all();
  let made = 0;
  for (const run of rows) {
    try {
      const res = normalizeResult(JSON.parse(run.result ?? "null"));
      if (!res) continue;
      const id = saveReport(run, res);
      if (id) {
        // The report is as old as the run that wrote it.
        const at = run.finishedAt ?? run.startedAt ?? run.queuedAt;
        db.update(workReports).set({ createdAt: at, updatedAt: at }).where(eq(workReports.id, id)).run();
        made++;
      }
    } catch {
      // an answer that isn't readable: no report
    }
  }
  return made;
}
