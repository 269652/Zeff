"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { aiLoginAction, aiLoginStatusAction } from "@/app/actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "./Toaster";

type Status = { provider: string; state: string; url: string | null; out: string; signedIn: boolean | null };

/**
 * An AI CLI's sign-in on the This PC list: "Sign in" starts the CLI's own login (the browser opens, you sign in
 * there); this polls it and says when it is through. Shows the address when the browser didn't open by itself.
 */
export function AiSignIn({ provider }: { provider: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);
  const [watch, setWatch] = useState(true);
  const running = status?.state === "running";

  useEffect(() => {
    let live = true;
    const poll = async () => {
      const mine = (await aiLoginStatusAction()).find((s) => s.provider === provider) ?? null;
      if (!live) return;
      setStatus((prev) => {
        if (prev?.state === "running" && mine?.state === "done") toast(t("Signed in."));
        return mine;
      });
      if (mine && mine.state !== "running") setWatch(false);
      if (mine?.state === "done") router.refresh();
    };
    void poll();
    const timer = watch ? setInterval(poll, 3000) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [provider, watch, router, t]);

  if (status?.signedIn === true && !running) return <span className="shrink-0 text-xs text-emerald-600">✓ {t("signed in")}</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending || running}
        onClick={() =>
          start(async () => {
            const r = await aiLoginAction(provider);
            if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
            else {
              toast(r.message ?? t("Signing in …"));
              setWatch(true);
            }
          })
        }
      >
        {running ? t("Waiting for the sign-in …") : t("Sign in")}
      </button>
      {running && status?.url && (
        <a href={status.url} target="_blank" rel="noreferrer" className="max-w-[40ch] truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Browser didn't open? Open the sign-in page")}
        </a>
      )}
      {status?.state === "failed" && <span className="max-w-[40ch] text-xs text-red-600 dark:text-red-400">{status.out}</span>}
    </span>
  );
}
