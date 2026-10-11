"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { pollDeviceCodeAction, startDeviceCodeAction, type DeviceCodeInfo } from "@/plugins/outlook-calendar/server-actions";

type Phase = "idle" | "starting" | "waiting" | "done" | "error";

export function DeviceCodeConnect() {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<DeviceCodeInfo | null>(null);
  const [error, setError] = useState<string>();
  const stopped = useRef(false);

  // Stop polling if the component unmounts (e.g. the page refreshes after success).
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  async function start() {
    setPhase("starting");
    setError(undefined);
    const r = await startDeviceCodeAction();
    if (!r.ok) {
      setPhase("error");
      setError(r.error);
      return;
    }
    setInfo(r.info);
    setPhase("waiting");
    window.open(r.info.verificationUri, "_blank", "noopener,noreferrer");

    const intervalMs = Math.max(3, r.info.interval) * 1000;
    while (!stopped.current && Date.now() < r.info.expiresAt) {
      await new Promise((res) => setTimeout(res, intervalMs));
      if (stopped.current) return;
      const poll = await pollDeviceCodeAction();
      if (poll.status === "done") {
        setPhase("done");
        router.refresh();
        return;
      }
      if (poll.status === "expired") {
        setPhase("error");
        setError(t("The code expired before sign-in completed. Please try again."));
        return;
      }
      if (poll.status === "error") {
        setPhase("error");
        setError(poll.message ?? t("Sign-in failed."));
        return;
      }
      // "pending" → keep polling
    }
  }

  if (phase === "waiting" && info) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          {t("A Microsoft sign-in page should have opened. Enter this code there, sign in, and allow read access to your calendar:")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 font-mono text-2xl tracking-[0.3em] dark:border-zinc-700 dark:bg-zinc-950">
            {info.userCode}
          </span>
          <a className="btn" href={info.verificationUri} target="_blank" rel="noreferrer">
            {t("Open sign-in page")}
          </a>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigator.clipboard?.writeText(info.userCode)}
          >
            {t("Copy code")}
          </button>
        </div>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block size-2 animate-pulse rounded-full bg-indigo-500" />
          {t("Waiting for you to finish signing in…")}
        </p>
      </div>
    );
  }

  if (phase === "done") {
    return <p className="alert-ok">{t("Connected. Loading your calendar…")}</p>;
  }

  return (
    <div className="space-y-3">
      {phase === "error" && <p className="alert-error whitespace-pre-line">{error}</p>}
      <button type="button" className="btn btn-primary" onClick={start} disabled={phase === "starting"}>
        {phase === "starting" ? t("Preparing…") : phase === "error" ? t("Try again") : t("Connect Outlook")}
      </button>
    </div>
  );
}
