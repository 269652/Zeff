import { opsButton, opTitle, type TodoView } from "@/lib/boards/shared";
import { clearWorkerDone, dropProposedOps, listTodos } from "@/lib/boards/store";
import { t } from "@/lib/i18n/server";
import type { ReviewSource } from "@/lib/review/point";

/**
 * What Todos has you confirm, for the review queue: the todos a worker, an agent or the AI review says are done
 * (closing them is yours), and the actions the auto-actions proposed on a todo (one click runs them). A todo whose
 * agent asks you something isn't here — that wants an answer, not a yes. The buttons are the todo's own.
 */

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
];
