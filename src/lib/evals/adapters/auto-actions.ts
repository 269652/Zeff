/**
 * The auto-actions review as an eval step: the todos it proposed actions for (auto_ops_why set) — one you did
 * since: must (it should get actions again); one still open: open; one you dropped is out (the todo wasn't wanted,
 * whatever its actions). Items: `todo:<id>` (it got at least one action that passes the actions' own rules) and
 * `todo:<id>:<type>` for each kind of action it has now (open: the kinds proposed, not judged one by one — the
 * ai_feedback ledger will say which were taken). Frozen as the step shows them: each todo's block (its ticket,
 * sources, notes, what exists in Zeff), the actions' dictionary, the address book, the accounts, your busy times —
 * in batches of 6 like the step. A run: the step's prompt builder ({{me}} and {{today}} filled in), the AI, cleanOps.
 */
import { getSqlite } from "@/db";
import type { EvalAdapter, EvalCase, Label } from "../harness";

export type AutoActionsInput = { todos: { id: number; ticket: string; block: string }[]; dictionary: string; book: string[]; accounts: string[]; busyLines: string[]; me: string; today: string };

const PER_CASE = 6;

export const autoActionsAdapter: EvalAdapter<AutoActionsInput> = {
  step: "auto-actions",
  title: "Auto-Aktionen",
  task: "auto-actions",
  prompt: { file: "src/plugins/auto-actions/review.ts" },
  costUsd: 1,
  async build() {
    const rows = getSqlite().prepare("select id, status, ops from todos where auto_ops_why is not null and status in ('done', 'open') order by id").all() as { id: number; status: string; ops: string }[];
    if (!rows.length) return [];
    const review = await import("@/plugins/auto-actions/review");
    const { listTodos, lastGoodRun } = await import("@/lib/boards/store");
    const { todoSources } = await import("@/lib/boards/sources");
    const { opsDictionary } = await import("@/lib/boards/shared");
    const { opAvailable } = await import("@/plugins/ops");
    const { offerContext } = await import("@/plugins/actions/server");
    const { myJiraName } = await import("@/lib/jira/store");
    const labels: Record<string, Label> = {};
    for (const r of rows) {
      labels[`todo:${r.id}`] = r.status === "done" ? "must" : "open";
      let ops: { type?: string }[] = [];
      try {
        ops = JSON.parse(r.ops) as { type?: string }[];
      } catch {
        // none readable
      }
      for (const o of Array.isArray(ops) ? ops : []) if (typeof o?.type === "string") labels[`todo:${r.id}:${o.type}`] = "open";
    }
    const wanted = new Set(rows.map((r) => r.id));
    const list = listTodos({ status: "all" }).filter((t) => wanted.has(t.id));
    const board = lastGoodRun();
    const blocks = await review.todoBlocks(list, todoSources(list, board?.tickets ?? []), board, offerContext);
    const dictionary = opsDictionary(opAvailable);
    const busyLines = review.busyLinesOf(review.busyTimes());
    const me = myJiraName() ?? "";
    const today = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const cases: EvalCase<AutoActionsInput>[] = [];
    for (let i = 0; i < blocks.length; i += PER_CASE) {
      const batch = blocks.slice(i, i + PER_CASE);
      const text = batch.map((b) => b.text).join("\n\n");
      const mine = (k: string) => batch.some((b) => k === `todo:${b.t.id}` || k.startsWith(`todo:${b.t.id}:`));
      const caseLabels = Object.fromEntries(Object.entries(labels).filter(([k]) => mine(k)));
      const what: Record<string, string> = {};
      for (const k of Object.keys(caseLabels)) {
        const [, id, type] = k.split(":");
        const t = batch.find((b) => String(b.t.id) === id)!.t;
        what[k] = `${t.ref}${type ? ` (${type})` : ""}: „${t.text.slice(0, 70)}“`;
      }
      cases.push({
        id: `auto-actions-${cases.length + 1}`,
        input: { todos: batch.map((b) => ({ id: b.t.id, ticket: b.t.ticket, block: b.text })), dictionary, book: review.addressBook(text), accounts: await review.accountsOf(text), busyLines, me, today },
        labels: caseLabels,
        what,
      });
    }
    return cases;
  },
  async run(c, instructions, ask) {
    const { autoActionsPrompt, AUTO_ACTIONS_SCHEMA } = await import("@/plugins/auto-actions/review");
    const { cleanOps } = await import("@/lib/boards/shared");
    const { extraBlock } = await import("@/lib/boards/context-prefs");
    const v = c.input;
    const filled = instructions.replace(/\{\{(\w+)\}\}/g, (all, name: string) => (name === "me" ? v.me || "der Nutzer" : name === "today" ? v.today : all));
    const prompt = autoActionsPrompt({ instructions: filled + extraBlock("autoactions"), dictionary: v.dictionary, book: v.book, accounts: v.accounts, busyLines: v.busyLines, todos: v.todos.map((t) => t.block).join("\n\n") });
    const answer = (await ask(prompt, AUTO_ACTIONS_SCHEMA, { task: "auto-actions", step: "auto-actions" })) as { todos?: { id?: number; ops?: unknown[] }[] } | null;
    const covered = new Set<string>();
    for (const a of answer?.todos ?? []) {
      const t = v.todos.find((x) => x.id === Number(a?.id));
      if (!t) continue;
      const ops = cleanOps(a.ops ?? [], t.ticket);
      if (ops.length) covered.add(`todo:${t.id}`);
      for (const o of ops) covered.add(`todo:${t.id}:${o.type}`);
    }
    return covered;
  },
};
