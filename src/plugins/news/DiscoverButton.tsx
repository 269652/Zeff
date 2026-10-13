"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { DiscoverStatus } from "./discover-job";
import { discoverStatusAction, startDiscoverAction } from "./server-actions";

/**
 * "Discover": from the written description of your taste Zeff plans searches, finds new sources and fetches them, and matches
 * everything unread against the description — in the background, with its progress shown here; when it is through the
 * Discover view opens with the matches.
 */
export function DiscoverButton() {
  const t = useT();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<DiscoverStatus | null>(null);
  const running = !!status?.running;
  const was = useRef(false);

  useEffect(() => {
    let live = true;
    const ask = async () => {
      const st = await discoverStatusAction().catch(() => null);
      if (!live || !st) return;
      setStatus(st);
      if (was.current && !st.running) {
        toast(st.message || t("Done."));
        if (st.matched > 0) window.location.assign("/news?view=discover");
      }
      was.current = st.running;
    };
    void ask();
    const timer = running ? setInterval(ask, 1500) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [running, t]);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="btn btn-sm w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
        disabled={pending || running}
        onClick={() =>
          start(async () => {
            const r = await startDiscoverAction();
            if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
            was.current = true;
            setStatus(r.status ?? null);
          })
        }
        title={t("Uses the written description of what you like: searches for new sources and content, then matches everything unread against it")}
      >
        ✨ {running ? t("Discovering …") : t("Discover")}
      </button>
      {running && status && (
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          {status.phase}
          {(status.web > 0 || status.sourcesAdded > 0) && <span className="text-zinc-500"> · {t("{web} found on the web, {n} new sources", { web: status.web, n: status.sourcesAdded })}</span>}
        </p>
      )}
      {!running && status?.message && status.finishedAt && <p className="text-xs text-zinc-500">{status.message}</p>}
    </div>
  );
}
