import { newId, newView, type Option, type Property } from "./model";
import { addRow, createPage, getDatabase, getPage, rawRows, setCell } from "./store";

/**
 * Jobs for agents: a database whose rows are jobs — an instruction (what to do, in words), a status (waiting → at work →
 * to check → done / failed), the result an agent writes back, who is on it. A job runs when you start it (a click), never by
 * itself; what comes back waits for your check. The fixed property ids let the code, the AI over the MCP and the views meet.
 */

export const JOB = { instruction: "job_instruction", status: "job_status", result: "job_result", run: "job_run", by: "job_by" } as const;

/** The states of a job, with the phase each sits in (a board's columns). */
export const JOB_STATES = [
  { name: "Offen", group: "todo", color: "gray" },
  { name: "In Arbeit", group: "doing", color: "blue" },
  { name: "Zur Prüfung", group: "doing", color: "yellow" },
  { name: "Fertig", group: "done", color: "green" },
  { name: "Fehlgeschlagen", group: "todo", color: "red" },
] as const;
export type JobState = (typeof JOB_STATES)[number]["name"];

/** A jobs database: its properties and a board by status. `parentId`: where it sits (none: the top). */
export function createJobsDatabase(parentId: number | null, title = "Aufträge für Agenten"): number {
  const options: Option[] = JOB_STATES.map((s) => ({ id: newId("o"), name: s.name, color: s.color, group: s.group }));
  const properties: Property[] = [
    { id: JOB.instruction, name: "Anweisung", type: "markdown" },
    { id: JOB.status, name: "Status", type: "status", options },
    { id: JOB.result, name: "Ergebnis", type: "markdown" },
    { id: JOB.run, name: "Worker", type: "text" },
    { id: JOB.by, name: "Ausgelöst von", type: "text" },
  ];
  const board = { ...newView("Nach Status", "board"), groupBy: JOB.status, hidden: [JOB.run, JOB.by] };
  const table = { ...newView("Tabelle", "table"), order: ["title", JOB.status, JOB.instruction, JOB.result, JOB.run, JOB.by] };
  return createPage({ kind: "database", title, icon: "🤖", parentId, schema: { titleName: "Auftrag", properties, views: [board, table], jobs: true } });
}

/** The option id of a state in a jobs database. */
export function stateId(dbId: number, name: JobState): string | undefined {
  return getDatabase(dbId)?.schema.properties.find((p) => p.id === JOB.status)?.options?.find((o) => o.name === name)?.id;
}

/** The state a job row is in (by name; none: not set). */
export function stateOf(rowId: number): JobState | undefined {
  const row = getPage(rowId);
  if (!row?.dbId) return undefined;
  const id = row.props[JOB.status];
  return getDatabase(row.dbId)?.schema.properties.find((p) => p.id === JOB.status)?.options?.find((o) => o.id === id)?.name as JobState | undefined;
}

export function setState(rowId: number, name: JobState): void {
  const row = getPage(rowId);
  const id = row?.dbId ? stateId(row.dbId, name) : undefined;
  if (id) setCell(rowId, JOB.status, id);
}

/** A job waiting for you to start it. `by`: what made it (a rule's name …); `text`: the record's own text, kept on the job's page. */
export function addJob(dbId: number, v: { title: string; instruction: string; by?: string; text?: string }): number {
  return addRow(dbId, { title: v.title.slice(0, 300), cells: { [JOB.instruction]: v.instruction, ...(v.by ? { [JOB.by]: v.by } : {}), ...(stateId(dbId, "Offen") ? { [JOB.status]: stateId(dbId, "Offen") } : {}) } });
}

// ---------------------------------------------------------------------------
// Starting a job, and taking what comes back
// ---------------------------------------------------------------------------

/** What a job needs from Zeff's worker system (injected in tests). */
export type JobDeps = {
  /** A todo for the job (the worker's handle on it) — its id. */
  addTodo: (v: { ticket: string; text: string }) => { id: number };
  /** The todo handed to a worker with this instruction — its run's id. */
  dispatch: (todoId: number, v: { instruction: string }) => { id: number };
  /** A run as it stands. */
  run: (id: number) => { status: string; todoId: number; summary: string | null; error: string | null; result: string | null } | undefined;
  /** The todo not needed any more. */
  closeTodo: (todoId: number) => void;
};

async function realDeps(): Promise<JobDeps> {
  const [{ addManualTodo, setTodoStatus }, { dispatchTodo }, { getRun }] = await Promise.all([import("@/lib/boards/store"), import("@/lib/work/runner"), import("@/lib/work/store")]);
  return {
    addTodo: (v) => addManualTodo(v),
    dispatch: (todoId, v) => dispatchTodo(todoId, { instruction: v.instruction }),
    run: (id) => getRun(id),
    closeTodo: (id) => void setTodoStatus(id, "dismissed"),
  };
}

const runOf = (text: unknown): number | null => {
  const m = /^W-(\d+)$/.exec(String(text ?? "").trim());
  return m ? Number(m[1]) : null;
};

