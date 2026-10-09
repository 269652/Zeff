"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/app/actions";

/**
 * "Sync now", how the last sync went, and how often it runs in the background — for the Teams
 * and GitLab pages. With `baseUrl`, the site's address is set here too.
 */
export function SyncControls({
  syncMinutes,
  last,
  sync,
  save,
  baseUrl,
}: {
  syncMinutes: number;
  /** The last sync: when (and how long ago), whether it worked, what it said. */
  last: { at: string; ago: string; ok: boolean; result: string } | null;
  sync: () => Promise<ActionState>;
  save: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  baseUrl?: string;
}) {
  const [state, setState] = useState<ActionState>(null);
  const [saved, setSaved] = useState<ActionState>(null);
  const [minutes, setMinutes] = useState(String(syncMinutes));
  const [base, setBase] = useState(baseUrl ?? "");
  const [syncing, startSync] = useTransition();
  const [saving, startSave] = useTransition();

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="space-y-1">
        <button type="button" className="btn btn-primary btn-sm" disabled={syncing} onClick={() => startSync(async () => setState(await sync()))}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <p className="text-xs">
          {state?.error ? (
            <span className="text-red-600 dark:text-red-400">{state.error}</span>
          ) : state?.ok ? (
            <span className="text-emerald-600 dark:text-emerald-400">Synced: {state.message}</span>
          ) : last ? (
            <span className={last.ok ? "text-zinc-500" : "text-amber-700 dark:text-amber-400"} title={new Date(last.at).toLocaleString()}>
              Last sync {last.ago}: {last.result}
            </span>
          ) : (
            <span className="text-zinc-500">Not synced yet.</span>
          )}
        </p>
      </div>
      <form
        // Submitted by hand, not via `action`: React resets a form after an action.
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startSave(async () => setSaved(await save(null, fd)));
        }}
        className="flex flex-wrap items-end gap-2"
      >
        {baseUrl !== undefined && (
          <div>
            <label className="label" htmlFor="syncBaseUrl">Address</label>
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
        )}
        <div>
          <label className="label" htmlFor="syncMinutes">Sync every (min)</label>
          <input
            id="syncMinutes"
            name="syncMinutes"
            type="number"
            min={0}
            max={1440}
            className="input num w-24"
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setSaved(null);
            }}
          />
        </div>
        <button type="submit" className="btn btn-sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <span className="basis-full text-xs text-zinc-500">
          {saved?.error ? <span className="text-red-600 dark:text-red-400">{saved.error}</span> : saved?.ok ? saved.message : "0 = only when you press Sync now."}
        </span>
      </form>
    </div>
  );
}
