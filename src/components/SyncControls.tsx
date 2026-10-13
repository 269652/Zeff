"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ActionState } from "@/app/action-helpers";
import { minutesText } from "@/plugins/sync-settings";
import { formatFull } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

/**
 * "Sync now", how the last sync went, and how often it runs in the background (set on the Sync
 * settings page) — for the Teams, Mail and GitLab pages. With `baseUrl`, the site's address is
 * set here too.
 */
export function SyncControls({
  syncKey,
  label,
  syncMinutes,
  last,
  sync,
  save,
  baseUrl,
}: {
  /** The sync's key on the Sync settings page. */
  syncKey: string;
  /** Its name, when a page has more than one ("WhatsApp"). */
  label?: string;
  syncMinutes: number;
  /** The last sync: when (and how long ago), whether it worked, what it said. */
  last: { at: string; ago: string; ok: boolean; result: string } | null;
  sync: () => Promise<ActionState>;
  /** Saves the address (`baseUrl`). */
  save?: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  baseUrl?: string;
}) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [saved, setSaved] = useState<ActionState>(null);
  const [base, setBase] = useState(baseUrl ?? "");
  const [syncing, startSync] = useTransition();
  const [saving, startSave] = useTransition();

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={syncing} onClick={() => startSync(async () => setState(await sync()))}>
            {syncing ? t("Syncing…") : label ? t("Sync {label}", { label }) : t("Sync now")}
          </button>
          <span className="text-xs text-zinc-500">
            {t("By itself: {interval}", { interval: minutesText(syncMinutes, t) })} ·{" "}
            <Link href={`/sync-settings#${syncKey}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("change")}
            </Link>
          </span>
        </div>
        <p className="text-xs">
          {state?.error ? (
            <span className="text-red-600 dark:text-red-400">{state.error}</span>
          ) : state?.ok ? (
            <span className="text-emerald-600 dark:text-emerald-400">{t("Synced: {message}", { message: state.message ?? "" })}</span>
          ) : last ? (
            <span className={last.ok ? "text-zinc-500" : "text-amber-700 dark:text-amber-400"} title={formatFull(last.at)}>
              {t("Last sync {ago}: {result}", { ago: last.ago, result: last.result })}
            </span>
          ) : (
            <span className="text-zinc-500">{t("Not synced yet.")}</span>
          )}
        </p>
      </div>
      {baseUrl !== undefined && save && (
        <form
          // Submitted by hand, not via `action`: React resets a form after an action.
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startSave(async () => setSaved(await save(null, fd)));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div>
            <label className="label" htmlFor="syncBaseUrl">{t("Address")}</label>
            <input
              id="syncBaseUrl"
              name="baseUrl"
              className="input w-64"
              value={base}
              placeholder="https://git.example.com"
              onChange={(e) => {
                setBase(e.target.value);
                setSaved(null);
              }}
            />
          </div>
          <button type="submit" className="btn btn-sm" disabled={saving}>
            {saving ? t("Saving…") : t("Save")}
          </button>
          {saved && <span className="basis-full text-xs">{saved.error ? <span className="text-red-600 dark:text-red-400">{saved.error}</span> : <span className="text-zinc-500">{saved.message}</span>}</span>}
        </form>
      )}
    </div>
  );
}
