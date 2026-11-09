"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";

type Dangling = { id: number; ref: string; why: string };

/**
 * "Kill all dangling sessions": the runs that count as running but aren't working (a session waiting for you or left
 * over from before a restart, a worker whose process is gone) — they hold workers, so new ones wait. Shown only while
 * there are some; `waiting`: this page's own message waits for a worker (said first, the button below it).
 */
export function DanglingSessions({ waiting = false, className = "" }: { waiting?: boolean; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<Dangling[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/work/dangling")
        .then((r) => (r.ok ? r.json() : { dangling: [] }))
        .then((d: { dangling: Dangling[] }) => alive && setList(d.dangling ?? []))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!waiting && !list.length) return null;
  const kill = () =>
    start(async () => {
      type Res = { ok: boolean; ended?: number[]; error?: string };
      const r: Res = await postJson<Res>("/api/work/dangling").catch((e: unknown) => ({ ok: false, error: String(e) }));
      if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
      toast(t("{n} sessions ended — the workers are free.", { n: r.ended?.length ?? 0 }), { tone: "ok" });
      setList([]);
      router.refresh();
    });
  return (
    <section role="status" className={`card space-y-2 border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40 ${className}`}>
      {waiting && <p className="font-medium">{t("Waiting for a free worker — all of them are taken right now.")}</p>}
      {list.length > 0 && (
        <>
          <p className="text-zinc-700 dark:text-zinc-300">
            {t("{n} sessions count as running but aren't working:", { n: list.length })}{" "}
            {list.map((d) => `${d.ref} (${d.why})`).join(", ")}
          </p>
          <div>
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={kill}>
              {pending ? t("Ending …") : t("Kill all dangling sessions")}
            </button>
          </div>
        </>
      )}
      {waiting && !list.length && <p className="text-zinc-700 dark:text-zinc-300">{t("It starts as soon as one is free. More workers at once: Settings → Code.")}</p>}
    </section>
  );
}
