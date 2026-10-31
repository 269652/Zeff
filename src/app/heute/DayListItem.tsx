"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { tickDayItemAction } from "@/plugins/workspace/actions";

/** An item of a day list still open today, ticked in place (its time stamped by the list) — then it leaves the list. */
export function DayListItem({ id, title, dose }: { id: number; title: string; dose?: string }) {
  const t = useT();
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (gone) return null;
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 translate-y-0.5 accent-indigo-600"
        aria-label={title}
        disabled={pending}
        onChange={() =>
          start(async () => {
            const r = await tickDayItemAction(id, true);
            if (!r.ok) return void setError(r.error || t("Didn't work."));
            setGone(true);
            router.refresh();
          })
        }
      />
      <span className="min-w-0 flex-1">
        {title}
        {dose && <span className="ml-1.5 text-xs text-zinc-500">{dose}</span>}
        {error && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{error}</span>}
      </span>
    </li>
  );
}
