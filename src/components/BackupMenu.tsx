"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useDismiss } from "@/components/useDismiss";
import { useT } from "./I18nProvider";
import { BackupIcon } from "./icons";

/**
 * The header's Backup menu: a button opening a small flyout (like the browser's downloads) —
 * "Back up now" makes a fresh backup on the server, then the file is loaded to this device with
 * a progress bar and saved (on a phone: into its downloads, or the share sheet → Files).
 */

type Job =
  | { phase: "making" }
  | { phase: "loading"; name: string; got: number; total: number; encrypted: boolean | null }
  | { phase: "done"; name: string; size: number; encrypted: boolean | null }
  | { phase: "error"; error: string };

const mb = (n: number) => `${(n / 1048576).toLocaleString(undefined, { maximumFractionDigits: n < 10485760 ? 2 : 1 })} MB`;

/** The browser saves a file it holds in memory (a link with `download`). */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function BackupMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [canShare, setCanShare] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const kept = useRef<{ blob: Blob; name: string } | null>(null);
  const busy = job?.phase === "making" || job?.phase === "loading";
  const percent = job?.phase === "loading" && job.total > 0 ? Math.min(100, Math.round((job.got / job.total) * 100)) : null;
  useDismiss(root, open, () => setOpen(false), {
    onEscape: () => {
      setOpen(false);
      trigger.current?.focus();
    },
  });

  const run = async () => {
    if (busy) return;
    kept.current = null;
    setJob({ phase: "making" });
    try {
      const made = await fetch("/api/backup", { method: "POST" }).then((r) => r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })));
      if (!made.ok) throw new Error(made.error ?? t("The backup failed."));
      const name = String(made.name);
      const encrypted = (made.encrypted ?? null) as boolean | null;
      setJob({ phase: "loading", name, got: 0, total: Number(made.size) || 0, encrypted });
      const res = await fetch(`/api/backup?name=${encodeURIComponent(name)}`);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || Number(made.size) || 0;
      const reader = res.body.getReader();
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value as Uint8Array<ArrayBuffer>);
        got += value.length;
        setJob({ phase: "loading", name, got, total, encrypted });
      }
      const blob = new Blob(parts, { type: "application/zip" });
      kept.current = { blob, name };
      saveBlob(blob, name);
      try {
        setCanShare(!!navigator.canShare?.({ files: [new File([blob], name, { type: "application/zip" })] }));
      } catch {
        setCanShare(false);
      }
      setJob({ phase: "done", name, size: got, encrypted });
    } catch (e) {
      setJob({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** The share sheet (phones: "Save to Files", messengers, cloud) — where the browser has one for files. */
  const share = async () => {
    const k = kept.current;
    if (!k) return;
    const file = new File([k.blob], k.name, { type: "application/zip" });
    try {
      await navigator.share({ files: [file], title: k.name });
    } catch {
      // closed without choosing
    }
  };
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const label = busy ? (percent !== null ? t("Backup — {percent}% loaded", { percent }) : t("Backup — being made…")) : t("Backup");
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="backup-menu"
        onClick={() => setOpen(!open)}
        title={label}
        aria-label={label}
      >
        {job?.phase === "loading" && percent !== null ? (
          <svg viewBox="0 0 18 18" className="size-5 -rotate-90" aria-hidden>
            <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-zinc-200 dark:stroke-zinc-700" />
            <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} className="stroke-indigo-500 transition-[stroke-dashoffset] duration-300" />
          </svg>
        ) : busy ? (
          <Spinner tone="indigo" label={t("Backup — being made…")} className="block size-[18px]" />
        ) : (
          <BackupIcon className="size-5" />
        )}
        <span className="hidden lg:inline">{t("Backup")}</span>
        {job?.phase === "done" && !open && <span className="absolute top-1.5 right-1 size-1.5 rounded-full bg-emerald-500" aria-hidden />}
        {job?.phase === "error" && !open && <span className="absolute top-1.5 right-1 size-1.5 rounded-full bg-red-500" aria-hidden />}
      </button>
      {open && (
        <div id="backup-menu" role="dialog" aria-label={t("Backup")} className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>
              <BackupIcon className="size-4" /> {t("Back up now")}
            </button>
            <span className="truncate text-xs text-zinc-500">{t("A fresh copy, saved on this device")}</span>
          </div>
          {!job && <p className="px-3 py-3 text-sm text-zinc-500">{t("Makes a fresh backup of all your data and saves it here — on a phone in the downloads.")}</p>}
          {job && (
            <div className="px-3 py-3 text-sm" aria-live="polite">
              {job.phase === "error" ? (
                <p className="text-red-600 dark:text-red-400">{job.error}</p>
              ) : (
                <>
                  <div className="truncate font-medium" title={job.phase === "making" ? undefined : job.name}>
                    {job.phase === "making" ? t("Making the backup…") : job.name}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.phase === "done" ? 100 : (percent ?? undefined)}>
                    <div
                      className={`h-full rounded-full ${job.phase === "done" ? "bg-emerald-500" : "bg-indigo-500"} ${job.phase === "making" || (job.phase === "loading" && percent === null) ? "w-1/3 animate-pulse" : "transition-[width] duration-300"}`}
                      style={job.phase === "done" ? { width: "100%" } : job.phase === "loading" && percent !== null ? { width: `${percent}%` } : undefined}
                    />
                  </div>
                  <div className="mt-1.5 text-xs text-zinc-500">
                    {job.phase === "making" && t("Packing the database and files …")}
                    {job.phase === "loading" && (job.total > 0 ? t("{got} of {total} · {percent}%", { got: mb(job.got), total: mb(job.total), percent: percent ?? 0 }) : mb(job.got))}
                    {job.phase === "done" && <span className="text-emerald-600 dark:text-emerald-400">✓ {t("Saved — {size}", { size: mb(job.size) })}</span>}
                  </div>
                  {job.phase !== "making" && job.encrypted === false && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("No backup password is set — this file is not encrypted. Set one under Settings → Backups.")}</p>}
                  {job.phase === "done" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => kept.current && saveBlob(kept.current.blob, kept.current.name)}>
                        {t("Save again")}
                      </button>
                      {canShare && (
                        <button type="button" className="btn btn-sm" onClick={() => void share()}>
                          {t("Share / save to Files…")}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
