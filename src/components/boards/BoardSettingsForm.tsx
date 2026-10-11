"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveBoardSettingsAction } from "@/plugins/todos/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { minutesText } from "@/plugins/sync-settings";
import { SubmitButton } from "../SubmitButton";
import { useT } from "@/components/I18nProvider";

/** Which tickets on the chosen boards (a JQL filter); how often a run goes by itself: the Sync settings page; the AI: the Settings page. */
export function BoardSettingsForm({ jql, autoMinutes, boards, ai }: { jql: string; autoMinutes: number; boards: string[]; ai: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBoardSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-zinc-500">
        {t("Boards:")}{" "}
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{boards.length ? boards.join(", ") : t("none")}</span> — {t("chosen on the")}{" "}
        <Link href="/jira" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Jira tab")}
        </Link>
        . {t("AI:")} <span className="font-medium text-zinc-700 dark:text-zinc-200">{ai}</span> — {t("chosen in")}{" "}
        <Link href="/preferences" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Settings")}
        </Link>
        .
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div>
          <label className="label" htmlFor="board-jql">
            {t("Filter on the boards (JQL)")}
          </label>
          <input id="board-jql" name="jql" className="input font-mono text-xs" defaultValue={jql} />
        </div>
        <div>
          <span className="label">{t("By itself")}</span>
          <p className="py-1.5 text-sm">
            {t("{every} on weekdays", { every: minutesText(autoMinutes, t) })} ·{" "}
            <Link href="/sync-settings#boards" className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("change")}
            </Link>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-sm" pendingText={t("Saving…")} pending={pending}>
          {t("Save")}
        </SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
