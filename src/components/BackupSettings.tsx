"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { pickFolderAction, restoreBackupAction, runBackupAction, saveBackupSettingsAction, uploadBackupAction } from "@/app/actions";
import type { BackupFile, BackupSettingsView } from "@/lib/backup";
import { toast } from "./Toaster";

const INTERVALS = [
  [1, "stündlich"],
  [6, "alle 6 Stunden"],
  [12, "alle 12 Stunden"],
  [24, "täglich"],
  [168, "wöchentlich"],
] as const;

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const TIER_LABELS = { daily: "täglich", weekly: "wöchentlich", monthly: "monatlich", manual: "von Hand" } as const;

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
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [restarting, setRestarting] = useState(false);
  const restore = () =>
    start(async () => {
      const r = await restoreBackupAction(b.name, password || undefined);
      if (!r?.ok) {
        toast(r?.error ?? "Wiederherstellen ging nicht.", { tone: "error" });
        return;
      }
      setRestarting(true);
      toast(r.message ?? "Wird wiederhergestellt …", { tone: "ok" });
      void reloadWhenBack();
    });
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-xs">{b.name}</span>
        <span className="text-xs text-zinc-500">{when(b.at)}</span>
        <span className="text-xs text-zinc-500">{mb(b.size)}</span>
        <span className="text-xs" title={b.encrypted ? "AES-256-verschlüsselt" : "Nicht verschlüsselt"}>
          {b.encrypted === null ? "?" : b.encrypted ? "🔒 verschlüsselt" : "offen"}
        </span>
        <span className="flex gap-1">
          {b.tiers.map((t) => (
            <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {TIER_LABELS[t]}
            </span>
          ))}
          {!b.tiers.length && <span className="text-[11px] text-amber-700 dark:text-amber-400" title="Zählt in keine Stufe mehr — das nächste Backup löscht es">fällt weg</span>}
        </span>
        <button type="button" className="btn btn-sm ml-auto" onClick={() => setOpen(!open)} disabled={restarting}>
          Wiederherstellen …
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
          <p className="text-red-900 dark:text-red-100">
            Ersetzt <strong>alle</strong> Daten von Zeff durch den Stand vom {when(b.at)}. Der aktuelle Stand wird vorher automatisch gesichert; Zeff startet dabei neu.
          </p>
          {b.encrypted && (
            <input
              type="password"
              className="input max-w-xs text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? "Passwort (leer: das gespeicherte)" : "Passwort des Backups"}
              autoComplete="off"
              aria-label="Passwort des Backups"
            />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm bg-red-600 text-white hover:bg-red-700" disabled={pending || restarting} onClick={restore}>
              {restarting ? "Zeff startet neu …" : pending ? "Prüft …" : "Ja, wiederherstellen"}
            </button>
            <button type="button" className="btn btn-sm" disabled={pending || restarting} onClick={() => setOpen(false)}>
              Abbrechen
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
  const router = useRouter();
  const [enabled, setEnabled] = useState(s.enabled);
  const [everyHours, setEveryHours] = useState(s.everyHours);
  const [keepDaily, setKeepDaily] = useState(s.keepDaily);
  const [keepWeekly, setKeepWeekly] = useState(s.keepWeekly);
  const [keepMonthly, setKeepMonthly] = useState(s.keepMonthly);
  const [dir, setDir] = useState(s.dir);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const done = (r: { ok: boolean; error?: string; message?: string } | null) => {
    toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
    router.refresh();
  };
  // What's typed here, saved (the folder picked, too) — "Jetzt sichern" saves it first.
  const dirty = enabled !== s.enabled || everyHours !== s.everyHours || keepDaily !== s.keepDaily || keepWeekly !== s.keepWeekly || keepMonthly !== s.keepMonthly || dir !== s.dir || !!password || clearPassword;
  const persist = async (over: { dir?: string } = {}) => {
    const r = await saveBackupSettingsAction({ enabled, everyHours, keepDaily, keepWeekly, keepMonthly, dir: over.dir ?? dir, password: password || undefined, clearPassword });
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
      done(r?.ok ? { ok: true, message: `Hochgeladen: ${r.message} — unten wiederherstellen.` } : r);
    });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-indigo-600" />
          Automatisch sichern
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-500">Wie oft</span>
          <select className="input" value={everyHours} onChange={(e) => setEveryHours(Number(e.target.value))} disabled={!enabled}>
            {INTERVALS.map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
            {!INTERVALS.some(([h]) => h === everyHours) && <option value={everyHours}>alle {everyHours} Stunden</option>}
          </select>
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="text-zinc-500">Aufbewahren — das neueste der letzten …</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["Tage", keepDaily, setKeepDaily, 365],
                ["Wochen", keepWeekly, setKeepWeekly, 260],
                ["Monate", keepMonthly, setKeepMonthly, 240],
              ] as const
            ).map(([label, value, set, max]) => (
              <label key={label} className="flex items-center gap-1.5">
                <input type="number" min={0} max={max} className="input w-20" value={value} onChange={(e) => set(Number(e.target.value))} aria-label={`Backups: letzte ${label}`} />
                <span className="text-zinc-500">{label}</span>
              </label>
            ))}
          </div>
          <span className="block text-xs text-zinc-400">Ein Backup kann täglich, wöchentlich und monatlich zugleich zählen; was keins davon ist, löscht das nächste Backup.</span>
        </fieldset>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-500">Ordner (leer: im Datenordner)</span>
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
                if (!r.ok) toast(r.error ?? "Der Dialog ging nicht auf.", { tone: "error" });
                else if (r.path) {
                  // Picked: saved at once (the backups there so far move along).
                  setDir(r.path);
                  start(async () => done(await persist({ dir: r.path! })));
                }
              }}
              title="Ordner im Windows-Dialog wählen (er öffnet sich auf diesem Rechner)"
            >
              {picking ? "Dialog offen …" : "Durchsuchen …"}
            </button>
            {dir && (
              <button type="button" className="btn btn-sm shrink-0" onClick={() => setDir("")} title="Zurück zum Datenordner">
                Standard
              </button>
            )}
          </span>
          <span className="block text-xs text-zinc-400">Z. B. ein OneDrive-Ordner, damit die Backups nicht nur auf diesem Rechner liegen. Jetzt: {s.resolvedDir}</span>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-500">Passwort für die ZIP-Datei (AES-256)</span>
          <input
            type="password"
            className="input max-w-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={s.hasPassword ? "gesetzt — leer lassen, um es zu behalten" : "keins — die Backups sind unverschlüsselt"}
            autoComplete="new-password"
            disabled={clearPassword}
          />
          <span className="block text-xs text-zinc-400">
            Öffnen mit 7-Zip oder WinZip (der Windows-Explorer kann AES-ZIPs nicht). Für Windows&apos; <code className="code">tar</code> nur Zeichen ohne Umlaute. Es steht in Zeffs Datenbank — liegt der Ordner woanders, schützt es die Kopie dort.
          </span>
          {s.hasPassword && (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
              Passwort entfernen (künftige Backups unverschlüsselt)
            </label>
          )}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={save}>
          Speichern
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={backupNow} title={dirty ? "Speichert die Änderungen und sichert dann" : undefined}>
          {pending ? "…" : "Jetzt sichern"}
        </button>
        {dirty && !pending && <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">ungespeichert</span>}
        {!s.hasPassword && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Kein Passwort gesetzt — Backups werden unverschlüsselt gespeichert.</span>}
      </div>
      <p className="text-xs text-zinc-500">
        Letztes Backup:{" "}
        {s.lastAt ? (
          <>
            {s.lastOk === false ? <span className="text-red-600 dark:text-red-400">✗</span> : <span className="text-emerald-600 dark:text-emerald-400">✓</span>} {when(s.lastAt)} — {s.lastResult}
          </>
        ) : (
          "noch keins"
        )}
      </p>
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase">Backups ({backups.length})</h3>
        {backups.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {backups.map((b) => (
              <BackupRow key={b.name} b={b} hasPassword={s.hasPassword} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-zinc-500">Noch keine.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input ref={file} type="file" accept=".zip,application/zip" className="text-xs" aria-label="Backup-Datei hochladen" />
          <button type="button" className="btn btn-sm" disabled={pending} onClick={upload}>
            Hochladen
          </button>
          <span className="text-xs text-zinc-400">ein Backup von woanders (dann oben wiederherstellen)</span>
        </div>
      </div>
    </div>
  );
}
