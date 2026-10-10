"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { stopSyncAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { minutesText } from "@/plugins/sync-settings";
import { SyncIcon } from "./icons";
import { toast } from "./Toaster";

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const stopped = useRef(false);
  const run = (list: SyncSource[]) =>
    start(async () => {
      stopped.current = false;
      for (const s of list) {
        if (stopped.current) break;
        setRunning(s.key);
        const r = await s.sync();
        toast(`${s.label}: ${r?.ok ? (r.message ?? "synchronisiert") : (r?.error ?? "fehlgeschlagen")}`, { tone: r?.ok ? "ok" : "error" });
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
        title={pending ? "Abbrechen — der laufende Sync endet, die übrigen starten nicht" : `Synct ${sources.map((s) => s.label).join(", ")} — jetzt`}
      >
        <SyncIcon className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? `${sources.find((s) => s.key === running)?.label ?? "Sync"}… Stopp` : "Sync"}
        {failed && !pending && <span className="size-1.5 rounded-full bg-amber-500" aria-label="Ein Sync ist zuletzt fehlgeschlagen" />}
      </button>
      <button type="button" className="btn rounded-l-none border-l-0 px-2" aria-haspopup="dialog" aria-expanded={open} aria-label="Syncs: einzeln, Stand, Intervall" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" className={`size-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Syncs" className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white shadow-xl dark:divide-zinc-900 dark:border-zinc-800 dark:bg-zinc-950">
          {sources.map((s) => (
            <div key={s.key} className="space-y-1 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{s.label}</span>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run([s])}>
                  {pending && running === s.key ? "Synct…" : "Jetzt"}
                </button>
              </div>
              <p className={`text-xs ${!s.last ? "text-zinc-500" : s.last.ok ? "text-zinc-500" : "text-amber-700 dark:text-amber-400"}`} title={s.last ? new Date(s.last.at).toLocaleString() : undefined}>
                {s.last ? `Zuletzt ${s.last.ago}: ${s.last.result}` : "Noch nicht synchronisiert."}
              </p>
              <p className="text-xs text-zinc-400">
                Von selbst: {minutesText(s.minutes)} ·{" "}
                <Link href={`/sync-settings#${s.key}`} className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(false)}>
                  ändern
                </Link>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
