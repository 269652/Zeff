"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { runSyncAllAction, stopSyncAllAction, syncOverviewAction } from "@/app/actions";
import type { SyncOverview } from "@/lib/sync/shared";
import { toast } from "./Toaster";

/**
 * The setup's data step: every sync, one after the other — the Ticket-Lage (the first review) last —
 * started with one click and followed live: which step runs, how each went.
 */
export function SetupDataRun({ next }: { next: string }) {
  const [data, setData] = useState<SyncOverview | null>(null);
  const [started, setStarted] = useState(false);
  const [pending, start] = useTransition();
  const running = !!data?.all.running;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const d = await syncOverviewAction().catch(() => null);
      if (alive && d) setData(d);
    };
    void poll();
    const t = setInterval(poll, running ? 2000 : 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running]);

  const go = () =>
    start(async () => {
      const r = await runSyncAllAction();
      if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
      else setStarted(true);
      setData(await syncOverviewAction());
    });

  // The steps "Sync all" runs (the reviews come with the Ticket-Lage).
  const steps = data?.steps.filter((s) => !["relations", "mailtodos", "autoactions", "boardlage", "knowledgerel", "notetodos", "noterelations"].includes(s.key)) ?? [];
  const failed = steps.filter((s) => s.lastOk === false);
  const finished = started && !running;

  return (
    <section className="card space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" disabled={pending} onClick={() => start(async () => void (await stopSyncAllAction()))}>
            Abbrechen
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !data} onClick={go}>
            {finished ? "Noch einmal" : "Alles holen und auswerten"}
          </button>
        )}
        <span className="text-zinc-500">
          {running ? "Läuft — das erste Mal dauert es (alles wird zum ersten Mal gelesen)." : finished ? (failed.length ? `Fertig — ${failed.length} mit Fehler.` : "Fertig.") : "Jeder Sync nacheinander, zuletzt die Ticket-Lage: die erste Auswertung."}
        </span>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {steps.map((s) => {
          const now = data?.all.step === s.key || s.running;
          return (
            <li key={s.key} className={`flex items-start gap-2.5 py-1.5 ${now ? "font-medium" : ""}`}>
              <span className="w-4 shrink-0 text-center" aria-hidden>
                {now ? <span className="inline-block size-2.5 animate-pulse rounded-full bg-indigo-500" /> : s.lastOk === true ? <span className="text-emerald-600">✓</span> : s.lastOk === false ? <span className="text-red-600">✗</span> : <span className="text-zinc-300">·</span>}
              </span>
              <span className="w-32 shrink-0">{s.label}</span>
              <span className={`min-w-0 flex-1 truncate text-xs ${s.lastOk === false ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`} title={s.lastMessage ?? undefined}>
                {now ? "läuft …" : (s.lastMessage ?? "noch nicht gelesen")}
              </span>
            </li>
          );
        })}
      </ul>
      {finished && failed.length > 0 && (
        <p className="text-xs text-zinc-500">
          Fehlt eine Anmeldung?{" "}
          <Link href="/setup?step=logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Zurück zu den Anmeldungen
          </Link>
          , dann noch einmal.
        </p>
      )}
      {finished && (
        <div className="flex justify-end">
          <Link href={next} className="btn btn-primary btn-sm">
            Weiter: Fertig
          </Link>
        </div>
      )}
    </section>
  );
}
