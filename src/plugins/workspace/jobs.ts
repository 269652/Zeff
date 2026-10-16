import { getSqlite } from "@/db";
import { cellText, newId, newView, type Option, type Property } from "./model";
import { addRow, createPage, getDatabase, getPage, rawRows, setCell, updatePage, updateSchema } from "./store";

/**
 * Jobs for agents: a database whose rows are jobs — an instruction (what to do, in words), a status (waiting → at work →
 * to check → done / failed), the result an agent writes back, who is on it. A job runs when you start it (a click), never by
 * itself; what comes back waits for your check. The fixed property ids let the code, the AI over the MCP and the views meet.
 */

export const JOB = { instruction: "job_instruction", status: "job_status", result: "job_result", run: "job_run", by: "job_by" } as const;

/** The states of a job, with the phase each sits in (a board's columns). Incoming tickets land in "Eingang"; "Ready" is the column agents take from. */
export const JOB_STATES = [
  { name: "Eingang", group: "todo", color: "gray" },
  { name: "Ready", group: "todo", color: "purple" },
  { name: "In Arbeit", group: "doing", color: "blue" },
  { name: "Zur Prüfung", group: "doing", color: "yellow" },
  { name: "Fertig", group: "done", color: "green" },
  { name: "Fehlgeschlagen", group: "todo", color: "red" },
] as const;
/** ("Offen" is what an older jobs database called its waiting column.) */
export type JobState = (typeof JOB_STATES)[number]["name"] | "Offen";
/** The states a job is waiting in, and the ones it can be started from. */
export const WAITING: JobState[] = ["Eingang", "Offen", "Ready"];
const STARTABLE: JobState[] = [...WAITING, "Fehlgeschlagen"];

/** A jobs database: its properties and a board by status; open to receive tickets in "Eingang". `parentId`: where it sits (none: the top). */
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
  return createPage({ kind: "database", title, icon: "🤖", parentId, schema: { titleName: "Auftrag", properties, views: [board, table], jobs: true, receive: { prop: JOB.status, value: options[0].id } } });
}

/** The option id of a state in a jobs database ("Eingang" is found as "Offen" in an older one). */
export function stateId(dbId: number, name: JobState): string | undefined {
  const options = getDatabase(dbId)?.schema.properties.find((p) => p.id === JOB.status)?.options;
  return options?.find((o) => o.name === name)?.id ?? (name === "Eingang" ? options?.find((o) => o.name === "Offen")?.id : undefined);
}

/**
 * An older jobs database brought up to date: "Offen" is "Eingang" (the same option: its cards stay), "Ready" comes after it, and
 * it receives tickets in Eingang. Nothing to do when it is as it should be.
 */
