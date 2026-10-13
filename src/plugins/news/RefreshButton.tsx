"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { useAction } from "@/components/useAction";
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

  // Where the refresh is: asked once when the page opens (one may be running), then every second and a half while it runs.
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
    const timer = running ? setInterval(ask, 1500) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
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

/** The empty News page: one click starts with the starter pack and fetches in the background. */
export function StartNews() {
  const t = useT();
  const { run, pending } = useAction({ done: t("Done."), fallback: t("Didn't work.") });
  return (
    <span className="mb-3 block">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending}
        onClick={() => void run(() => newsStartAction())}
      >
        {pending ? t("Starting …") : t("Start with the starter pack")}
      </button>
    </span>
  );
}
