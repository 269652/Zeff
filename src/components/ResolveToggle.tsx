"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";

/**
 * "Erledigt" for something a colleague wrote (a Jira comment, a Teams message): marked, the Ticket-Lage
 * runs make no new todos from it. Shown at once; back as it was if saving fails.
 */
export function ResolveToggle({
  done,
  onChange,
  className = "",
  hint,
}: {
  done: boolean;
  onChange: (next: boolean) => Promise<ActionState>;
  className?: string;
  /** What hovering says, done and not (by default: about Ticket-Lage runs). */
  hint?: { done: string; open: string };
}) {
  const t = useT();
  const [value, setValue] = useState(done);
  const [from, setFrom] = useState(done);
  if (from !== done) {
    setFrom(done);
    setValue(done);
  }
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={value}
      onClick={() =>
        start(async () => {
          const next = !value;
          setValue(next);
          const r = await onChange(next);
          if (r && !r.ok) setValue(!next);
        })
      }
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium transition ${
        value
          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-200"
          : "border border-zinc-300 text-zinc-500 hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-400"
      } ${className}`}
      title={
        value
          ? (hint?.done ?? t("Done — the briefing makes no new todos from it. Click: reopen."))
          : (hint?.open ?? t("Mark as done — the briefing then makes no new todos from it"))
      }
    >
      {value ? `✓ ${t("done")}` : t("done?")}
    </button>
  );
}
