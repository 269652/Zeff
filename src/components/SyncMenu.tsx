"use client";

import { LoadingRow, Spinner } from "@/components/Spinner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { runSyncAction, runSyncAllAction, stopSyncAction, stopSyncAllAction, syncOverviewAction } from "@/app/actions";
import type { SyncOverview, SyncView } from "@/lib/sync/shared";
import { SyncIcon } from "./icons";
import { currentLocale, formatAgo, formatTime } from "@/lib/format";
import { useT } from "./I18nProvider";
import type { T } from "@/lib/i18n/shared";

/** Now, outside render (the clock isn't a render input). */
const now = () => Date.now();

/** "just now", "4 min ago", "2 h ago", "yesterday", or the date. */
function ago(isoTime: string): string {
  return formatAgo(isoTime, now());
}

/** "in 4 min (14:05)". */
function until(t: T, isoTime: string): string {
  const m = Math.max(0, Math.round((new Date(isoTime).getTime() - now()) / 60000));
  const at = formatTime(isoTime);
  return m < 1
    ? t("within a minute ({at})", { at })
    : m < 120
      ? t("in {m} min ({at})", { m, at })
      : t("at {when}", { when: new Date(isoTime).toLocaleString(currentLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) });
}

const every = (t: T, min: number) => (min % 60 === 0 ? t("every {n} h", { n: min / 60 }) : t("every {n} min", { n: min }));

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
  const t = useT();
  if (s.running) return <Spinner tone="indigo" label={t("Syncing")} className="block size-[18px]" />;
  if (!s.everyMinutes || !s.nextAt)
    return <span className="block size-[18px] rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600" title={t("Only by hand")} aria-label={t("Only by hand")} />;
  const label = s.window
    ? t("Runs {every} ({window}) — next {next}", { every: every(t, s.everyMinutes), window: s.window, next: until(t, s.nextAt) })
    : t("Runs {every} — next {next}", { every: every(t, s.everyMinutes), next: until(t, s.nextAt) });
  return (
    <span title={label} aria-label={label}>
      <NextRing s={s} />
    </span>
  );
}

/** One step in a sync list: its mark, name (to its page), how it last went, a button to run it now. */
export function SyncStepRow({ s, disabled, onRun, onStop, onNavigate, running = s.running }: { s: SyncView; disabled?: boolean; onRun: () => void; onStop?: () => void; onNavigate?: () => void; running?: boolean }) {
  const t = useT();
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
            t("syncing…")
          ) : s.lastAt ? (
            <>
              {s.lastOk === false ? <span className="text-red-600 dark:text-red-400">✗</span> : <span className="text-emerald-600 dark:text-emerald-400">✓</span>} {ago(s.lastAt)}
              {s.lastMessage ? ` · ${s.lastMessage}` : ""}
            </>
          ) : (
            t("not synced yet")
          )}
        </div>
      </div>
      {running && onStop ? (
        <button type="button" className="icon-btn text-red-600 dark:text-red-400" onClick={onStop} title={t("Cancel {step} — what it started ends with it", { step: s.label })} aria-label={t("Cancel {step}", { step: s.label })}>
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
            <rect x="5" y="5" width="10" height="10" rx="1.5" />
          </svg>
        </button>
      ) : (
        <button type="button" className="icon-btn" disabled={running || disabled} onClick={onRun} title={t("{step} now — {what}", { step: s.label, what: s.what })} aria-label={t("{step} now", { step: s.label })}>
          <SyncIcon />
        </button>
      )}
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
  const t = useT();
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
    const timer = setInterval(poll, open || running ? 2000 : 30000);
    return () => {
      alive = false;
      clearInterval(timer);
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
    const clock = setInterval(() => setTick((n) => n + 1), 15000);
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
      if (r && r.ok === false) setError(r.error ?? t("Couldn't start."));
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
        title={running ? t("Syncing…") : failed ? t("Sync — one failed last time") : t("Sync")}
      >
        <SyncIcon className={`size-5 ${running ? "animate-spin [animation-duration:1.5s]" : ""}`} />
        <span className="hidden sm:inline">{t("Sync")}</span>
        {failed && <span className="absolute top-1.5 right-1 size-1.5 rounded-full bg-red-500" aria-hidden />}
      </button>
      {open && (
        <div id="sync-menu" className="absolute right-0 z-50 mt-2 flex max-h-[calc(100dvh-5rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            {data?.all.running ? (
              <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" onClick={() => go(stopSyncAllAction)} title={t("Cancel the running step and start no more")}>
                <SyncIcon className="size-4 animate-spin" /> {t("Stop")}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" disabled={!data} onClick={() => go(runSyncAllAction)}>
                <SyncIcon className="size-4" /> {t("Sync all")}
              </button>
            )}
            <span className="truncate text-xs text-zinc-500">
              {data?.all.running
                ? t("Syncing all — {step}", { step: data.steps.find((s) => s.key === data.all.step)?.label ?? "…" })
                : t("One after the other, the briefing last")}
            </span>
          </div>
          {error && <p className="shrink-0 border-b border-zinc-200 px-3 py-2 text-xs text-red-600 dark:border-zinc-800 dark:text-red-400">{error}</p>}
          {/* The steps scroll (there are many); the head and the links stay. */}
          <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto overscroll-contain dark:divide-zinc-900">
            {(data?.steps ?? []).map((s) => (
              <SyncStepRow key={s.key} s={s} disabled={!!data?.all.running} onRun={() => go(() => runSyncAction(s.key))} onStop={() => go(() => stopSyncAction(s.key))} onNavigate={() => setOpen(false)} />
            ))}
            {!data && <LoadingRow>{t("Loading…")}</LoadingRow>}
          </ul>
          <div className="flex shrink-0 justify-between gap-3 border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
            <Link href="/sync-settings" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(false)}>
              {t("Set intervals")}
            </Link>
            <Link href="/logins" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(false)}>
              {t("Sign-ins")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
