"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setEntryStartAction } from "@/app/entry-group-actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";

/**
 * An entry's start time, set right in the table: what makes work parallel to other work (and the
 * stretch a group spans). Typed ("9:30") and left with Enter or a click away; where there is none, the
 * time its work log began that day is offered (click it) — nothing is guessed behind your back.
 */
export function EntryStartCell({ entryId, start, suggested }: { entryId: number; start: string | null; suggested?: string }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(start ?? "");
  const [pending, run] = useTransition();
  const save = (v: string) => {
    if (v.trim() === (start ?? "")) return;
    run(async () => {
      const r = await setEntryStartAction(entryId, v);
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      if (!r?.ok) setValue(start ?? "");
      router.refresh();
    });
  };
  return (
    <span className="mt-0.5 flex items-center gap-1">
      <input
        className={`w-12 rounded border border-transparent bg-transparent px-0.5 text-xs text-zinc-400 tabular-nums hover:border-zinc-300 focus:border-indigo-400 focus:text-zinc-700 focus:outline-none dark:hover:border-zinc-600 dark:focus:text-zinc-200 ${value ? "" : "placeholder:text-zinc-300 dark:placeholder:text-zinc-600"}`}
        value={value}
        placeholder={t("start")}
        aria-label={t("Start time")}
        title={t("When the work began — what makes it parallel to other work. Typed like 9:30.")}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setValue(start ?? "");
        }}
      />
      {!value && suggested && (
        <button type="button" className="rounded bg-indigo-50 px-1 text-xs text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300" disabled={pending} title={t("The work on it began at {time} (its work log) — use it as the start", { time: suggested })} onClick={() => (setValue(suggested), save(suggested))}>
          {suggested}?
        </button>
      )}
    </span>
  );
}
