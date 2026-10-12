"use client";

import { useTransition } from "react";
import { workedOnTodoAction } from "@/plugins/todos/server-actions";
import { ClockIcon } from "../icons";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/** "Worked on it": a booking suggestion for this todo in the Weekly report — without marking it done. */
export function WorkedOnButton({ todoId, todoRef }: { todoId: number; todoRef: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="icon-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      disabled={pending}
      aria-label={t("Worked on {ref}", { ref: todoRef })}
      title={t("Worked on it — suggests a booking for it in the Weekly report (the todo stays open)")}
      onClick={() =>
        start(async () => {
          const r = await workedOnTodoAction(todoId);
          toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
        })
      }
    >
      <ClockIcon />
    </button>
  );
}
