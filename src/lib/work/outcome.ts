import type { WorkRun } from "@/db/schema";
import { whoWrote } from "@/lib/boards/requester";
import { isTodoKind, todoRef, type TodoOp } from "@/lib/boards/shared";
import { addFollowUp, addTodoAiNote, getTodo, listTodos, markWorkerDone, setTodoDraft, setTodoOps, setTodoStatus } from "@/lib/boards/store";
import { pushedLink } from "./remote";
import { linkBranchContext } from "./branch-context";
import { saveReport } from "./report";
import { runActions } from "./log";
import { sameTodo } from "@/lib/boards/similar";

export { sameTodo };
import { applyTodoRules } from "@/lib/boards/todo-rules";
import { WORK_RESULT_SCHEMA, workRef, type Channel, type WorkFollowUp, type WorkResult } from "./shared";

const channelOf = (c: unknown): Channel | null => (c === "jira" || c === "teams" || c === "gitlab" ? c : null);

/** A worker's answer, cleaned: what it may say, in the shapes Zeff keeps (null when it isn't one). */
export function normalizeResult(raw: unknown): WorkResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 500)).filter(Boolean).slice(0, 50) : undefined);
  if (typeof o.summary !== "string" && typeof o.outcome !== "string") return null;
  // Operations at the top level (a worker that wrote `ops` beside the report, as if they ran on their own) never run by
  // themselves: they become a follow-up todo that carries them, to run with one click.
  // (A jira-assign on the ticket a jira-create comes from would assign the source, not the new one - dropped, the text says who.)
  const topAll = Array.isArray(o.ops) ? (o.ops.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
  const created = new Set(topAll.filter((x) => x.type === "jira-create").map((x) => String(x.ticket ?? "").toUpperCase()));
  const isAssignOfNew = (x: Record<string, unknown>) => x.type === "jira-assign" && created.has(String(x.ticket ?? "").toUpperCase());
  // (The assignee goes with the ticket when it is created.)
  const assignee = topAll.find(isAssignOfNew)?.assignee;
  const topOps = topAll.filter((x) => !isAssignOfNew(x)).map((x) => (x.type === "jira-create" && typeof assignee === "string" && assignee && !x.assignee ? { ...x, assignee } : x));
  const followUps = o.followUps;
  // What is not taken as written is said (the contract is WORK_RESULT_SCHEMA): a field it doesn't have, a value it doesn't know, ops at the wrong level.
  const warnings: string[] = [];
  const known = new Set<string>(Object.keys(WORK_RESULT_SCHEMA.properties));
  const extra = Object.keys(o).filter((k) => !known.has(k) && k !== "ops");
  if (extra.length) warnings.push(`Unknown field${extra.length > 1 ? "s" : ""} ignored: ${extra.join(", ")}`);
  if (typeof o.outcome === "string" && !["done", "partial", "blocked"].includes(o.outcome)) warnings.push(`outcome "${o.outcome}" is not done/partial/blocked - taken as ${o.outcome === "success" ? "done" : "partial"}`);
  if (topAll.length) warnings.push("ops at the top level: belong in followUps[].ops - made a follow-up of");
  if (topAll.length > topOps.length) warnings.push("jira-assign on a ticket that is being created: the assignee was moved into the jira-create (the new ticket has no key yet)");
  return {
    outcome: o.outcome === "done" || o.outcome === "success" ? "done" : o.outcome === "blocked" ? "blocked" : "partial",
    summary: str(o.summary, 20000),
    entry: str(o.entry, 200),
    completedTodos: Array.isArray(o.completedTodos) ? o.completedTodos.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
    followUps: [...(Array.isArray(followUps) ? followUps : []), ...(topOps.length ? [{ kind: "other", text: (str(o.entry, 200) || "Run the operations the worker prepared") + "", ops: topOps }] : [])].flatMap((f): WorkFollowUp[] => {
      const x = (f ?? {}) as Record<string, unknown>;
      const text = str(x.text, 500);
      if (!text) return [];
      return [
        {
          kind: isTodoKind(x.kind) ? x.kind : "other",
          text,
          channel: channelOf(x.channel) ?? ("none" as const),
          target: str(x.target, 300) || undefined,
          draft: str(x.draft, 8000) || undefined,
          ops: Array.isArray(x.ops) ? x.ops : undefined,
        },
      ];
    }).slice(0, 20),
    changes: list(o.changes),
    checks: list(o.checks),
    draft: str(o.draft, 8000) || undefined,
    channel: channelOf(o.channel) ?? undefined,
    target: str(o.target, 300) || undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** A drafted message as the operation that sends it, one click: a reply in a GitLab thread, a Jira comment (null: none such). */
export function messageOp(f: { channel?: string; target?: string | null; draft?: string | null }, ticket: string): TodoOp | null {
  const body = f.draft?.trim();
  if (!body) return null;
  const note = /(note:\d+)/.exec(f.target ?? "")?.[1];
  if (f.channel === "gitlab" && note) return { type: "gitlab-reply", note, body };
  if (f.channel === "jira") return { type: "jira-comment", ticket: /^[A-Z][A-Z0-9]+-\d+$/i.test(f.target ?? "") ? f.target!.toUpperCase() : ticket, body };
  // A Teams reply to the one who asked: a button when it goes to them in a chat of the two of you (the message's sender, or
  // their name as the target) — a group chat or a channel Zeff can't post into: copied by you.
  if (f.channel === "teams") {
    const target = f.target?.trim() ?? "";
    if (target.startsWith("teams:")) {
      const asker = whoWrote(target);
      return asker?.oneOnOne ? { type: "teams-message", to: asker.who, body } : null;
    }
    if (/^[\p{L}][\p{L} .'-]{1,80}$/u.test(target)) return { type: "teams-message", to: target, body };
  }
  return null;
}


/**
 * What a finished run's answer means for the todos: a drafted message goes onto its todo (which
 * stays open until it's sent); the todos it finished — open ones on its ticket only — are marked
 * "done by the worker" (highlighted, still open: closing them is yours — with them the comments
 * and messages they came from) — except for Zeff's own runs (a click of yours), which close them; what's next becomes follow-up todos
 * (mine, with their drafts), traceable to the run.
 */
export function applyOutcome(run: WorkRun, res: WorkResult): { closed: number[]; marked: number[]; added: number[]; dupes?: string[] } {
  const closed: number[] = [];
  const marked: number[] = [];
  const added: number[] = [];
  const ref = workRef(run.id);

  if (run.mode === "draft" && res.draft) {
    setTodoDraft(run.todoId, { draft: res.draft, channel: res.channel ?? null, target: res.target ?? null, workRunId: run.id });
  }

  const open = new Set(listTodos({ ticket: run.ticket, status: "open" }).map((t) => t.id));
  const done = new Set(res.completedTodos.filter((id) => open.has(id)));
  // Your instruction done isn't the todo done: only when the run says so (completedTodos).
  if (res.outcome === "done" && run.mode !== "draft" && run.mode !== "instruct") done.add(run.todoId);
  if (run.mode === "draft") done.delete(run.todoId); // open until it's sent
  for (const id of done) {
    if (!open.has(id)) continue;
    const why = `Done by ${ref}${res.entry ? `: ${res.entry}` : ""}`;
    if (run.provider === "zeff") {
      setTodoStatus(id, "done", why);
      closed.push(id);
    } else {
      markWorkerDone(id, `${ref}${run.model ? ` · ${run.model}` : ""}`, res.entry || res.summary.trim().split(String.fromCharCode(10))[0]);
      marked.push(id);
    }
  }

  // A follow-up that only repeats an open todo is merged into it by the gate (addFollowUp: the oldest keeps its id,
  // the history says the run) - never into the todo this run has just finished or closed: that one is the follow-up's
  // reason ("Implement X" -> "Test X by hand"), not its twin. A merged one's message becomes the survivor's operation.
  const own = getTodo(run.todoId);
  const folded: string[] = [];
  const dupes: string[] = [];
  for (const f of res.followUps) {
    const target = f.target?.trim() || null;
    const ticket = f.channel === "jira" && target && /^[A-Z][A-Z0-9]+-\d+$/i.test(target) ? target : run.ticket;
    const t = addFollowUp({
      ticket,
      text: f.text,
      kind: f.kind,
      draft: f.draft ?? null,
      channel: f.channel === "none" ? null : (f.channel ?? null),
      target,
      parentId: run.todoId,
      workRunId: run.id,
      source: `Follow-up from ${ref}`,
      ops: f.ops,
      byWorker: true,
    });
    if (t.outcome) {
      dupes.push(todoRef(t.id));
      // Its message: on the todo it repeats as the operation that sends it (first - before resolving
      // the threads), else in the report.
      const op = messageOp(f, run.ticket);
      const now = getTodo(t.id);
      if (op && now && !now.ops.some((o) => o.type === op.type)) setTodoOps(t.id, [op, ...now.ops]);
      else if (f.draft && t.id === run.todoId && !op) folded.push(f.draft);
      continue;
    }
    added.push(t.id);
  }
  // The whole report, kept apart from the comment (which is cut short): filed under the todo, read by the knowledge server.
  const reportId = saveReport(run, res);
  // Every run leaves its summary on its todo as a comment — open or done now — with where its pushed work is.
  const mine = own ?? getTodo(run.todoId);
  if (mine && res.summary.trim()) {
    const link = run.branch && run.repo ? pushedLink(run.repo, run.branch) : null;
    // What it did on the way (an interactive session's tool calls, your answers) — with its answer.
    const actions = runActions(run.id);
    addTodoAiNote(mine.id, {
      text: [res.summary.trim(), ...folded.map((d) => `Suggested message: ${d}`), ...(actions.length ? [`Actions:\n${actions.map((a) => `- ${a}`).join("\n")}`] : [])].join("\n\n"),
      by: `${ref}${run.model ? ` · ${run.model}` : ""}`,
      // Where its pushed work is — else the whole report.
      ...(link ? { url: link.url, urlLabel: link.label } : reportId ? { url: `/reports/${reportId}`, urlLabel: "Report" } : {}),
    });
  }
  // What was not taken as written: on the todo, where it is read and the worker's format gets fixed.
  if (mine && res.warnings?.length) addTodoAiNote(mine.id, { text: `Result format - ${res.warnings.join("; ")}`, by: ref });
  // Its follow-ups by the same rules as the Ticket-Lage's: waiting ones to "Wartet auf andere", joint ones asking for a time.
  if (added.length) applyTodoRules();
  // Its feature branch and merge request (as far as GitLab has them) go into the todo's context, linked.
  linkBranchContext([run.todoId, ...done]);
  return { closed, marked, added, ...(dupes.length ? { dupes } : {}) };
}
