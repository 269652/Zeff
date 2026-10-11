"use client";

import { useState, useTransition } from "react";
import { syncOutlookAction } from "@/plugins/outlook-calendar/server-actions";
import { currentLocale, formatDateTime } from "@/lib/format";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";

/** Reads the calendar from Outlook in the automation Chrome (read-only) into Zeff. */
export function OutlookSyncButton({ week, syncedAt }: { week: string; syncedAt: string | null }) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const synced = syncedAt ? new Date(syncedAt) : null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {state?.error && <span className="text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      {!state && synced && (
        <span className="text-zinc-400" title={synced.toLocaleString(currentLocale())}>
          {t("Synced {at}", { at: formatDateTime(synced) })}
        </span>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending}
        onClick={() => startTransition(async () => setState(await syncOutlookAction(week)))}
        title={t(
          "Read your Outlook calendar — from the start of last month to next week — in the automation Chrome (nothing is changed in Outlook)",
        )}
      >
        {pending ? t("Syncing Outlook…") : t("Sync Outlook")}
      </button>
    </div>
  );
}
