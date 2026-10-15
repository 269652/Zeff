"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { runTodoAlternativeAction } from "@/plugins/todos/server-actions";
import { opsButton, type TodoView } from "@/lib/boards/shared";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/** The blue chip an operation (or an alternative) is shown as. */
export const OP_CHIP =
  "rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100";

/**
 * A todo's other ways to be done ("Rene zuweisen", "Merge into main"), each a row of its own:
 * its chip — what it does — and its button, which runs it at once (a merge asks first).
 */
export function TodoAlternatives({
  t: todo,
  disabled = false,
}: {
  t: TodoView;
  disabled?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!todo.alternatives?.length) return null;
  return (
    <>
      {todo.alternatives.map((a) => (
        <span
          key={a.label}
          className="flex items-center gap-2 max-sm:flex-col max-sm:items-start"
        >
          <span className={`${OP_CHIP} min-w-0 flex-1`}>
            ⚡ {a.label}
            <span className="block text-xs text-sky-950/80 dark:text-sky-100/80">
              {a.title}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-sm btn-primary shrink-0"
            disabled={disabled || pending}
            title={a.title}
            onClick={() => {
              if (
                a.ops.some((o) => o.type === "git-merge-main") &&
                !confirmAction(`${a.title}?`)
              )
                return;
              start(async () => {
                const r = await runTodoAlternativeAction(todo.id, a.label);
                toast(
                  r?.ok ? (r.message ?? t("Running.")) : (r?.error ?? t("Didn't work.")),
                  { tone: r?.ok ? "ok" : "error" },
                );
                router.refresh();
              });
            }}
          >
            {pending ? "…" : opsButton(a.ops, t)}
          </button>
        </span>
      ))}
    </>
  );
}
