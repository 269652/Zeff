import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { opLabel, type TodoOp, type TodoView } from "@/lib/boards/shared";
import { errorMessage } from "@/lib/errors";
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
): Promise<{ done: string[]; next: NextTodo[] }> {
  const done: string[] = [];
  const next: NextTodo[] = [];
  const inBrowser = todo.ops.filter((o) => actionHref(o));
  let left = todo.ops.filter((o) => !actionHref(o));
  const keep = () =>
    getDb()
      .update(schema.todos)
      .set({ ops: JSON.stringify([...left, ...inBrowser]) })
      .where(eq(schema.todos.id, todo.id))
      .run();
  try {
    while (left.length) {
      const op = left[0];
      // An action needs its plugin installed.
      if (!opAvailable(op.type)) throw new Error(`${opLabel(op)}: das Plugin dafür ist nicht installiert — Menü → Plugins.`);
      note(`[Zeff] ${opLabel(op)} …`);
      if (op.type.startsWith("jira-")) {
        // The Jira operations in a row go in one session.
        const run: JiraOp[] = [];
        while (left.length && left[0].type.startsWith("jira-")) run.push(left.shift() as JiraOp);
        try {
          done.push(...(await runJiraOps(run, note)));
        } catch (e) {
          const ok = (e as { done?: string[] }).done ?? [];
          left = [...run.slice(ok.length), ...left]; // not done: back on the list
          done.push(...ok);
          throw e;
        }
        continue;
      }
      const runner = RUNNERS[op.type];
      if (!runner) throw new Error(`${opLabel(op)}: dafür gibt es keinen Ausführer.`);
      const r = await runner(op, { todo, note });
      left.shift();
      done.push(r.what);
      // What it left to know (a sent message): on the todo — its reference, its note.
      if (r.ref || r.todoNote) {
        const t = getDb().select({ refs: schema.todos.refs }).from(schema.todos).where(eq(schema.todos.id, todo.id)).get();
        const refs = [...new Set([...(JSON.parse(t?.refs ?? "[]") as string[]), ...(r.ref ? [r.ref] : [])])];
        getDb()
          .update(schema.todos)
          .set({ refs: JSON.stringify(refs), ...(r.todoNote ? { note: r.todoNote.slice(0, 500) } : {}) })
          .where(eq(schema.todos.id, todo.id))
          .run();
      }
      // What's next as a todo — unless this run delivers further itself (commit → push → MR, or → merge, in one go).
      if (r.next && !left.some((o) => actionOf(o.type).delivery)) next.push(r.next);
      note(`[Zeff] ✓ ${r.what}`);
    }
    return { done, next };
  } catch (e) {
    note(`[Zeff] ✗ ${errorMessage(e)}`);
    throw e;
  } finally {
    keep();
  }
}

/** Whether all of a todo's operations open in your browser (nothing for Zeff to run). */
export const onlyInBrowser = (ops: TodoOp[]) => ops.length > 0 && ops.every((o) => !!actionHref(o));

/**
 * A todo's operations, run now by Zeff itself — a WhatsApp message, a note, a Teams message, a
 * Jira comment: no worker, no queue (only AI work goes through Work). Done when they are the todo
 * (a reply, a message); what's next (a delivery step) as a todo of its own. One at a time per todo.
 */
export async function runTodoOpsNow(todoId: number): Promise<{ done: string[]; settled: boolean }> {
  const store = await import("@/lib/boards/store");
  const { opsSettle, todoRef } = await import("@/lib/boards/shared");
  const todo = store.getTodo(todoId);
  if (!todo) throw new Error(`${todoRef(todoId)} gibt es nicht.`);
  if (todo.status !== "open") throw new Error(`${todo.ref} ist schon ${todo.status === "done" ? "erledigt" : "verworfen"}.`);
  if (!todo.ops.length) throw new Error(`${todo.ref} hat keine Aktionen.`);
  const running = (globalThis as { __zeffOpsNow?: Set<number> }).__zeffOpsNow ??= new Set();
  if (running.has(todoId)) throw new Error(`${todo.ref} läuft schon.`);
  running.add(todoId);
  try {
    const { done, next } = await runTodoOps(todo, (line) => console.log(`[ops ${todo.ref}] ${line}`));
    for (const n of next) {
      const f = store.addFollowUp({ ticket: todo.ticket, text: n.text, kind: "merge", parentId: todo.id, workRunId: null, source: `Folgeschritt von ${todo.ref}`, ops: n.ops, owner: n.owner });
      store.handOverPlan(todo.id, f.id, ["merge", "review"]);
    }
    const settled = opsSettle(todo);
    if (settled) store.setTodoStatus(todo.id, "done", done.join("; ").slice(0, 500));
    return { done, settled };
  } finally {
    running.delete(todoId);
  }
}