/** What a worker is told about a job: the job, the hints from the rules, and how to hand the result back. */
export async function jobInstruction(rowId: number): Promise<string> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error("Not a row.");
  const { docToMarkdown } = await import("./doc");
  const { hintsFor } = await import("./rules");
  const task = String(row.props[JOB.instruction] ?? "").trim();
  const page = docToMarkdown(row.content).trim();
  const hints = hintsFor(row.title, `${task}\n${page}`);
  const db = getDatabase(row.dbId)!;
  return [
    `## Auftrag aus dem Workspace — Datenbank „${db.page.title}“, Zeile ${rowId}`,
    `**${row.title}**`,
    task,
    ...(page ? ["", "### Notizen auf der Seite des Auftrags", page] : []),
    ...(hints.length ? ["", "### Regeln, die für dich gelten", ...hints.map((h) => `- ${h}`)] : []),
    "",
    "### So arbeitest du",
    "- Tu, was der Auftrag sagt — dort, wo er es sagt. Verlangt er, im Workspace etwas anzulegen oder zu ändern (Seiten, Zeilen, Texte), legst du es dort selbst an, mit den MCP-Werkzeugen: workspace_tree und workspace_search finden den Ort („Ideen“, eine Datenbank, eine Seite); workspace_create_page, workspace_write_page, workspace_add_row und workspace_update_row legen an und ändern. Lege es wirklich an — beschreib es nicht nur.",
    `- Zum Schluss trägst du mit workspace_update_row (row: ${rowId}) ins Feld „Ergebnis“ dieser Zeile einen kurzen Bericht ein: was du angelegt oder geändert hast, mit Titel und Seiten-ID. Verlangt der Auftrag nur eine Antwort oder einen Text (nichts im Workspace anzulegen), ist diese Antwort selbst das Ergebnis. Setz dabei „Status“ auf „Zur Prüfung“.`,
    "- Sonst änderst du nichts an dieser Zeile; „Fertig“ setzt nur der Nutzer. Fehlt dir etwas, frag mit todo_needs_input, statt zu raten.",
    "- Beende mit einer kurzen Zusammenfassung.",
  ]
    .join("\n")
    .trim();
}

/** A job given to a worker — by your click. Waiting (or failed) jobs only; the job goes "In Arbeit", the worker's ref on it. */
export async function dispatchJob(rowId: number, deps?: JobDeps): Promise<{ run: number; todo: number }> {
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !db?.schema.jobs) throw new Error("This isn't a job of a jobs database.");
  const state = stateOf(rowId);
  if (state && state !== "Offen" && state !== "Fehlgeschlagen") throw new Error(`The job is “${state}” — only open or failed jobs are started.`);
  const d = deps ?? (await realDeps());
  const instruction = await jobInstruction(rowId);
  const todo = d.addTodo({ ticket: "", text: row.title });
  const run = d.dispatch(todo.id, { instruction });
  setCell(rowId, JOB.run, `W-${run.id}`);
  setState(rowId, "In Arbeit");
  return { run: run.id, todo: todo.id };
}

/** Every open job of a database started (each by your one click on "start all"). */
export async function dispatchOpenJobs(dbId: number, deps?: JobDeps): Promise<{ started: number; failed: string[] }> {
  const out = { started: 0, failed: [] as string[] };
  for (const r of rawRows(dbId)) {
    if (stateOf(r.id) !== "Offen") continue;
    try {
      await dispatchJob(r.id, deps);
      out.started++;
    } catch (e) {
      out.failed.push(`${r.title}: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Jobs at work whose run has ended: done → "Zur Prüfung" (the worker's summary as the result when it wrote none itself),
 * failed or stopped → "Fehlgeschlagen" with the reason. The job's todo is put away. Returns how many were settled.
 */
export async function settleJobs(deps?: JobDeps): Promise<number> {
  const d = deps ?? (await realDeps());
  const { getSqlite } = await import("@/db");
  const dbs = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[]).filter((x) => getDatabase(x.id)?.schema.jobs);
  let n = 0;
  for (const { id: dbId } of dbs) {
    for (const r of rawRows(dbId)) {
      if (stateOf(r.id) !== "In Arbeit") continue;
      const runId = runOf(r.cells[JOB.run]);
      const run = runId ? d.run(runId) : undefined;
      if (!run || run.status === "queued" || run.status === "running") continue;
      const has = String(r.cells[JOB.result] ?? "").trim();
      if (run.status === "done") {
        let text = run.summary ?? "";
        try {
          const parsed = run.result ? (JSON.parse(run.result) as { summary?: string; draft?: string }) : null;
          text = [parsed?.summary ?? text, parsed?.draft].filter(Boolean).join("\n\n");
        } catch {
          // keep the summary
        }
        if (!has && text) setCell(r.id, JOB.result, text);
        setState(r.id, "Zur Prüfung");
      } else {
        if (!has) setCell(r.id, JOB.result, run.error || `The worker ended: ${run.status}.`);
        setState(r.id, "Fehlgeschlagen");
      }
      d.closeTodo(run.todoId);
      n++;
    }
  }
  return n;
}
