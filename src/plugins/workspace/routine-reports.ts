import { getSqlite } from "@/db";
import { onTodoDone } from "@/lib/boards/done-hooks";
import { getTodo, setTodoStatus } from "@/lib/boards/store";
import { getRoutine, routineOfWorkRun } from "./routines";

/**
 * An agent's reports: ONE per session — the todo its worker runs belong to, so a follow-up message changes the report instead of
 * making another. The agent drafts it (the agent_report tool); it is final when you give your OK, which is ticking the todo off
 * (the button of the Reports tab does exactly that). Server only.
 */

export type Report = { id: number; pageId: number; todoId: number; workRunId: number | null; title: string; body: string; status: "draft" | "final"; createdAt: string; updatedAt: string; finalAt: string | null };
type Row = { id: number; page_id: number; todo_id: number; work_run_id: number | null; title: string; body: string; status: string; created_at: string; updated_at: string; final_at: string | null };

function db() {
  const d = getSqlite();
  d.exec("create table if not exists ws_routine_reports (id integer primary key autoincrement, page_id integer not null, todo_id integer not null unique, work_run_id integer, title text not null, body text not null, status text not null default 'draft', created_at text not null, updated_at text not null, final_at text); create index if not exists ws_routine_reports_page on ws_routine_reports (page_id, id);");
  return d;
}

const toReport = (r: Row): Report => ({ id: r.id, pageId: r.page_id, todoId: r.todo_id, workRunId: r.work_run_id, title: r.title, body: r.body, status: r.status === "final" ? "final" : "draft", createdAt: r.created_at, updatedAt: r.updated_at, finalAt: r.final_at });

/** The todo a worker run belongs to. */
const todoOfRun = (workRunId: number): number | null => ((getSqlite().prepare("select todo_id from work_runs where id = ?").get(workRunId) as { todo_id: number } | undefined)?.todo_id ?? null);

/** The report of the session the worker run belongs to — drafted, or changed when it is there already. Null: the run is no agent routine's. */
export function saveReport(workRunId: number, v: { title: string; body: string }): Report | null {
  const pageId = routineOfWorkRun(workRunId);
  const todoId = todoOfRun(workRunId);
  if (!pageId || !todoId || getRoutine(pageId)?.kind !== "agent") return null;
  const now = new Date().toISOString();
  const title = v.title.trim().slice(0, 200) || "Report";
  const body = v.body.trim().slice(0, 60000);
  db()
    .prepare("insert into ws_routine_reports (page_id, todo_id, work_run_id, title, body, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(todo_id) do update set title = excluded.title, body = excluded.body, work_run_id = excluded.work_run_id, updated_at = excluded.updated_at")
    .run(pageId, todoId, workRunId, title, body, now, now);
  return toReport(db().prepare("select * from ws_routine_reports where todo_id = ?").get(todoId) as Row);
}

/** An agent page's reports, the newest first. */
export const listReports = (pageId: number): Report[] => (db().prepare("select * from ws_routine_reports where page_id = ? order by id desc").all(pageId) as Row[]).map(toReport);

/** Your OK: the report of this session is final. */
export function finalizeForTodo(todoId: number): void {
  const now = new Date().toISOString();
  db().prepare("update ws_routine_reports set status = 'final', final_at = coalesce(final_at, ?), updated_at = ? where todo_id = ? and status = 'draft'").run(now, now, todoId);
}

/** The button: approving a report closes its todo (your OK), which makes the report final. */
export function approveReport(reportId: number): void {
  const r = db().prepare("select todo_id from ws_routine_reports where id = ?").get(reportId) as { todo_id: number } | undefined;
  if (!r) throw new Error("There is no such report.");
  // Closed through the store, so the todo's own follow-ups run; its hook below makes the report final.
  if (getTodo(r.todo_id)?.status !== "done") setTodoStatus(r.todo_id, "done");
  finalizeForTodo(r.todo_id);
}

onTodoDone(finalizeForTodo);
