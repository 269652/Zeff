import { opsButton, opTitle, type TodoView } from "@/lib/boards/shared";
import { clearWorkerDone, dropProposedOps, listTodos } from "@/lib/boards/store";
import { t } from "@/lib/i18n/server";
import type { ReviewSource } from "@/lib/review/point";

/**
 * What Todos has you confirm, for the review queue: the todos a worker, an agent or the AI review says are done
 * (closing them is yours), and the actions the auto-actions proposed on a todo (one click runs them). A todo whose
 * agent asks you something isn't here — that wants an answer, not a yes. The buttons are the todo's own. And the rules the
 * feedback ledger proposes from repetition (the same kind from the same sender, dropped again and again) — yours to confirm.
 */

/** The todos whose actions Zeff prepared itself (store.ts addFollowUp's sources, requester.ts). */
const PREPARED = /^(Delivered:|Next step after|Follow-up from|Planned after)/;

const title = (todo: TodoView) => (todo.ticket ? `${todo.ticket} · ${todo.text}` : todo.text);
const href = (todo: TodoView) => `/t/${todo.id}`;

function unknown(action: string): never {
  throw new Error(t("Unknown action: {action}", { action }));
}

/** What an action of the todo's server actions came to — its error thrown. */
async function done(r: Promise<{ ok: boolean; error?: string; message?: string } | null>): Promise<string | undefined> {
  const s = await r;
  if (s && !s.ok) throw new Error(s.error ?? t("Failed."));
  return s?.message;
}

export const TODOS_REVIEW: ReviewSource[] = [
  {
    id: "todo-done",
    get label() {
      return t("Done? — please confirm");
    },
    list: () =>
      listTodos({ status: "open" })
        .filter((x) => x.workerDone && !x.needsInput && !x.byWorker)
        .map((x) => ({
          id: String(x.id),
          title: title(x),
          detail: x.workerDone!.note ? `${x.workerDone!.by} — ${x.workerDone!.note}` : x.workerDone!.by,
          href: href(x),
          actions: [{ id: "yes", label: t("Done"), primary: true }, { id: "no", label: t("Not done") }],
        })),
    act: async (id, action) => {
      if (action === "yes") return done((await import("./server-actions")).setTodoStatusAction(Number(id), "done"));
      if (action === "no") return clearWorkerDone(Number(id));
      unknown(action);
    },
  },
  {
    id: "todo-actions",
    get label() {
      return t("Suggested actions");
    },
    list: () =>
      listTodos({ status: "open" })
        .filter((x) => x.ops.length && x.autoOpsWhy && !x.needsInput)
        .map((x) => ({
          id: String(x.id),
          title: title(x),
          detail: [x.ops.map((o) => opTitle(o, t)).join(" · "), x.autoOpsWhy].join(" — "),
          href: href(x),
          // Not primary: "y" would send them — that takes a click on the button itself.
          actions: [{ id: "yes", label: opsButton(x.ops, t) }, { id: "no", label: t("Dismiss") }],
        })),
    act: async (id, action) => {
      if (action === "yes") return done((await import("./server-actions")).runTodoOpsAction(Number(id)));
      if (action === "no") return dropProposedOps(Number(id));
      unknown(action);
    },
  },
  {
    // Prepared, not proposed: the next step Zeff worked out itself — a branch's push and merge request, a reply to the one who
    // asked with the link (lib/boards/requester.ts) — one click each, from here (and from the phone: its home-screen shortcut).
    id: "todo-prepared",
    get label() {
      return t("Prepared — one click");
    },
    list: async () => {
      const { actionHref } = await import("@/plugins/actions/catalog");
      return listTodos({ status: "open" })
        // Zeff's own preparation only (the step after a delivery, a worker's follow-up, a planned step, the asker told) — actions you
        // wrote on a todo yourself are yours to run where you wrote them.
        .filter((x) => x.ops.length && PREPARED.test(x.source ?? "") && !x.autoOpsWhy && !x.needsInput && !x.workerDone && x.owner === "me" && !x.blockedBy && x.ops.every((o) => !actionHref(o)))
        .map((x) => ({
          id: String(x.id),
          title: title(x),
          detail: [x.ops.map((o) => opTitle(o, t)).join(" · "), x.draft ? `“${x.draft.slice(0, 160)}”` : ""].filter(Boolean).join(" — "),
          href: href(x),
          // Not primary: "y" would run them — that takes a click on the button itself.
          actions: [{ id: "yes", label: opsButton(x.ops, t) }],
        }));
    },
    act: async (id, action) => {
      if (action === "yes") return done((await import("./server-actions")).runTodoOpsAction(Number(id)));
      unknown(action);
    },
  },
  {
    id: "ai-rule",
    get label() {
      return t("Rules from repetition");
    },
    list: async () => {
      const { proposeRules } = await import("@/lib/learning/rules");
      const { stepLabel } = await import("@/lib/learning");
      return proposeRules().map((r) => ({
        id: String(r.id),
        title: `${stepLabel(r.step)}: ${t("Leave alone: from {sender}, like “{kind}”", { sender: r.sender, kind: r.kind })}`,
        detail: `${t("rejected {n}×", { n: r.evidence.length })}: ${r.evidence.map((e) => `„${e.text}“`).join(" · ")}`,
        href: "/settings/ai#rules",
        actions: [{ id: "yes", label: t("Confirm rule") }, { id: "no", label: t("Dismiss") }],
      }));
    },
    act: async (id, action) => {
      const { decideRule } = await import("@/lib/learning/rules");
      if (action === "yes") return void decideRule(Number(id), "confirmed");
      if (action === "no") return void decideRule(Number(id), "dismissed");
      unknown(action);
    },
  },
];
