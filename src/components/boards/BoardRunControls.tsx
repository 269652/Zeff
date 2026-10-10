"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  runBoardAction,
  runSyncAction,
  stopBoardRunAction,
  stopSyncAction,
  syncOverviewAction,
} from "@/app/actions";
import type { SyncKey, SyncOverview } from "@/lib/sync/shared";
import { ChevronIcon } from "../icons";
import { SyncStepRow } from "../SyncMenu";

/** What "Jetzt auswerten" does, in order — each a step of its own, as in the Sync menu. */
/** After the syncs it runs first (the Auswerten settings): the Lage and its steps. */
const AFTER_STEPS: SyncKey[] = ["boards", "mailtodos", "relations", "notetodos", "noterelations", "knowledgerel", "autoactions"];

const PHASES: Record<string, string> = {
  sync: "synct vorher",
  jira: "liest Jira und Zeff",
  ai: "wertet aus",
  saving: "speichert",
  mailtodos: "sucht Todos in Mails und WhatsApp",
  mails: "ordnet Mails den Todos zu",
  notetodos: "sucht Todos in Notizen",
  knowledge: "ordnet den Todos Wissen zu",
  notes: "ordnet Notizen den Todos zu",
  autoactions: "macht Aktionen für die Todos",
};

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
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = async () => {
      try {
        const d = await syncOverviewAction();
        if (alive) setSteps(d);
      } catch {
        // the next poll tries again
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const runStep = (key: SyncKey) =>
    start(async () => {
      setError(null);
      const r = await runSyncAction(key);
      if (r && !r.ok) setError(r.error ?? "Couldn't start.");
      setSteps(await syncOverviewAction());
      router.refresh();
    });

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    const follow = setInterval(() => router.refresh(), 4000);
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
            ? `${provider} ${PHASES.ai}`
            : (PHASES[phase ?? ""] ?? "läuft")}
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
            onClick={() =>
              start(async () => {
                const r = await stopBoardRunAction();
                if (r && !r.ok) setError(r.error ?? "Ging nicht.");
                router.refresh();
              })
            }
            title="Die Auswertung abbrechen — der Schritt, an dem sie ist (Sync, KI), endet mit"
          >
            Abbrechen
          </button>
        </span>
      )}
      <div ref={root} className="relative flex">
        <button
          type="button"
          className="btn btn-primary rounded-r-none"
          disabled={running || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await runBoardAction();
              if (r && !r.ok) setError(r.error ?? "Couldn't start.");
              router.refresh();
            })
          }
          title="Synct erst, was unter Auswerten → „Vorher synchronisieren“ steht, liest dann deine Tickets (mit Kommentaren und Historie) und was Zeff dazu weiß, lässt die KI aus den Einstellungen die Lage und die Todos daraus machen — und ordnet danach jedem Todo die Mails zu, um die es geht"
        >
          {running || pending ? "Läuft…" : "Jetzt auswerten"}
        </button>
        <button
          type="button"
          className="btn btn-primary rounded-l-none border-l border-white/30 px-2"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls="board-run-steps"
          onClick={toggle}
          title="Die Schritte der Auswertung — wie sie zuletzt liefen, jeder einzeln startbar"
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
              „Jetzt auswerten“ macht diese Schritte nacheinander — jeder geht
              auch einzeln.
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {RUN_STEPS.flatMap(
                (key) => steps?.steps.filter((s) => s.key === key) ?? [],
              ).map((s) => (
                <SyncStepRow
                  key={s.key}
                  s={s}
                  disabled={pending || (running && s.key === "boards")}
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
                <li className="px-3 py-3 text-sm text-zinc-500">Lädt…</li>
              )}
            </ul>
          </div>
        )}
      </div>
      {error && (
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
