"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useT } from "@/components/I18nProvider";
import { Switch } from "@/components/Switch";
import { toast } from "@/components/Toaster";
import { qrMatrix, qrPath } from "@/lib/girocode";
import type { TailscaleState } from "@/lib/tailscale";
import { setMobileAccessAction, setMobilePasswordAction } from "./actions";

/** The steps, each once it is due: Tailscale here, signed in; a password; on — then the address as a code to scan with the phone. */
export function MobileAccess({ state, hasPassword }: { state: TailscaleState; hasPassword: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const done = (r: { ok: boolean; error?: string; message?: string } | null) => {
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
    router.refresh();
  };
  const qr = useMemo(() => (state.url ? qrMatrix(state.url) : null), [state.url]);
  const step = (n: number, title: string, ok: boolean) => (
    <h2 className="flex items-center gap-2 text-sm font-semibold">
      <span className={`inline-flex size-5 items-center justify-center rounded-full text-xs ${ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>{ok ? "✓" : n}</span>
      {title}
    </h2>
  );
  return (
    <div className="min-w-0 flex-1 space-y-6">
      <section className="card space-y-2 p-4">
        {step(1, t("Tailscale on this computer and your phone"), state.running)}
        {!state.installed ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("Install Tailscale here and on your phone and sign in to both with the same account:")}{" "}
            <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
              tailscale.com/download
            </a>
          </p>
        ) : !state.running ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">{state.error ?? t("Tailscale is installed but not signed in or not connected — open it and sign in.")}</p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("Connected as {host}.", { host: state.host ?? "?" })}</p>
        )}
      </section>

      <section className="card space-y-2 p-4">
        {step(2, t("A password for the phone"), hasPassword)}
        <p className="text-sm text-zinc-500">{t("Asked once on each phone (a session of 30 days). This computer's own browser doesn't need it.")}</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await setMobilePasswordAction(password);
              if (r?.ok) setPassword("");
              done(r);
            });
          }}
        >
          <input type="password" className="input w-64" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={hasPassword ? t("New password") : t("Password (at least 12 characters)")} aria-label={t("Password")} />
          <button type="submit" className="btn btn-sm" disabled={pending || password.length < 12}>
            {hasPassword ? t("Change") : t("Set")}
          </button>
        </form>
      </section>

      <section className="card space-y-3 p-4">
        {step(3, t("Zeff in your tailnet"), !!state.url)}
        <Switch checked={!!state.url} disabled={pending || !state.running} onChange={(on) => start(async () => done(await setMobileAccessAction(on)))} labelOn={t("On")} labelOff={t("Off")} label={t("Zeff in your tailnet")} />
        {state.url && qr && (
          <div className="flex flex-wrap items-center gap-4">
            <svg viewBox={`0 0 ${qr.length + 8} ${qr.length + 8}`} width={160} height={160} shapeRendering="crispEdges" className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700" role="img" aria-label={t("Code to scan with your phone")}>
              <rect width={qr.length + 8} height={qr.length + 8} fill="#fff" />
              <path d={qrPath(qr)} fill="#000" />
            </svg>
            <div className="space-y-2 text-sm">
              <p className="text-zinc-600 dark:text-zinc-400">{t("Scan it with your phone (Tailscale on), sign in with the password — then “Add to Home Screen”.")}</p>
              <p className="flex items-center gap-2">
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{state.url}</code>
                <CopyButton text={state.url} />
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
