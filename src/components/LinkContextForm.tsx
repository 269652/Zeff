"use client";

import { startTransition, useActionState, useState } from "react";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

/** "Link existing": put a context item that's already in Zeff on this entry too (filter, pick, link). */
export function LinkContextForm({
  action: serverAction,
  options,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  /** Items not on this entry yet, newest first. */
  options: { id: number; label: string }[];
}) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionState, FormData>(serverAction, null);
  const [filter, setFilter] = useState("");
  const shown = options.filter((o) => o.label.toLowerCase().includes(filter.trim().toLowerCase()));
  if (options.length === 0) return <p className="text-sm text-zinc-500">{t("No other context items yet.")}</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(() => action(new FormData(e.currentTarget)));
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="min-w-40 flex-1">
        <label className="label" htmlFor="ctx-filter">{t("Find")}</label>
        <input id="ctx-filter" className="input" placeholder={t("name, ticket, words…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="min-w-64 flex-[2]">
        <label className="label" htmlFor="ctx-pick">{t("Context item")}</label>
        <select id="ctx-pick" name="contextId" className="input" key={filter} defaultValue={shown[0]?.id}>
          {shown.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>
      <SubmitButton className="btn btn-sm" pendingText={t("Linking…")} pending={pending}>
        {t("Link")}
      </SubmitButton>
      {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
    </form>
  );
}
