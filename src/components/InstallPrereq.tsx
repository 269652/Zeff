"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { installPrerequisiteAction, installStatusAction } from "@/app/actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "./Toaster";

type Status = { id: string; state: string; out: string };

/**
 * "Install" for a missing program (id) — or for every installable missing one (id "all"). The install runs
 * on the server; this polls it and refreshes the list when it's through.
 */
export function InstallPrereq({ id, label }: { id: string; label?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Status[]>([]);
  const [started, setStarted] = useState(false);
  const mine = id === "all" ? status : status.filter((s) => s.id === id);
  const running = mine.some((s) => s.state === "running");
  const failed = mine.filter((s) => s.state === "failed");

  useEffect(() => {
    if (!started) return;
    let live = true;
    const poll = async () => {
      const s = await installStatusAction();
      if (!live) return;
      setStatus(s);
      const now = id === "all" ? s : s.filter((x) => x.id === id);
      if (now.length && !now.some((x) => x.state === "running")) {
        setStarted(false);
        router.refresh();
        if (!now.some((x) => x.state === "failed")) toast(t("Installed. Restart Zeff if a program isn't found right away."));
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [started, id, router, t]);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={pending || running}
        onClick={() =>
          start(async () => {
            const r = await installPrerequisiteAction(id);
            if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
            else {
              toast(r.message ?? t("Installing …"));
              setStarted(true);
            }
          })
        }
      >
        {running || pending ? t("Installing …") : (label ?? t("Install"))}
      </button>
      {failed.map((f) => (
        <span key={f.id} className="max-w-[60ch] text-xs text-red-600 dark:text-red-400">
          {f.id}: {f.out}
        </span>
      ))}
    </span>
  );
}
