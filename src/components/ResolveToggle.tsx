"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/app/actions";

/**
 * "Erledigt" for something a colleague wrote (a Jira comment, a Teams message): marked, Boards
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
  /** What hovering says, done and not (by default: about Boards runs). */
  hint?: { done: string; open: string };
}) {
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
          ? (hint?.done ?? "Erledigt — Boards macht keine neuen Todos daraus. Klick: wieder offen.")
          : (hint?.open ?? "Als erledigt markieren — Boards macht dann keine neuen Todos daraus")
      }
    >
      {value ? "✓ erledigt" : "erledigt?"}
    </button>
  );
}
