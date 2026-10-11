"use client";

import { useTransition } from "react";
import { flagTodoAction } from "@/plugins/todos/server-actions";
import { FlagIcon } from "../icons";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/** Flag a todo important (to the top of its list, urgent for the Ticket-Lage) — or take the flag off. Flagged: always shown, red. */
export function FlagButton({ todoId, todoRef, flagged, className = "icon-btn" }: { todoId: number; todoRef: string; flagged: boolean; className?: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`${className} ${flagged ? "text-red-600 opacity-100 dark:text-red-400" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
      disabled={pending}
      aria-pressed={flagged}
      aria-label={flagged ? t("{ref}: remove the “important” flag", { ref: todoRef }) : t("Flag {ref} as important", { ref: todoRef })}
      title={
        flagged
          ? t("Important — moves to the top, urgent for the briefing. Click: remove the flag")
          : t("Flag as important — moves to the top, urgent for the briefing")
      }
      onClick={() =>
        start(async () => {
          const r = await flagTodoAction(todoId, !flagged);
          if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
        })
      }
    >
      <FlagIcon filled={flagged} />
    </button>
  );
}
