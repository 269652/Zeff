"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { stopSyncAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { minutesText } from "@/plugins/sync-settings";
import { SyncIcon } from "./icons";
import { toast } from "./Toaster";
import { formatFull } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import { useDismiss } from "@/components/useDismiss";

export type SyncSource = {
  /** The sync's key on the Sync settings page. */
  key: string;
  label: string;
  /** How often it runs by itself (minutes, 0: by hand). */
  minutes: number;
  last: { at: string; ago: string; ok: boolean; result: string } | null;
  sync: () => Promise<ActionState>;
};

/**
 * A page's syncs as a split button: "Sync" runs them all, one after the other; the dropdown shows
 * each with how it last went and how often it runs by itself — and syncs one alone.
 */
export function SyncSplitButton({ sources }: { sources: SyncSource[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useDismiss(root, open, () => setOpen(false));

  const stopped = useRef(false);
  const run = (list: SyncSource[]) =>
    start(async () => {
      stopped.current = false;
      for (const s of list) {
        if (stopped.current) break;
        setRunning(s.key);
        const r = await s.sync();
        toast(`${s.label}: ${r?.ok ? (r.message ?? t("synced")) : (r?.error ?? t("failed"))}`, { tone: r?.ok ? "ok" : "error" });
      }
      setRunning(null);
      router.refresh();
    });
  const failed = sources.some((s) => s.last && !s.last.ok);

  return (
    <div ref={root} className="relative flex">
      <button
        type="button"
        className={`btn rounded-r-none ${pending ? "text-red-600 dark:text-red-400" : ""}`}
        onClick={() => {
          // Running: the button stops it (and the rest of the list).
          if (pending) {
            stopped.current = true;
            if (running) void stopSyncAction(running);
            return;
          }
          run(sources);
        }}
        title={pending ? t("Cancel — the running sync ends, the others don't start") : t("Syncs {list} — now", { list: sources.map((s) => s.label).join(", ") })}
      >
        <SyncIcon className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? t("{label}… Stop", { label: sources.find((s) => s.key === running)?.label ?? t("Sync") }) : t("Sync")}
        {failed && !pending && <span role="img" className="size-1.5 rounded-full bg-amber-500" aria-label={t("A sync failed last time")} />}
      </button>
      <button type="button" className="btn rounded-l-none border-l-0 px-2" aria-haspopup="dialog" aria-expanded={open} aria-label={t("Syncs: one by one, status, interval")} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" className={`size-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label={t("Syncs")} className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white shadow-xl dark:divide-zinc-900 dark:border-zinc-800 dark:bg-zinc-950">
          {sources.map((s) => (
            <div key={s.key} className="space-y-1 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{s.label}</span>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run([s])}>
                  {pending && running === s.key ? t("Syncing…") : t("Now")}
                </button>
              </div>
              <p className={`text-xs ${!s.last ? "text-zinc-500" : s.last.ok ? "text-zinc-500" : "text-amber-700 dark:text-amber-400"}`} title={s.last ? formatFull(s.last.at) : undefined}>
                {s.last ? t("Last {ago}: {result}", { ago: s.last.ago, result: s.last.result }) : t("Not synced yet.")}
              </p>
              <p className="text-xs text-zinc-400">
                {t("By itself: {interval}", { interval: minutesText(s.minutes, t) })} ·{" "}
                <Link href={`/settings/connections#${s.key}`} className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(false)}>
                  {t("change")}
                </Link>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