export function ensureJobStates(dbId: number): void {
  const d = getDatabase(dbId);
  if (!d?.schema.jobs) return;
  const status = d.schema.properties.find((p) => p.id === JOB.status);
  if (!status?.options) return;
  let options = status.options;
  if (!options.some((o) => o.name === "Eingang")) options = options.map((o) => (o.name === "Offen" ? { ...o, name: "Eingang" } : o));
  if (!options.some((o) => o.name === "Ready")) {
    const at = Math.max(0, options.findIndex((o) => o.name === "Eingang") + 1);
    options = [...options.slice(0, at), { id: newId("o"), name: "Ready", color: "purple", group: "todo" as const }, ...options.slice(at)];
  }
  const inbox = options.find((o) => o.name === "Eingang");
  const receive = d.schema.receive ?? (inbox ? { prop: JOB.status, value: inbox.id } : undefined);
  const changed = options !== status.options || receive !== d.schema.receive;
  if (!changed) return;
  updateSchema(dbId, { ...d.schema, properties: d.schema.properties.map((p) => (p.id === JOB.status ? { ...p, options } : p)), ...(receive ? { receive } : {}) });
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

/** A job waiting in "Eingang". `by`: what made it (a rule's name …); `text`: the record's own text, kept on the job's page. */
export function addJob(dbId: number, v: { title: string; instruction: string; by?: string; text?: string }): number {
  const inbox = stateId(dbId, "Eingang");
  return addRow(dbId, { title: v.title.slice(0, 300), cells: { [JOB.instruction]: v.instruction, ...(v.by ? { [JOB.by]: v.by } : {}), ...(inbox ? { [JOB.status]: inbox } : {}) } });
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

let override: JobDeps | undefined;
/** Tests: the worker system replaced (none: the real one). */
export function useJobDeps(deps: JobDeps | undefined): void {
  override = deps;
}

async function realDeps(): Promise<JobDeps> {
  if (override) return override;
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

/** The ticket a job was sent from (its link): the key, and what the source row says — for the worker. */
async function linkedTicket(rowId: number): Promise<{ key: string; lines: string[] }> {
  const { linkOf } = await import("./links");
  const { rowKey } = await import("./collections");
  const { docToMarkdown } = await import("./doc");
  const l = linkOf(rowId);
  const src = l ? getPage(l.source) : null;
  const sd = src?.dbId ? getDatabase(src.dbId) : null;
  if (!l || !src || !sd) return { key: "", lines: [] };
  const key = rowKey({ id: src.id, cells: src.props } as never) ?? "";
  const fields = sd.schema.properties
    .filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id))
    .map((p) => [p.name, cellText(p, src.props[p.id])] as const)
    .filter(([, v]) => v);
  const text = docToMarkdown(src.content).trim();
  return {
    key,
    lines: ["", "### Verknüpftes Ticket", `Aus „${l.sourceDb}“: **${src.title}**${key ? ` (${key})` : ""}`, ...fields.map(([k, v]) => `- ${k}: ${v}`), ...(text ? ["", text] : []), ...(key ? ["", `Mehr zum Ticket: todo_context und search_context mit dem Schlüssel ${key}.`] : [])],
  };
}

/** What a worker is told about a job: the job, the hints from the rules, and how to hand the result back. */
export async function jobInstruction(rowId: number): Promise<string> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error("Not a row.");
  const { docToMarkdown } = await import("./doc");
  const { hintsFor } = await import("./rules");
  const db0 = getDatabase(row.dbId)!;
  // A job without words of its own (a ticket sent here) gets the board's default.
  const task = String(row.props[JOB.instruction] ?? "").trim() || db0.schema.agents?.defaultInstruction || "";
  const ticket = await linkedTicket(rowId);
  const page = docToMarkdown(row.content).trim();
  const hints = hintsFor(row.title, `${task}\n${page}`);
  const db = getDatabase(row.dbId)!;
  return [
    `## Auftrag aus dem Workspace — Datenbank „${db.page.title}“, Zeile ${rowId}`,
    `**${row.title}**`,
    task,
    ...ticket.lines,
    ...(page ? ["", "### Notizen auf der Seite des Auftrags (was dort steht, auch ein früheres Ergebnis, ist Material — nicht die Erledigung)", page] : []),
    ...(hints.length ? ["", "### Regeln, die für dich gelten", ...hints.map((h) => `- ${h}`)] : []),
    "",
    "### So arbeitest du",
    "- Was schon in der Zeile oder auf ihrer Seite steht, ist Material — nicht die Erledigung. Prüf selbst, ob das, was der Auftrag verlangt, wirklich existiert (zum Beispiel die Seiten in „Ideen“); wenn nicht, tu es.",
    "- Tu, was der Auftrag sagt — dort, wo er es sagt. Verlangt er, im Workspace etwas anzulegen oder zu ändern (Seiten, Zeilen, Texte), legst du es dort selbst an, mit den MCP-Werkzeugen: workspace_tree und workspace_search finden den Ort („Ideen“, eine Datenbank, eine Seite); workspace_create_page, workspace_write_page, workspace_add_row und workspace_update_row legen an und ändern. Lege es wirklich an — beschreib es nicht nur.",
    `- Zum Schluss trägst du mit workspace_update_row (row: ${rowId}) ins Feld „Ergebnis“ dieser Zeile einen kurzen Bericht ein: was du angelegt oder geändert hast, mit Titel und Seiten-ID. Verlangt der Auftrag nur eine Antwort oder einen Text (nichts im Workspace anzulegen), ist diese Antwort selbst das Ergebnis. Setz dabei „Status“ auf „Zur Prüfung“.`,
    "- Sonst änderst du nichts an dieser Zeile; „Fertig“ setzt nur der Nutzer. Fehlt dir etwas, frag mit todo_needs_input, statt zu raten.",
    "- Beende mit einer kurzen Zusammenfassung.",
  ]
    .join("\n")
    .trim();
}

/**
 * A job started again: what an earlier run wrote in "Ergebnis" goes onto the job's page ("Früheres Ergebnis") and the field is
 * emptied — else the worker finds the old result, takes the job for done and does nothing. The text stays: as material.
 */
async function keepEarlierResult(rowId: number): Promise<void> {
  const row = getPage(rowId);
  const earlier = String(row?.props[JOB.result] ?? "").trim();
  if (!row || !earlier) return;
  const { markdownToDoc } = await import("./doc");
  const more = markdownToDoc(`## Früheres Ergebnis (${row.props[JOB.run] ? String(row.props[JOB.run]) : "ein früherer Lauf"})

${earlier}`).content ?? [];
  updatePage(rowId, { content: { ...row.content, content: [...(row.content.content ?? []), ...more] } });
  setCell(rowId, JOB.result, null);
}

