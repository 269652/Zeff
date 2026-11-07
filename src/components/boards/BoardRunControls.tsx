"use client";

import { LoadingRow } from "@/components/Spinner";
import { RunMachines, canStart, isBusy } from "@/lib/run-state";
import { FormError } from "@/components/FormError";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { runBoardAction, stopBoardRunAction } from "@/plugins/todos/server-actions";
import { runSyncAction, stopSyncAction, syncOverviewAction } from "@/app/actions";
import type { SyncKey, SyncOverview } from "@/lib/sync/shared";
import { ChevronIcon } from "../icons";
import { SyncStepRow } from "../SyncMenu";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { useDismiss } from "@/components/useDismiss";

/** What "Jetzt auswerten" does, in order — each a step of its own, as in the Sync menu. */
/** After the syncs it runs first (the Auswerten settings): the Lage and its steps. */
// The stepped steps stand for their parts (Review: mails, notes, documents, appointments; Matching: what each todo is about).
const AFTER_STEPS: SyncKey[] = ["boards", "review", "matching", "autoactions"];

const phases = (t: T): Record<string, string> => ({
  sync: t("syncing first"),
  jira: t("reading Jira and Zeff"),
  ai: t("analyzing"),
  saving: t("saving"),
  mailtodos: t("finding todos in mails and WhatsApp"),
  mails: t("matching mails to the todos"),
  notetodos: t("finding todos in notes"),
  knowledge: t("matching knowledge to the todos"),
  notes: t("matching notes to the todos"),
  calendarmatch: t("matching appointments to the todos"),
  calendartodos: t("finding todos in appointments"),
  documents: t("finding todos in documents"),
  docrelations: t("matching documents to the todos"),
  people: t("finding the people in the todos"),
  autoactions: t("taking actions for the todos"),
});

/** Seconds since a moment, as m:ss (outside render: the clock isn't a render input). */
const sinceText = (since: number) => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * "Jetzt auswerten": starts a run (in the background on the server). While one goes, the page
 * follows it — refreshed every few seconds, the time and step shown.
 */
