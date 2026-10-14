"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { RefreshStatus } from "./refresh";
import { newsDigestAction, newsStartAction, refreshStatusAction, startRefreshAction } from "./server-actions";

/**
 * "Refresh": fetches every source and, if that leaves fewer than 200 unseen cards, adds sources (the catalog first, then the
 * internet search) and fetches them — in the background, with its progress shown here. When it is through the feed reloads with
 * the new cards. Also "Overview now" when the AI overview is on.
 */
export function NewsRefreshButtons({ digest }: { digest: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const running = !!status?.running;
  const wasRunning = useRef(false);

  // Where the refresh is: asked when the page opens (one may be running) and now and then after (one may be started elsewhere on
  // this page: the empty page's Start), every second and a half while it runs.
  useEffect(() => {
    let live = true;
    const ask = async () => {
      const st = await refreshStatusAction().catch(() => null);
      if (!live || !st) return;
      setStatus(st);
      if (wasRunning.current && !st.running) {
        toast(st.message || t("Done."));
        window.location.reload();
      }
      wasRunning.current = st.running;
    };
    void ask();
    const timer = setInterval(ask, running ? 1500 : 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [running, t]);

  const refresh = () =>
    start(async () => {
      const r = await startRefreshAction();
      if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
      wasRunning.current = true;
      setStatus(r.status ?? null);
    });
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      toast(r.ok ? (r.message ?? t("Done.")) : (r.error ?? t("Didn't work.")), { tone: r.ok ? "ok" : "error" });
      router.refresh();
    });
  const pct = status ? Math.min(100, Math.round((status.unseen / Math.max(1, status.target)) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending || running} onClick={refresh} title={t("Fetches every source; if there are fewer than 200 unseen cards, adds sources until there are")}>
          {running ? t("Refreshing …") : t("Refresh")}
        </button>
        {digest && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(newsDigestAction)} title={t("The AI sums up the best unread items")}>
            {t("Overview now")}
          </button>
        )}
      </div>
      {running && status && (
        <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
          <p>{status.phase}</p>
          <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-zinc-500">
            {t("{unseen} of {target} unseen cards", { unseen: status.unseen, target: status.target })}
            {status.sourcesAdded > 0 && ` · ${t("{n} sources added", { n: status.sourcesAdded })}`}
          </p>
        </div>
      )}
      {!running && status?.message && status.finishedAt && <p className="text-xs text-zinc-500">{status.message}</p>}
    </div>
  );
}

/**
 * The empty News page: one click starts the fetch (with the starter pack when there are no sources yet), and the page shows it
 * going — what it is doing, how many cards there are so far — and shows the cards as soon as the first ones are in (the fetch
 * goes on; the sidebar's refresh bar reloads the page when it is through). Also picks up a fetch that is running already.
 */
export function NewsFetching({ starter, children }: { starter: boolean; /** What the page says while nothing is being fetched (hidden while it is). */ children?: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [pending, start] = useTransition();
  const revealed = useRef(false);
  const running = !!status?.running;

  useEffect(() => {
    let live = true;
    const ask = async () => {
      const st = await refreshStatusAction().catch(() => null);
      if (!live || !st) return;
      setStatus(st);
      // The first cards are in: this page has something to show now.
      if (st.newItems > 0 && !revealed.current) {
        revealed.current = true;
        router.refresh();
      }
    };
    void ask();
    const timer = setInterval(ask, running ? 1500 : 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [running, router]);

  const go = () =>
    start(async () => {
      const r = await (starter ? newsStartAction() : startRefreshAction());
      if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
      setStatus(r.status ?? null);
    });
  const pct = status ? Math.min(100, Math.round((status.unseen / Math.max(1, status.target)) * 100)) : 0;
  return (
    <span className="mb-3 block space-y-2">
      {running && status ? (
        <span className="block space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300" role="status">
          <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{t("Getting your news …")}</span>
          <span className="block">{status.phase || t("Fetching your sources …")}</span>
          <span className="block h-1.5 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
          </span>
          <span className="block text-zinc-500">
            {status.newItems > 0 ? t("{n} cards so far — they appear here in a moment", { n: status.newItems }) : t("Nothing yet — the first sources are still answering")}
          </span>
        </span>
      ) : (
        <>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={go}>
            {pending ? t("Starting …") : starter ? t("Start with the starter pack") : t("Fetch news now")}
          </button>
          {status?.message && status.finishedAt && <span className="block text-xs">{status.message}</span>}
          {children}
        </>
      )}
    </span>
  );
}