/** A job given to a worker — by your click. Waiting (or failed) jobs only; the job goes "In Arbeit", the worker's ref on it. */
export async function dispatchJob(rowId: number, deps?: JobDeps): Promise<{ run: number; todo: number }> {
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !db?.schema.jobs) throw new Error("This isn't a job of a jobs database.");
  const state = stateOf(rowId);
  if (state && !STARTABLE.includes(state)) throw new Error(`The job is “${state}” — only waiting or failed jobs are started.`);
  const d = deps ?? (await realDeps());
  await keepEarlierResult(rowId);
  const instruction = await jobInstruction(rowId);
  const todo = d.addTodo({ ticket: (await linkedTicket(rowId)).key, text: row.title });
  const run = d.dispatch(todo.id, { instruction });
  setCell(rowId, JOB.run, `W-${run.id}`);
  setState(rowId, "In Arbeit");
  return { run: run.id, todo: todo.id };
}

/** Every open job of a database started (each by your one click on "start all"). */
export async function dispatchOpenJobs(dbId: number, deps?: JobDeps): Promise<{ started: number; failed: string[] }> {
  const out = { started: 0, failed: [] as string[] };
  for (const r of rawRows(dbId)) {
    if (!WAITING.includes(stateOf(r.id) as JobState)) continue;
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

// ---------------------------------------------------------------------------
// Agents that take the Ready column by themselves (only when you switched that on)
// ---------------------------------------------------------------------------

function startsTable() {
  const d = getSqlite();
  d.exec("create table if not exists ws_job_starts (day text not null, db_id integer not null, n integer not null, primary key (day, db_id))");
  return d;
}
const today = () => new Date().toLocaleDateString("sv-SE");
const usedToday = (dbId: number): number => ((startsTable().prepare("select n from ws_job_starts where day = ? and db_id = ?").get(today(), dbId) as { n: number } | undefined)?.n ?? 0);
const countStart = (dbId: number) => void startsTable().prepare("insert into ws_job_starts (day, db_id, n) values (?, ?, 1) on conflict(day, db_id) do update set n = n + 1").run(today(), dbId);

const pumping = new Set<number>();

/**
 * The agents of a jobs database at work: when "auto" is on, the cards in "Ready" are given to workers — in the board's order,
 * while fewer than `parallel` are at work and fewer than `perDay` were taken today. Jobs whose run ended are settled first
 * (that frees their place). Off: nothing starts by itself. `limited`: the day's limit held back a Ready card.
 */
export async function pumpJobs(dbId: number, deps?: JobDeps): Promise<{ started: number; limited: boolean }> {
  const cfg = getDatabase(dbId)?.schema.agents;
  const out = { started: 0, limited: false };
  if (!cfg?.auto || pumping.has(dbId)) return out;
  pumping.add(dbId);
  try {
    await settleJobs(deps);
    const rows = rawRows(dbId);
    const running = rows.filter((r) => stateOf(r.id) === "In Arbeit").length;
    const used = usedToday(dbId);
    for (const r of rows.filter((x) => stateOf(x.id) === "Ready")) {
      if (running + out.started >= cfg.parallel) break;
      if (used + out.started >= cfg.perDay) {
        out.limited = true;
        break;
      }
      try {
        await dispatchJob(r.id, deps);
        countStart(dbId);
        out.started++;
      } catch (e) {
        console.error("[jobs] taking a Ready job failed:", e);
        setState(r.id, "Fehlgeschlagen");
      }
    }
  } finally {
    pumping.delete(dbId);
  }
  return out;
}

/** A card moved into Ready (a change of a job's status): the agents of that database take it, when they are on. */
export function afterJobChange(rowId: number, propId: string): void {
  if (propId !== JOB.status) return;
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !db?.schema.jobs || !db.schema.agents?.auto || stateOf(rowId) !== "Ready") return;
  setTimeout(() => void pumpJobs(row.dbId!).catch((e) => console.error("[jobs]", e)), 0);
}

/** Every jobs database with its agents on — the scheduler's turn (settles the ended jobs, takes what is Ready). */
export async function runAutoJobs(): Promise<number> {
  const ids = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[]).filter((x) => getDatabase(x.id)?.schema.agents?.auto);
  let n = 0;
  for (const { id } of ids) n += (await pumpJobs(id)).started;
  return n;
}
