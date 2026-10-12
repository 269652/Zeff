"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { rich } from "@/lib/i18n/rich";
import { runSyncAllAction, stopSyncAllAction, syncOverviewAction } from "@/app/actions";
import type { SyncOverview } from "@/lib/sync/shared";
import { useT } from "@/components/I18nProvider";
import { toast } from "./Toaster";

/**
 * The setup's data step: every sync, one after the other — the Ticket-Lage (the first review) last —
 * started with one click and followed live: which step runs, how each went.
 */
export function SetupDataRun({ next }: { next: string }) {
  const t = useT();
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
    const timer = setInterval(poll, running ? 2000 : 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [running]);

  const go = () =>
    start(async () => {
      const r = await runSyncAllAction();
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
      else setStarted(true);
      setData(await syncOverviewAction());
    });

  // The steps "Sync all" runs (the reviews come with the Ticket-Lage).
  const steps = data?.steps.filter((s) => !["relations", "mailtodos", "autoactions", "boardlage", "knowledgerel", "peoplenorm", "notetodos", "noterelations", "doctodos", "docrelations"].includes(s.key)) ?? [];
  const failed = steps.filter((s) => s.lastOk === false);
  const finished = started && !running;

  return (
    <section className="card space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" disabled={pending} onClick={() => start(async () => void (await stopSyncAllAction()))}>
            {t("Cancel")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !data} onClick={go}>
            {finished ? t("Once more") : t("Fetch everything and run the AI steps")}
          </button>
        )}
        <span className="text-zinc-500">
          {running
            ? t("Running — the first time takes a while (everything is read for the first time).")
            : finished
              ? failed.length
                ? t("Done — {n} with errors.", { n: failed.length })
                : t("Done.")
              : t("Every sync in turn, the briefing last: the first AI run.")}
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
                {now ? t("running…") : (s.lastMessage ?? t("not read yet"))}
              </span>
            </li>
          );
        })}
      </ul>
      {finished && failed.length > 0 && (
        <p className="text-xs text-zinc-500">
          {rich(t("A sign-in missing? <link>Back to the sign-ins</link>, then once more."), {
            link: (s) => (
              <Link href="/setup?step=logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
      )}
      {finished && (
        <div className="flex justify-end">
          <Link href={next} className="btn btn-primary btn-sm">
            {t("Next: done")}
          </Link>
        </div>
      )}
    </section>
  );
}
