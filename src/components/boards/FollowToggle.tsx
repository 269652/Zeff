"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setTicketFollowAction } from "@/plugins/todos/server-actions";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * Following a ticket besides the boards' filter: on a followed ticket, why and "nicht mehr";
 * on one that left the list, "weiter verfolgen".
 */
export function FollowToggle({ ticket, followed }: { ticket: string; followed?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (value: 1 | -1) =>
    start(async () => {
      const r = await setTicketFollowAction(ticket, value);
      toast(r?.ok ? (r.message ?? t("OK")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  if (followed)
    return (
      <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" title={t("Not (or no longer) on your board filter — here because you work on it")}>
        {t("followed")} · {followed}
        <button type="button" className="ml-0.5 underline-offset-2 hover:underline" disabled={pending} onClick={() => set(-1)} title={t("Stop following — it drops out of the briefing on the next run")}>
          {t("unfollow")}
        </button>
      </span>
    );
  return (
    <button type="button" className="text-[11px] text-indigo-700 hover:underline dark:text-indigo-300" disabled={pending} onClick={() => set(1)} title={t("Keep it in the briefing although it is no longer on your board filter")}>
      {t("keep following")}
    </button>
  );
}
