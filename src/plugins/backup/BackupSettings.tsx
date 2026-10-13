"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { rich } from "@/lib/i18n/rich";
import { importConfigAction, restoreBackupAction, runBackupAction, saveBackupSettingsAction, uploadBackupAction } from "@/plugins/backup/server-actions";
import { pickFolderAction } from "@/app/actions";
import type { BackupFile, BackupSettingsView } from "./backup";
import { toast } from "@/components/Toaster";
import { formatDayTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

const intervals = (t: T) =>
  [
    [1, t("hourly")],
    [6, t("every 6 hours")],
    [12, t("every 12 hours")],
    [24, t("daily")],
    [168, t("weekly")],
  ] as const;

const when = (iso: string) => formatDayTime(iso, { year: true });
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const tierLabels = (t: T) => ({ daily: t("daily"), weekly: t("weekly"), monthly: t("monthly"), manual: t("by hand") });

/** Once Zeff is back after the restart: the page anew. */
async function reloadWhenBack() {
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("/favicon.ico", { cache: "no-store" });
      if (r.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** One backup in the list: restored on a second, explicit click — with its password if it's another one. */
function BackupRow({ b, hasPassword }: { b: BackupFile; hasPassword: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState<"restore" | "config" | null>(null);
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [restarting, setRestarting] = useState(false);
  const restore = () =>
    start(async () => {
      const r = await restoreBackupAction(b.name, password || undefined);
      if (!r?.ok) {
        toast(r?.error ?? t("Restoring didn't work."), { tone: "error" });
        return;
      }
      setRestarting(true);
      toast(r.message ?? t("Restoring …"), { tone: "ok" });
      void reloadWhenBack();
    });
  const takeConfig = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("backup", b.name);
      if (password) fd.set("password", password);
      const r = await importConfigAction(fd);
      toast(r?.ok ? (r.message ?? t("Taken over.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
      if (r?.ok) {
        setOpen(null);
        router.refresh();
      }
    });
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-xs">{b.name}</span>
        <span className="text-xs text-zinc-500">{when(b.at)}</span>
        <span className="text-xs text-zinc-500">{mb(b.size)}</span>
        <span className="text-xs" title={b.encrypted ? t("AES-256 encrypted") : t("Not encrypted")}>
          {b.encrypted === null ? "?" : b.encrypted ? t("🔒 encrypted") : t("open")}
        </span>
        <span className="flex gap-1">
          {b.tiers.map((tier) => (
            <span key={tier} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {tierLabels(t)[tier]}
            </span>
          ))}
          {!b.tiers.length && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400" title={t("No longer counts in any tier — the next backup deletes it")}>
              {t("goes next")}
            </span>
          )}
          {b.config && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" title={t("With a configuration ZIP (settings, plugins, repos …)")}>
              {t("+ configuration")}
            </span>
          )}
        </span>
        <span className="ml-auto flex gap-2">
          {b.config && (
            <button type="button" className="btn btn-sm" onClick={() => setOpen(open === "config" ? null : "config")} disabled={restarting}>
              {t("Take over configuration …")}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setOpen(open === "restore" ? null : "restore")} disabled={restarting}>
            {t("Restore …")}
          </button>
        </span>
      </div>
      {open === "config" && (
        <div className="mt-2 space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="text-indigo-900 dark:text-indigo-100">
            {t("Takes the settings and configuration of {when} into this account — AI backends, LLM instructions, installed plugins, repos, boards, report rules, working hours. The data stays as it is.", { when: when(b.at) })}
          </p>
          {b.encrypted && (
            <input
              type="password"
              className="input max-w-xs text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? t("Password (empty: the saved one)") : t("The backup's password")}
              autoComplete="off"
              aria-label={t("The configuration's password")}
            />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={takeConfig}>
              {pending ? t("Taking over …") : t("Yes, take over")}
            </button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setOpen(null)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {open === "restore" && (
        <div className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
          <p className="text-red-900 dark:text-red-100">
            {rich(
              t(
                "Replaces <b>all</b> data of this account with the state of {when}. The current state is backed up automatically first; Zeff restarts in the process.",
                { when: when(b.at) },
              ),
              { b: (s) => <strong>{s}</strong> },
            )}
          </p>
          {b.encrypted && (
            <input
              type="password"
              className="input max-w-xs text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? t("Password (empty: the saved one)") : t("The backup's password")}
              autoComplete="off"
              aria-label={t("The backup's password")}
            />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm bg-red-600 text-white hover:bg-red-700" disabled={pending || restarting} onClick={restore}>
              {restarting ? t("Zeff is restarting …") : pending ? t("Checking …") : t("Yes, restore")}
            </button>
            <button type="button" className="btn btn-sm" disabled={pending || restarting} onClick={() => setOpen(null)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Backups (Settings): on/off, how often, how many kept, where, the ZIP's password — the last one,
 * a backup now, and the backups there to restore (or one uploaded from elsewhere).
 */
export function BackupSettings({ s, backups }: { s: BackupSettingsView; backups: BackupFile[] }) {
  const t = useT();
  const router = useRouter();
  const [enabled, setEnabled] = useState(s.enabled);
  const [everyHours, setEveryHours] = useState(s.everyHours);
  const [keepDaily, setKeepDaily] = useState(s.keepDaily);
  const [keepWeekly, setKeepWeekly] = useState(s.keepWeekly);
  const [keepMonthly, setKeepMonthly] = useState(s.keepMonthly);
  const [config, setConfig] = useState(s.config);
  const [configPassword, setConfigPassword] = useState("");
  const configFile = useRef<HTMLInputElement>(null);
  const [dir, setDir] = useState(s.dir);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const done = (r: { ok: boolean; error?: string; message?: string } | null) => {
    toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
    router.refresh();
  };
  // What's typed here, saved (the folder picked, too) — "Back up now" saves it first.
  const dirty = enabled !== s.enabled || everyHours !== s.everyHours || keepDaily !== s.keepDaily || keepWeekly !== s.keepWeekly || keepMonthly !== s.keepMonthly || config !== s.config || dir !== s.dir || !!password || clearPassword;
  const persist = async (over: { dir?: string } = {}) => {
    const r = await saveBackupSettingsAction({ enabled, everyHours, keepDaily, keepWeekly, keepMonthly, config, dir: over.dir ?? dir, password: password || undefined, clearPassword });
    if (r?.ok) {
      setPassword("");
      setClearPassword(false);
    }
    return r;
  };
  const save = () => start(async () => done(await persist()));
  const backupNow = () =>
    start(async () => {
      if (dirty) {
        const r = await persist();
        if (!r?.ok) return done(r);
      }
      done(await runBackupAction());
    });
  const upload = () =>
    start(async () => {
      const f = file.current?.files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.set("file", f);
      const r = await uploadBackupAction(fd);
      if (file.current) file.current.value = "";
      done(r?.ok ? { ok: true, message: t("Uploaded: {name} — restore it below.", { name: r.message }) } : r);
    });
  const importConfig = () =>
    start(async () => {
      const f = configFile.current?.files?.[0];
      if (!f) return;
      if (!confirmAction(t("Take the settings and configuration from {file} into this account? The data stays.", { file: f.name }))) return;
      const fd = new FormData();
      fd.set("file", f);
      if (configPassword) fd.set("password", configPassword);
      const r = await importConfigAction(fd);
      if (r?.ok) {
        if (configFile.current) configFile.current.value = "";
        setConfigPassword("");
      }
      done(r);
    });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-indigo-600" />
          {t("Back up automatically")}
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={config} onChange={(e) => setConfig(e.target.checked)} className="mt-0.5 size-4 accent-indigo-600" />
          <span>
            {t("Settings & configuration also as a config ZIP of their own")}
            <span className="block text-xs text-zinc-400">
              {t("Beside every backup: AI backends, LLM instructions, installed plugins, repos, boards, report rules, working hours — importable into any account, without the data.")}
            </span>
          </span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-500">{t("How often")}</span>
          <select className="input" value={everyHours} onChange={(e) => setEveryHours(Number(e.target.value))} disabled={!enabled}>
            {intervals(t).map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
            {!intervals(t).some(([h]) => h === everyHours) && <option value={everyHours}>{t("every {n} hours", { n: everyHours })}</option>}
          </select>
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="text-zinc-500">{t("Keep — the newest of the last …")}</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                [t("days"), keepDaily, setKeepDaily, 365],
                [t("weeks"), keepWeekly, setKeepWeekly, 260],
                [t("months"), keepMonthly, setKeepMonthly, 240],
              ] as const
            ).map(([label, value, set, max]) => (
              <label key={label} className="flex items-center gap-1.5">
                <input type="number" min={0} max={max} className="input w-20" value={value} onChange={(e) => set(Number(e.target.value))} aria-label={t("Backups: last {unit}", { unit: label })} />
                <span className="text-zinc-500">{label}</span>
              </label>
            ))}
          </div>
          <span className="block text-xs text-zinc-400">{t("One backup can count as daily, weekly and monthly at once; the next backup deletes whatever is none of them.")}</span>
        </fieldset>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-500">{t("Folder (empty: in the data folder)")}</span>
          <span className="flex gap-2">
            <input className="input font-mono text-xs" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={s.resolvedDir} />
            <button
              type="button"
              className="btn btn-sm shrink-0"
              disabled={picking}
              onClick={async () => {
                setPicking(true);
                const r = await pickFolderAction(dir || s.resolvedDir);
                setPicking(false);
                if (!r.ok) toast(r.error ?? t("The dialog didn't open."), { tone: "error" });
                else if (r.path) {
                  // Picked: saved at once (the backups there so far move along).
                  setDir(r.path);
                  start(async () => done(await persist({ dir: r.path! })));
                }
              }}
              title={t("Choose the folder in the Windows dialog (it opens on this computer)")}
            >
              {picking ? t("Dialog open …") : t("Browse …")}
            </button>
            {dir && (
              <button type="button" className="btn btn-sm shrink-0" onClick={() => setDir("")} title={t("Back to the data folder")}>
                {t("Default")}
              </button>
            )}
          </span>
          <span className="block text-xs text-zinc-400">{t("E.g. a OneDrive folder, so the backups aren't only on this computer. Now: {dir}", { dir: s.resolvedDir })}</span>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-500">{t("Password for the ZIP file (AES-256)")}</span>
          <input
            type="password"
            className="input max-w-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={s.hasPassword ? t("set — leave empty to keep it") : t("none — the backups are not encrypted")}
            autoComplete="new-password"
            disabled={clearPassword}
          />
          <span className="block text-xs text-zinc-400">
            {rich(
              t(
                "Open with 7-Zip or WinZip (Windows Explorer can't open AES ZIPs). For Windows' <code>tar</code> use only characters without umlauts. It's stored in Zeff's database — if the folder is elsewhere, it protects the copy there.",
              ),
              { code: (s) => <code className="code">{s}</code> },
            )}
          </span>
          {s.hasPassword && (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
              {t("Remove the password (future backups not encrypted)")}
            </label>
          )}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={save}>
          {t("Save")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={backupNow} title={dirty ? t("Saves the changes, then backs up") : undefined}>
          {pending ? "…" : t("Back up now")}
        </button>
        {dirty && !pending && <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{t("unsaved")}</span>}
        {!s.hasPassword && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t("No password set — backups are saved unencrypted.")}</span>}
      </div>
      <p className="text-xs text-zinc-500">
        {t("Last backup:")}{" "}
        {s.lastAt ? (
          <>
            {s.lastOk === false ? <span className="text-red-600 dark:text-red-400">✗</span> : <span className="text-emerald-600 dark:text-emerald-400">✓</span>} {when(s.lastAt)} — {s.lastResult}
          </>
        ) : (
          t("none yet")
        )}
      </p>
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase">{t("Backups ({n})", { n: backups.length })}</h3>
        {backups.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {backups.map((b) => (
              <BackupRow key={b.name} b={b} hasPassword={s.hasPassword} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-zinc-500">{t("None yet.")}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input ref={file} type="file" accept=".zip,application/zip" className="text-xs" aria-label={t("Upload a backup file")} />
          <button type="button" className="btn btn-sm" disabled={pending} onClick={upload}>
            {t("Upload")}
          </button>
          <span className="text-xs text-zinc-400">{t("a backup from elsewhere (then restore it above)")}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input ref={configFile} type="file" accept=".zip,application/zip" className="text-xs" aria-label={t("Import a config ZIP")} />
          <input
            type="password"
            className="input w-48 text-xs"
            value={configPassword}
            onChange={(e) => setConfigPassword(e.target.value)}
            placeholder={s.hasPassword ? t("Password (empty: the saved one)") : t("Password (if encrypted)")}
            autoComplete="off"
            aria-label={t("The config ZIP's password")}
          />
          <button type="button" className="btn btn-sm" disabled={pending} onClick={importConfig}>
            {t("Import configuration")}
          </button>
          <span className="text-xs text-zinc-400">{t("a config ZIP (zeff-…config-….zip) — from another account too")}</span>
        </div>
      </div>
    </div>
  );
}
