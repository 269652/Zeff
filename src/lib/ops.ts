// "Do in Zeff" (what plugins offer to the AI) is registered by this: the dictionary and the checks need it.
import "@/plugins/actions/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { opLabel, opTitle, type TodoOp, type TodoView } from "@/lib/boards/shared";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { actionHref, actionOf } from "@/plugins/actions/catalog";
import { RUNNERS } from "@/plugins/actions/run";
import type { NextTodo } from "@/plugins/actions/run-types";
import { runJiraOps, type JiraOp } from "@/plugins/jira/run";
import { opAvailable } from "@/plugins/ops";

export type { NextTodo };

/**
 * Run a todo's operations, in order — each by the plugin that contributes it (Jira's in a row in
 * one session of Zeff's Jira connection, GitLab's through the automation Chrome, git in the repo,
 * a hand-over to a worker), each noted as it's done. The ones that open in your browser (a mail
 * draft, an appointment) aren't run here — they stay on the todo. At the first that fails it
 * stops: the ones done are taken off the todo (a retry doesn't do them twice), and it throws.
 * What was done, and the todos to leave for what's next.
 */
export async function runTodoOps(
  todo: TodoView,
  note: (line: string) => void,
  opts: { only?: number[] } = {},
): Promise<{ done: string[]; next: NextTodo[]; delivered: { what: string; link: string | null } | null }> {
  const done: string[] = [];
  const next: NextTodo[] = [];
  // What reached the others (a branch pushed, a merge request opened or merged): the one who asked hears of it (requester.ts).
  let delivered: { what: string; link: string | null } | null = null;
  // `only`: just these operations (by their place on the todo) — the others (and the ones that open in your browser) stay as they are.
  const chosen = (i: number) => !opts.only || opts.only.includes(i);
  let left = todo.ops.filter((o, i) => !actionHref(o) && chosen(i));
  // The ones that ran (or failed after being done): taken off the todo — and ONLY these. A run takes minutes (GitLab,
  // Chrome); the todo's actions may change meanwhile (the auto-actions review proposes them anew, you edit one, a plan
  // hands some over), so what's written back is the todo's CURRENT list minus the done ones, never the list as it was
  // when the run began (that would put back what was taken away and drop what was added).
  const ranOps: unknown[] = [];
  const keep = () => {
    const row = getDb().select({ ops: schema.todos.ops }).from(schema.todos).where(eq(schema.todos.id, todo.id)).get();
    let now: unknown[] = [];
    try {
      const v = JSON.parse(row?.ops ?? "[]") as unknown;
      now = Array.isArray(v) ? v : [];
    } catch {
      now = [];
    }
    // (The todo's view trims the texts of an action — "Title " is "Title" — so they're compared trimmed: else a done action stays and looks undone.)
    const same = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === "string" ? v.trim() : v));
    for (const op of ranOps) {
      const at = now.findIndex((x) => same(x) === same(op));
      if (at >= 0) now.splice(at, 1);
    }
    getDb().update(schema.todos).set({ ops: JSON.stringify(now) }).where(eq(schema.todos.id, todo.id)).run();
    // Open pages show it gone at once (not at their next refresh).
    if (ranOps.length) emitChange("todos");
  };
  try {
    while (left.length) {
      const op = left[0];
      // An action needs its plugin installed.
      if (!opAvailable(op.type)) throw new Error(t("{action}: not installed (Menu → Plugins).", { action: opTitle(op, t) }));
      note(`[Zeff] ${opLabel(op)} …`);
      if (op.type.startsWith("jira-")) {
        // The Jira operations in a row go in one session.
        const run: JiraOp[] = [];
        while (left.length && left[0].type.startsWith("jira-")) run.push(left.shift() as JiraOp);
        try {
          done.push(...(await runJiraOps(run, note)));
          ranOps.push(...run);
        } catch (e) {
          const ok = (e as { done?: string[] }).done ?? [];
          left = [...run.slice(ok.length), ...left]; // not done: back on the list
          ranOps.push(...run.slice(0, ok.length));
          done.push(...ok);
          throw e;
        }
        continue;
      }
      const runner = RUNNERS[op.type];
      if (!runner) throw new Error(t("{action}: there's nothing to run it.", { action: opTitle(op, t) }));
      const r = await runner(op, { todo, note });
      left.shift();
      ranOps.push(op);
      done.push(r.what);
      // What it left to know (a sent message): on the todo — its reference, its note.
      if (r.ref || r.todoNote) {
        const row = getDb().select({ refs: schema.todos.refs }).from(schema.todos).where(eq(schema.todos.id, todo.id)).get();
        const refs = [...new Set([...(JSON.parse(row?.refs ?? "[]") as string[]), ...(r.ref ? [r.ref] : [])])];
        getDb()
          .update(schema.todos)
          .set({ refs: JSON.stringify(refs), ...(r.todoNote ? { note: r.todoNote.slice(0, 500) } : {}) })
          .where(eq(schema.todos.id, todo.id))
          .run();
      }
      // What's next as a todo — unless this run delivers further itself (commit → push → MR, or → merge, in one go).
      if (r.next && !left.some((o) => actionOf(o.type).delivery)) next.push(r.next);
      if (op.type === "git-push" || op.type === "gitlab-open-mr" || op.type === "gitlab-merge" || op.type === "git-merge-main") {
        const { mrLink } = await import("@/lib/boards/requester");
        // The merge request's link wins over a push's words (push → MR in one go: the MR is what they review).
        const link = mrLink(r.what);
        if (link || !delivered?.link) delivered = { what: r.what, link };
      }
      note(`[Zeff] ✓ ${r.what}`);
    }
    return { done, next, delivered };
  } catch (e) {
    note(`[Zeff] ✗ ${errorMessage(e)}`);
    throw e;
  } finally {
    keep();
  }
}

