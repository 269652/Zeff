"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { runSyncAction, runSyncAllAction, syncOverviewAction } from "@/app/actions";
import type { SyncOverview, SyncView } from "@/lib/sync/shared";
import { SyncIcon } from "./icons";

/** Now, outside render (the clock isn't a render input). */
const now = () => Date.now();

/** "just now", "4 min ago", "2 h ago", "yesterday", or the date. */
function ago(isoTime: string): string {
  const s = Math.max(0, (now() - new Date(isoTime).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(isoTime).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "in 4 min (14:05)". */
function until(isoTime: string): string {
  const m = Math.max(0, Math.round((new Date(isoTime).getTime() - now()) / 60000));
  const at = new Date(isoTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return m < 1 ? `within a minute (${at})` : m < 120 ? `in ${m} min (${at})` : `at ${new Date(isoTime).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
}

const every = (min: number) => (min % 60 === 0 ? `every ${min / 60} h` : `every ${min} min`);

/** A ring filling up from the last run toward the next one by itself. */
function NextRing({ s }: { s: SyncView }) {
  const start = s.lastAt ? new Date(s.lastAt).getTime() : now();
  const end = s.nextAt ? new Date(s.nextAt).getTime() : now();
  const done = end > start ? Math.min(1, Math.max(0, (now() - start) / (end - start))) : 1;
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-zinc-200 dark:stroke-zinc-700" />
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done)} className="stroke-indigo-500 transition-[stroke-dashoffset] duration-700" />
    </svg>
  );
}

/** The ring (or a spinner while it runs, a dashed circle when only by hand) — its tooltip says when. */
function StepMark({ s }: { s: SyncView }) {
  if (s.running) return <span className="block size-[18px] animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" aria-label="Syncing" />;
  if (!s.everyMinutes || !s.nextAt)
    return <span className="block size-[18px] rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600" title="Only by hand" aria-label="Only by hand" />;
  const label = `Runs ${every(s.everyMinutes)}${s.window ? ` (${s.window})` : ""} — next ${until(s.nextAt)}`;
  return (
    <span title={label} aria-label={label}>
      <NextRing s={s} />
    </span>
  );
}

/** One step in a sync list: its mark, name (to its page), how it last went, a button to run it now. */
export function SyncStepRow({ s, disabled, onRun, onNavigate, running = s.running }: { s: SyncView; disabled?: boolean; onRun: () => void; onNavigate?: () => void; running?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <span className="shrink-0">
        <StepMark s={{ ...s, running }} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={s.href} className="text-sm font-medium hover:underline" onClick={onNavigate} title={s.what}>
          {s.label}
        </Link>
        <div className="truncate text-xs text-zinc-500" title={s.lastMessage ?? undefined}>
          {running ? (
            "syncing…"
          ) : s.lastAt ? (
            <>
              {s.lastOk === false ? <span className="text-red-600 dark:text-red-400">✗</span> : <span className="text-emerald-600 dark:text-emerald-400">✓</span>} {ago(s.lastAt)}
              {s.lastMessage ? ` · ${s.lastMessage}` : ""}
            </>
          ) : (
            "not synced yet"
          )}
        </div>
      </div>
      <button type="button" className="icon-btn" disabled={running || disabled} onClick={onRun} title={`${s.label} jetzt — ${s.what}`} aria-label={`${s.label} jetzt`}>
        <SyncIcon />
      </button>
    </li>
  );
}

/**
 * The header's sync menu: a button — turning while anything syncs, a red dot when a sync
 * last failed — opening every sync: "Sync all", and each step with how it last went, when it
 * runs next by itself (its ring fills up toward it), and a button of its own. The page shows
 * what a sync brought once it's done.
 */
export function SyncMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SyncOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(false);
  const running = !!data && (data.all.running || data.steps.some((s) => s.running));
  const failed = !!data && data.steps.some((s) => s.lastOk === false && !s.running);

  // Follow the syncs: often while open or something runs, now and then otherwise (the button's state).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await syncOverviewAction();
        if (alive) setData(d);
      } catch {
        // the next poll tries again
      }
    };
    void poll();
    const t = setInterval(poll, open || running ? 2000 : 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, running]);

  // A sync finished: show what it brought.
  useEffect(() => {
    if (wasRunning.current && !running) router.refresh();
    wasRunning.current = running;
  }, [running, router]);

  // While open: the rings move on; a click outside or Escape closes.
  useEffect(() => {
    if (!open) return;
    const clock = setInterval(() => setTick((t) => t + 1), 15000);
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      clearInterval(clock);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (fn: () => Promise<{ ok?: boolean; error?: string } | null>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r && r.ok === false) setError(r.error ?? "Couldn't start.");
      setData(await syncOverviewAction());
    });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="sync-menu"
        onClick={() => setOpen(!open)}
        title={running ? "Syncing…" : failed ? "Sync — one failed last time" : "Sync"}
      >
        <SyncIcon className={`size-5 ${running ? "animate-spin [animation-duration:1.5s]" : ""}`} />
        <span className="hidden sm:inline">Sync</span>
        {failed && <span className="absolute top-1.5 right-1 size-1.5 rounded-full bg-red-500" aria-hidden />}
      </button>
      {open && (
        <div id="sync-menu" className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <button type="button" className="btn btn-primary btn-sm" disabled={!data || data.all.running} onClick={() => go(runSyncAllAction)}>
              <SyncIcon className={`size-4 ${data?.all.running ? "animate-spin" : ""}`} /> Sync all
            </button>
            <span className="truncate text-xs text-zinc-500">
              {data?.all.running ? `Syncing all — ${data.steps.find((s) => s.key === data.all.step)?.label ?? "…"}` : "One after the other, Ticket-Lage last"}
            </span>
          </div>
          {error && <p className="border-b border-zinc-200 px-3 py-2 text-xs text-red-600 dark:border-zinc-800 dark:text-red-400">{error}</p>}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {(data?.steps ?? []).map((s) => (
              <SyncStepRow key={s.key} s={s} disabled={!!data?.all.running} onRun={() => go(() => runSyncAction(s.key))} onNavigate={() => setOpen(false)} />
            ))}
            {!data && <li className="px-3 py-3 text-sm text-zinc-500">Loading…</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
