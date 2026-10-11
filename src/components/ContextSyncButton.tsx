"use client";

import { useState, useTransition } from "react";
import { syncContextsToJiraAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";

/**
 * Posts context items to their Jira tickets (a comment each, plus their files) — after a
 * confirmation, as it writes to Jira. `changed`: they were posted and edited since (amber).
 */
export function ContextSyncButton({
  ids,
  label,
  tickets = [],
  small = false,
  changed = false,
  title,
}: {
  ids: number[];
  label?: string;
  /** The tickets they go to, for the confirmation. */
  tickets?: string[];
  small?: boolean;
  changed?: boolean;
  title?: string;
}) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const where = tickets.length ? [...new Set(tickets)].join(", ") : "";
  const tone = changed
    ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-950"
    : "";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={`btn ${small ? "btn-sm" : "btn-sm btn-primary"} ${tone}`}
        disabled={pending || ids.length === 0}
        onClick={() => {
          const question =
            ids.length === 1
              ? where
                ? t("Post this context item to {tickets} as Jira comments, with their links and files?", { tickets: where })
                : t("Post this context item as Jira comments, with their links and files?")
              : where
                ? t("Post {n} context items to {tickets} as Jira comments, with their links and files?", { n: ids.length, tickets: where })
                : t("Post {n} context items as Jira comments, with their links and files?", { n: ids.length });
          if (!confirm(question)) return;
          startTransition(async () => setState(await syncContextsToJiraAction(ids)));
        }}
        title={title ?? t("Post each item as a comment on its Jira ticket (edits update that comment) and attach its files")}
      >
        {pending ? t("Syncing…") : (label ?? t("Sync to Jira"))}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && !small && <span className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</span>}
    </span>
  );
}
