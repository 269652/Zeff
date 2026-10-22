import { getSqlite } from "@/db";
import { callerRunId } from "@/mcp/caller";
import { t } from "@/lib/i18n/server";
import { addApprovedTools } from "@/lib/work/approved-tools";
import { guardPrompt } from "@/lib/boundaries";
import { addAgentGuard } from "./agent-scope";
import { docToMarkdown } from "./doc";
import { recordOfRow } from "./automation";
import { finishRun, getRoutine, routineOfWorkRun, runningAgentRuns, setWorkRun, startRun, type Scope, type Trigger } from "./routines";
import { getPage, tree } from "./store";

/**
 * Agents: a page whose blocks are the instructions of an LLM run. It runs as a worker on a todo of its own (so it shows in the Code
 * tab), is told where it is placed — its parent and sibling pages, its children — and what started it, and reaches the Workspace
 * through the MCP tools within what its permissions allow.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const excerpt = (pageId: number, n: number) => clip(docToMarkdown(getPage(pageId)?.content as never).replace(/\s+/g, " ").trim(), n);

const SCOPE_TEXT: Record<Scope, string> = {
  self: "Du darfst nur Änderungen an deiner eigenen Seite und an den Seiten darunter vornehmen (nur eigene Seiten). Alles andere ist nur lesbar.",
  parent: "Du darfst die Seite deiner Eltern-Seite ändern, ebenso alle Seiten darunter (deine Geschwister, deine eigene, deren Unterseiten). Alles außerhalb ist nur lesbar.",
  workspace: "Du darfst im ganzen Workspace Seiten und Datenbanken ändern (außer den Systemseiten: Prompts, Detailansichten, Anweisungen).",
  none: "Du darfst nichts ändern — du liest nur. Berichte, was du findest, als dein Ergebnis.",
};

const triggerText = (tr: Trigger): string => {
  if (tr.kind === "manual") return "Von Hand gestartet (manual).";
  if (tr.kind === "called") return "Aufgerufen von einer anderen Routine oder einem Aufruf (called).";
  if (tr.kind === "schedule") return "Nach Zeitplan gestartet (schedule).";
  return `Durch ein Ereignis gestartet: ${tr.event === "row.added" ? "eine Zeile wurde hinzugefügt (row.added)" : tr.event === "row.changed" ? "eine Zeile wurde geändert (row.changed)" : "eine Pipeline ist durchgelaufen (pipeline.ran)"}.`;
};

/** What the agent is told: its instructions (the blocks of its page), where it is placed, what started it, what it may do. */
export function buildAgentPrompt(pageId: number, trigger: Trigger, ctx: { row?: number; payload?: Record<string, string> } = {}): string {
  const page = getPage(pageId);
  const routine = getRoutine(pageId);
  if (!page || !routine) throw new Error("This page is no agent.");
  const all = tree();
  const parent = page.parentId ? getPage(page.parentId) : null;
  const siblings = all.filter((x) => x.parentId === page.parentId && x.id !== pageId).slice(0, 12);
  const children = all.filter((x) => x.parentId === pageId).slice(0, 12);
  const crumbs: string[] = [];
  for (let cur = page.parentId, hops = 0; cur && hops < 8; hops++) {
    const p = getPage(cur);
    if (!p) break;
    crumbs.unshift(p.title || "Untitled");
    cur = p.parentId;
  }
  const line = (p: { id: number; title: string; kind?: string }, n: number) => `- ${p.title || "Untitled"} (Seite ${p.id}${p.kind === "database" ? ", Datenbank" : ""})${excerpt(p.id, n) ? `: ${excerpt(p.id, n)}` : ""}`;
  const row = ctx.row ? recordOfRow(ctx.row) : null;
  return [
    `Du bist der Agent „${page.title || "Untitled"}“ im Workspace von Zeff (Seite ${pageId}). Führe deine Anweisungen aus.`,
    "",
    "## Deine Anweisungen",
    docToMarkdown(page.content as never).trim() || "(Die Seite enthält noch keine Anweisungen.)",
    "",
    "## Wo du stehst",
    `Pfad: ${[...crumbs, page.title || "Untitled"].join(" › ")}`,
    parent ? `Eltern-Seite: ${line(parent, 400).slice(2)}` : "Du stehst auf oberster Ebene.",
    ...(siblings.length ? ["Geschwister-Seiten:", ...siblings.map((s) => line(s, 200))] : []),
    ...(children.length ? ["Unterseiten von dir:", ...children.map((s) => line(s, 200))] : []),
    "",
    "## Was dich gestartet hat",
    triggerText(trigger),
    ...(row ? ["Die Zeile, um die es geht:", ...Object.entries(row).filter(([, v]) => v !== "" && v !== null && v !== false).map(([k, v]) => `- ${k}: ${v}`)] : []),
    ...(ctx.payload && Object.keys(ctx.payload).length ? ["Angaben: " + Object.entries(ctx.payload).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ")] : []),
    "",
    "## Was du darfst",
    SCOPE_TEXT[routine.permissions.scope],
    // (The data boundaries: what it can't read over the MCP, said up front — it is refused there anyway.)
    routine.permissions.personal
      ? "Persönliche Daten (als „persönlich“ markierte Quellen und Datenbanken: WhatsApp, Signal, Journal …) darfst du lesen; als „geheim“ markierte nie."
      : "Als „persönlich“ oder „geheim“ markierte Quellen und Datenbanken (WhatsApp, Signal, Journal …) kannst du nicht lesen — sie werden dir verweigert.",
    "Den Workspace erreichst du über die Zeff-MCP-Tools workspace_* (workspace_tree, workspace_search, workspace_read_page, workspace_write_page, workspace_update_row …). Lies zuerst, was du brauchst; erfinde nichts. Schließ mit einer kurzen Zusammenfassung ab, was du getan hast.",
  ].join("\n");
}

/** The MCP tool that changes Gmail, as the CLI names it — approved in advance for a worker whose routine may change Gmail. */
const GMAIL_CHANGE_TOOLS = ["mcp__zeff__gmail_change", "mcp__zeff__gmail_filter"];

type DispatchResult = { id: number };
export type AgentDeps = {
  /** Hand the instruction to a worker on this todo. */
  dispatch: (todoId: number, o: { instruction: string; provider?: string; approvedTools?: string[] }) => DispatchResult | Promise<DispatchResult>;
};

const realDeps: AgentDeps = {
  dispatch: async (todoId, o) => {
    const { dispatchTodo } = await import("@/lib/work/runner");
    return dispatchTodo(todoId, { instruction: o.instruction, ...(o.provider ? { provider: o.provider as never } : {}), ...(o.approvedTools?.length ? { approvedTools: o.approvedTools } : {}) });
  },
};

/** An agent started: a todo of its own, a worker on it — and the run, logged with its worker run. It goes on in the background. */
export async function startAgent(pageId: number, trigger: Trigger, ctx: { row?: number; payload?: Record<string, string> } = {}, deps: Partial<AgentDeps> = {}): Promise<{ status: "started" | "failed"; runId: number; workRunId?: number; error?: string }> {
  const page = getPage(pageId);
  if (!page || !getRoutine(pageId)) throw new Error("This page is no agent.");
  const runId = startRun(pageId, trigger);
  try {
    // (Its pages' excerpts and the row in hand: what is marked secret is left out — lib/boundaries.)
    const prompt = guardPrompt(buildAgentPrompt(pageId, trigger, ctx));
    const { addManualTodo } = await import("@/lib/boards/store");
    const todo = addManualTodo({ ticket: "", text: `Agent: ${page.title || "Untitled"}` });
    const run = await { ...realDeps, ...deps }.dispatch(todo.id, { instruction: prompt, provider: getRoutine(pageId)?.provider, ...(getRoutine(pageId)?.permissions.gmail ? { approvedTools: GMAIL_CHANGE_TOOLS } : {}) });
    setWorkRun(runId, run.id);
    return { status: "started", runId, workRunId: run.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    finishRun(runId, { status: "failed", log: [{ step: "agent", kind: "agent", status: "failed", note: error }], error });
    return { status: "failed", runId, error };
  }
}

type WorkRunLike = { status: string; summary?: string | null; error?: string | null } | undefined;

/** The runs of agents follow their workers: a worker run that has ended ends the routine's run. How many ended. */
export function syncAgentRuns(lookup: (workRunId: number) => WorkRunLike = realLookup): number {
  let ended = 0;
  for (const run of runningAgentRuns()) {
    const w = lookup(run.workRunId!);
    if (!w || w.status === "queued" || w.status === "running") continue;
    if (w.status === "done") finishRun(run.id, { status: "done", log: [{ step: "agent", kind: "agent", status: "ok", note: w.summary ?? "" }] });
    else finishRun(run.id, { status: "failed", log: [{ step: "agent", kind: "agent", status: "failed", note: w.error ?? w.status }], error: w.error ?? t("The worker run {status}.", { status: w.status }) });
    ended++;
  }
  return ended;
}

function realLookup(workRunId: number): WorkRunLike {
  const r = getSqlite().prepare("select status, summary, error from work_runs where id = ?").get(workRunId) as { status: string; summary: string | null; error: string | null } | undefined;
  return r;
}

// ---------------------------------------------------------------------------
// Permissions: what an agent's MCP requests may change
// ---------------------------------------------------------------------------

/** Whether a page lies at or under `root` (a row: through its database). */
function within(pageId: number | null, root: number): boolean {
  const d = getSqlite();
  for (let cur = pageId, hops = 0; cur && hops < 40; hops++) {
    if (cur === root) return true;
    const p = d.prepare("select parent_id, db_id from ws_pages where id = ?").get(cur) as { parent_id: number | null; db_id: number | null } | undefined;
    cur = p?.db_id ?? p?.parent_id ?? null;
  }
  return false;
}

/** An MCP request of an agent routine's worker may change what its scope allows — nothing more. Other requests are left alone. */
function agentScopeGuard(target: number | null): void {
  const run = callerRunId();
  if (!run) return;
  const pageId = routineOfWorkRun(run);
  const routine = pageId ? getRoutine(pageId) : null;
  if (!pageId || !routine) return;
  const scope = routine.permissions.scope;
  const refuse = () => {
    throw new Error(`This agent may not change that page (its permissions: ${scope === "none" ? "read-only" : scope === "self" ? "its own page and what is below" : scope === "parent" ? "its parent's pages" : "the workspace"}) — nicht erlaubt.`);
  };
  if (scope === "workspace") return;
  if (scope === "none") return refuse();
  const root = scope === "parent" ? (getPage(pageId)?.parentId ?? pageId) : pageId;
  if (!within(target, root)) refuse();
}

/** Whether the worker of this run (a work run's id) may change Gmail: it belongs to an agent routine whose permissions say so. */
export function mayChangeGmail(workRunId: number | undefined): boolean {
  if (!workRunId) return false;
  const pageId = routineOfWorkRun(workRunId);
  return !!pageId && getRoutine(pageId)?.permissions.gmail === true;
}

addAgentGuard(agentScopeGuard);
// The worker of an agent that may change Gmail has the tool approved for the CLI (its own check would refuse a write to the outside).
addApprovedTools((workRunId) => (mayChangeGmail(workRunId) ? GMAIL_CHANGE_TOOLS : []));
