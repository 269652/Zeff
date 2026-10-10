"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveBoardSettingsAction, type ActionState } from "@/app/actions";
import { minutesText } from "@/plugins/sync-settings";
import { SubmitButton } from "../SubmitButton";

/** Which tickets on the chosen boards (a JQL filter); how often a run goes by itself: the Sync settings page; the AI: the Settings page. */
export function BoardSettingsForm({ jql, autoMinutes, boards, ai }: { jql: string; autoMinutes: number; boards: string[]; ai: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBoardSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-zinc-500">
        Boards: <span className="font-medium text-zinc-700 dark:text-zinc-200">{boards.length ? boards.join(", ") : "keine"}</span> — gewählt auf dem{" "}
        <Link href="/jira" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Jira-Tab
        </Link>
        . KI: <span className="font-medium text-zinc-700 dark:text-zinc-200">{ai}</span> — gewählt in den{" "}
        <Link href="/preferences" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Einstellungen
        </Link>
        .
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div>
          <label className="label" htmlFor="board-jql">
            Filter auf den Boards (JQL)
          </label>
          <input id="board-jql" name="jql" className="input font-mono text-xs" defaultValue={jql} />
        </div>
        <div>
          <span className="label">Von selbst</span>
          <p className="py-1.5 text-sm">
            {minutesText(autoMinutes)} an Werktagen ·{" "}
            <Link href="/sync-settings#boards" className="text-indigo-600 hover:underline dark:text-indigo-400">
              ändern
            </Link>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-sm" pendingText="Speichert…" pending={pending}>
          Speichern
        </SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