export function BoardRunControls({
  running,
  phase,
  since,
  provider,
  presync = ["teams", "jira", "mail", "whatsapp"],
}: {
  running: boolean;
  phase: string | null;
  since: number | null;
  provider: string;
  /** The syncs it runs first (Auswerten → Vorher synchronisieren). */
  presync?: SyncKey[];
}) {
  const t = useT();
  const PHASES = phases(t);
  const RUN_STEPS = [...presync, ...AFTER_STEPS];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  // Its steps, like the Sync menu: open beside the button.
  const [open, setOpen] = useState(false);
  // The menu: fixed under the buttons, inside the window — a sidebar that scrolls can't cut it off.
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = root.current?.getBoundingClientRect();
    if (r) {
      const width = Math.min(352, window.innerWidth - 16);
      setPlace({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), maxHeight: window.innerHeight - r.bottom - 16 });
    }
    setOpen(true);
  };
  const [steps, setSteps] = useState<SyncOverview | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // The run and each of its steps in one strict state machine (lib/run-state): a click moves idle → starting at once, so nothing is
  // pressed twice; what the server reports (running or not) moves it on; an event that doesn't fit the state does nothing.
  const machines = useRef(new RunMachines());
  const [, bump] = useState(0);
  const feed = (d: SyncOverview) => {
    for (const x of d.steps) machines.current.observe(x.key, x.running);
    bump((n) => n + 1);
  };
  const stateOf = (key: string) => machines.current.state(key);
  useEffect(() => {
    machines.current.observe("run", running);
    bump((n) => n + 1);
  }, [running]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await syncOverviewAction();
        if (alive) {
          setSteps(d);
          feed(d);
        }
      } catch {
        // the next poll tries again
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);
  useDismiss(root, open, () => setOpen(false));
  const runStep = (key: SyncKey) => {
    if (!machines.current.send(key, "click")) return; // not idle (starting, running …): nothing happens
    bump((n) => n + 1);
    start(async () => {
      setError(null);
      const r = await runSyncAction(key).catch(() => null);
      if (!r || !r.ok) {
        machines.current.send(key, "refused");
        setError(r?.error ?? t("Couldn't start."));
      } else machines.current.accepted(key);
      const d = await syncOverviewAction();
      setSteps(d);
      feed(d);
      router.refresh();
    });
  };

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    // The run's phase, now and then (its end refreshes at once, through LiveRefresh) — a refresh renders the whole Lage.
    const follow = setInterval(() => router.refresh(), 10000);
    return () => {
      clearInterval(clock);
      clearInterval(follow);
    };
  }, [running, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {running && (
        <span
          className="inline-flex items-center gap-2 text-sm text-zinc-500"
          role="status"
        >
          <span
            className="size-2 animate-pulse rounded-full bg-indigo-500"
            aria-hidden
          />
          {since ? sinceText(since) : ""} ·{" "}
          {phase === "ai"
            ? t("{provider} analyzing", { provider })
            : (PHASES[phase ?? ""] ?? t("running"))}
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
            onClick={() =>
              start(async () => {
                const r = await stopBoardRunAction();
                if (r && !r.ok) setError(r.error ?? t("Didn't work."));
                router.refresh();
              })
            }
            title={t("Cancel the run — the step it is on (sync, AI) ends with it")}
          >
            {t("Cancel")}
          </button>
        </span>
      )}
      <div ref={root} className="relative flex">
        <button
          type="button"
          className="btn btn-primary rounded-r-none"
          disabled={running || pending || !canStart(stateOf("run"))}
          onClick={() => {
            if (!machines.current.send("run", "click")) return; // not idle: nothing happens
            bump((n) => n + 1);
            start(async () => {
              setError(null);
              const r = await runBoardAction().catch(() => null);
              if (!r || !r.ok) {
                machines.current.send("run", "refused");
                setError(r?.error ?? t("Couldn't start."));
              } else machines.current.accepted("run");
              bump((n) => n + 1);
              router.refresh();
            });
          }}
          title={t(
            "First syncs what AI steps → “Sync first” lists, then reads your tickets (with comments and history) and what Zeff knows about them, has the AI from the settings write the briefing and the todos — and then matches each todo with the mails it is about",
          )}
        >
          {running || pending || isBusy(stateOf("run")) ? t("Running…") : t("Run now")}
        </button>
        <button
          type="button"
          className="btn btn-primary rounded-l-none border-l border-white/30 px-2"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls="board-run-steps"
          onClick={toggle}
          title={t("The run's steps — how they last ran, each one startable on its own")}
        >
          <ChevronIcon className={`size-4 ${open ? "-rotate-90" : "rotate-90"}`} />
        </button>
        {open && (
          <div
            id="board-run-steps"
            style={place ? { position: "fixed", top: place.top, left: place.left, maxHeight: place.maxHeight } : undefined}
            className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <p className="border-b border-zinc-200 px-3 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
              {t("“Run now” does these steps one after another — each also works on its own.")}
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {RUN_STEPS.flatMap(
                (key) => steps?.steps.filter((s) => s.key === key) ?? [],
              ).map((s) => (
                <SyncStepRow
                  key={s.key}
                  s={s}
                  disabled={pending || (running && s.key === "boards") || !canStart(stateOf(s.key))}
                  running={s.running || isBusy(stateOf(s.key))}
                  onRun={() => runStep(s.key)}
                  onStop={() =>
                    start(async () => {
                      await (s.key === "boards" ? stopBoardRunAction() : stopSyncAction(s.key));
                      router.refresh();
                    })
                  }
                  onNavigate={() => setOpen(false)}
                />
              ))}
              {!steps && (
                <LoadingRow>{t("Loading…")}</LoadingRow>
              )}
            </ul>
          </div>
        )}
      </div>
      {error && (
        <FormError>{error}</FormError>
      )}
    </div>
  );
}