/**
 * A todo's operations, run now by Zeff itself — a WhatsApp message, a note, a Teams message, a
 * Jira comment: no worker, no queue (only AI work goes through Work). Done when they are the todo
 * (a reply, a message); what's next (a delivery step) as a todo of its own. One at a time per todo.
 */
export async function runTodoOpsNow(todoId: number, opts: { only?: number[] } = {}): Promise<{ done: string[]; settled: boolean }> {
  const store = await import("@/lib/boards/store");
  const { opsSettle, todoRef } = await import("@/lib/boards/shared");
  const todo = store.getTodo(todoId);
  if (!todo) throw new Error(t("{ref} doesn't exist.", { ref: todoRef(todoId) }));
  if (todo.status !== "open") throw new Error(todo.status === "done" ? t("{ref} is done already.", { ref: todo.ref }) : t("{ref} is dismissed already.", { ref: todo.ref }));
  if (!todo.ops.length) throw new Error(t("{ref} has no actions.", { ref: todo.ref }));
  const running = (globalThis as { __zeffOpsNow?: Set<number> }).__zeffOpsNow ??= new Set();
  if (running.has(todoId)) throw new Error(t("{ref} is running already.", { ref: todo.ref }));
  running.add(todoId);
  try {
    console.log(`[ops ${todo.ref}] start${opts.only ? ` (only ${opts.only.join(",")})` : ""}: ${todo.ops.map((o) => o.type).join(", ")}`);
    const { done, next, delivered } = await runTodoOps(todo, (line) => console.log(`[ops ${todo.ref}] ${line}`), opts);
    for (const n of next) {
      const f = store.addFollowUp({ ticket: todo.ticket, text: n.text, kind: "merge", parentId: todo.id, workRunId: null, source: `Next step after ${todo.ref}`, ops: n.ops, owner: n.owner });
      store.handOverPlan(todo.id, f.id, ["merge", "review"]);
    }
    // Delivered: the one who asked for it gets a reply todo in their chat, the link in its draft.
    if (delivered) await (await import("@/lib/boards/requester")).tellRequester(todo, delivered).catch((e) => console.error(`[ops ${todo.ref}] telling the asker failed:`, e));
    // Settled when what ran is the todo — and nothing else is left on it.
    const ran = opts.only ? todo.ops.filter((_, i) => opts.only!.includes(i)) : todo.ops;
    const settled = (!opts.only || ran.length === todo.ops.length) && opsSettle({ ...todo, ops: ran });
    if (settled) store.setTodoStatus(todo.id, "done", done.join("; ").slice(0, 500));
    return { done, settled };
  } finally {
    running.delete(todoId);
  }
}

/**
 * An action from a row of the Workspace — your click on it (no todo): checked as a row may run it, then a draft's address
 * (it opens for you) or run (a message, something done in Zeff). `mode`: a Gmail mail sent — or saved as a draft — through
 * Gmail's API (the reply's own buttons; with Gmail's write access), into the row's conversation; never from what an AI handed over.
 */
export async function runRowOp(rowId: number, raw: Record<string, unknown>, mode?: "send" | "draft"): Promise<{ href?: string; what?: string }> {
  const { checkRowAction, rowMailConv } = await import("@/plugins/workspace/row-actions");
  const { op, href } = await checkRowAction(rowId, raw);
  if (mode && op.type === "gmail-compose") {
    const conv = rowMailConv(rowId);
    const { runGmailCompose } = await import("@/plugins/gmail/run");
    const r = await runGmailCompose(op as unknown as Extract<TodoOp, { type: "gmail-compose" }>, { mode: mode === "draft" ? "draft" : "send", thread: conv?.startsWith("gmail:") ? conv : null, refs: [`page:${rowId}`] });
    return { what: r.what };
  }
  if (href) return { href };
  const runner = RUNNERS[op.type as TodoOp["type"]];
  if (!runner) throw new Error(t("Unknown action."));
  const r = await runner(op as unknown as TodoOp, { todo: null as never, note: () => {} });
  return { what: r.what };
}
