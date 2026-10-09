import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getAppSettings, updateAppSettings } from "@/lib/ai";
import { errorMessage, ValidationError } from "@/lib/errors";
import { createZip, readZip, type ZipEntry } from "./zip";

/**
 * Backups: Zeff's data — the database (a consistent snapshot, its WAL in) and the files beside it
 * (the calendar inbox, the work logs, context files) — as a ZIP, AES-256-encrypted with the
 * password from the settings. Every N hours by itself (the scheduler), the last N kept. A restore
 * is staged and put in place when the server starts next (the database is open while it runs).
 */

const DATA_DIR = path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "zeff.db"));
const DB_FILE = path.basename(process.env.DATABASE_PATH ?? "zeff.db");
const PREFIX = "zeff-backup-";
/** Where a restore waits for the next start. */
export const RESTORE_DIR = path.join(DATA_DIR, "restore-pending");

export type BackupSettingsView = {
  enabled: boolean;
  everyHours: number;
  /** Kept: the newest of each of the last N days, weeks and months. */
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  /** As set ("" = the default). */
  dir: string;
  /** Where they go. */
  resolvedDir: string;
  hasPassword: boolean;
  lastAt: string | null;
  lastOk: boolean | null;
  lastResult: string | null;
};
/** Why a backup is kept: the newest of its day, week or month (among the last N of each) — or by hand (before a restore, uploaded). */
export type BackupTier = "daily" | "weekly" | "monthly" | "manual";
export type BackupFile = { name: string; size: number; at: string; encrypted: boolean | null; tiers: BackupTier[] };

export const backupDir = (dir = getAppSettings().backupDir) => (dir.trim() ? path.resolve(dir.trim()) : path.join(DATA_DIR, "backups"));

export function getBackupSettings(): BackupSettingsView {
  const s = getAppSettings();
  return {
    enabled: s.backupEnabled,
    everyHours: s.backupEveryHours,
    keepDaily: s.backupKeepDaily,
    keepWeekly: s.backupKeepWeekly,
    keepMonthly: s.backupKeepMonthly,
    dir: s.backupDir,
    resolvedDir: backupDir(s.backupDir),
    hasPassword: !!s.backupPassword,
    lastAt: s.backupLastAt,
    lastOk: s.backupLastOk,
    lastResult: s.backupLastResult,
  };
}

/** Change the settings — the password only when one is given (`clearPassword`: none any more). */
export function saveBackupSettings(v: { enabled: boolean; everyHours: number; keepDaily: number; keepWeekly: number; keepMonthly: number; dir: string; password?: string; clearPassword?: boolean }): BackupSettingsView & { moved: number } {
  const everyHours = Math.round(Number(v.everyHours));
  if (!(everyHours >= 1 && everyHours <= 24 * 30)) throw new ValidationError("Intervall: 1 Stunde bis 30 Tage.");
  const count = (n: number, what: string, max: number) => {
    const k = Math.round(Number(n));
    if (!(k >= 0 && k <= max)) throw new ValidationError(`${what}: 0 bis ${max}.`);
    return k;
  };
  const keepDaily = count(v.keepDaily, "Tägliche", 365);
  const keepWeekly = count(v.keepWeekly, "Wöchentliche", 260);
  const keepMonthly = count(v.keepMonthly, "Monatliche", 240);
  if (!keepDaily && !keepWeekly && !keepMonthly) throw new ValidationError("Mindestens eine Stufe muss Backups behalten.");
  const dir = v.dir.trim();
  if (dir && !path.isAbsolute(dir)) throw new ValidationError("Ordner: ein absoluter Pfad (oder leer für data\\backups).");
  // Another folder: it must be writable — and the backups there so far move along.
  const from = backupDir();
  const to = backupDir(dir);
  const moved = path.resolve(from).toLowerCase() !== path.resolve(to).toLowerCase() ? moveBackups(from, to) : 0;
  updateAppSettings({
    backupEnabled: !!v.enabled,
    backupEveryHours: everyHours,
    backupKeepDaily: keepDaily,
    backupKeepWeekly: keepWeekly,
    backupKeepMonthly: keepMonthly,
    backupDir: dir,
    ...(v.clearPassword ? { backupPassword: "" } : v.password ? { backupPassword: v.password } : {}),
  });
  return { ...getBackupSettings(), moved };
}

/** The backups in one folder moved to another (made, and checked writable, first). How many. */
function moveBackups(from: string, to: string): number {
  try {
    fs.mkdirSync(to, { recursive: true });
    const probe = path.join(to, `.zeff-write-test-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
  } catch (e) {
    throw new ValidationError(`In ${to} kann Zeff nicht schreiben: ${errorMessage(e)}`);
  }
  let n = 0;
  for (const b of listBackups(from)) {
    const src = path.join(from, b.name);
    const dst = path.join(to, b.name);
    if (fs.existsSync(dst)) continue;
    try {
      fs.renameSync(src, dst);
    } catch {
      // another drive: copied, then removed
      fs.copyFileSync(src, dst);
      fs.rmSync(src, { force: true });
    }
    n++;
  }
  return n;
}

/** The files that go in besides the database: everything in the data folder but databases, logs, backups and scratch. */
function dataFiles(): ZipEntry[] {
  const skipDirs = new Set([path.resolve(backupDir()), path.resolve(RESTORE_DIR), path.join(DATA_DIR, "work", "scratch")].map((d) => d.toLowerCase()));
  const out: ZipEntry[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(path.resolve(full).toLowerCase())) walk(full);
      } else if (e.isFile() && !/\.(db|db-wal|db-shm|log)$/i.test(e.name)) {
        const st = fs.statSync(full);
        out.push({ name: path.relative(DATA_DIR, full).replace(/\\/g, "/"), data: fs.readFileSync(full), modified: st.mtime });
      }
    }
  };
  walk(DATA_DIR);
  return out;
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const state = globalThis as unknown as { __zeffBackup?: Promise<{ ok: boolean; message: string; file?: string }> | null };

/**
 * A backup now: the database snapshot and the data files in one ZIP (encrypted when there's a
 * password), in the backup folder; those the rotation doesn't keep removed. `label` goes in the name
 * (e.g. "before-restore").
 */
export function runBackup(label = ""): Promise<{ ok: boolean; message: string; file?: string }> {
  if (state.__zeffBackup) return state.__zeffBackup;
  const run = (async () => {
    const s = getAppSettings();
    const dir = backupDir(s.backupDir);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(os.tmpdir(), `zeff-backup-${process.pid}-${Date.now()}.db`);
    try {
      // The database as it is now, WAL included — SQLite's online backup.
      const db = new Database(path.join(DATA_DIR, DB_FILE), { readonly: true, fileMustExist: true });
      try {
        await db.backup(tmp);
      } finally {
        db.close();
      }
      const entries: ZipEntry[] = [{ name: DB_FILE, data: fs.readFileSync(tmp), modified: new Date() }, ...dataFiles()];
      const zip = createZip(entries, s.backupPassword || undefined);
      const name = `${PREFIX}${stamp()}${label ? `-${label}` : ""}.zip`;
      const file = path.join(dir, name);
      fs.writeFileSync(`${file}.part`, zip);
      fs.renameSync(`${file}.part`, file);
      // Kept: what the rotation keeps (the newest of each of the last N days, weeks, months) and
      // the ones made by hand around a restore — the others go.
      const old = listBackups(dir).filter((b) => !b.tiers.length);
      for (const b of old) fs.rmSync(path.join(dir, b.name), { force: true });
      const message = `${name} · ${(zip.length / 1048576).toFixed(1)} MB · ${entries.length} Dateien${s.backupPassword ? " · verschlüsselt" : " · UNVERSCHLÜSSELT (kein Passwort gesetzt)"}${old.length ? ` · ${old.length} alte entfernt` : ""}`;
      updateAppSettings({ backupLastAt: new Date().toISOString(), backupLastOk: true, backupLastResult: message });
      return { ok: true, message, file };
    } catch (e) {
      const message = errorMessage(e);
      updateAppSettings({ backupLastAt: new Date().toISOString(), backupLastOk: false, backupLastResult: message });
      return { ok: false, message };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  })().finally(() => {
    state.__zeffBackup = null;
  });
  state.__zeffBackup = run;
  return run;
}

/** Whether a backup is due: on, and the last one (or none) at least the interval ago. */
export function backupDue(): boolean {
  const s = getAppSettings();
  if (!s.backupEnabled) return false;
  return !s.backupLastAt || Date.now() - Date.parse(s.backupLastAt) >= s.backupEveryHours * 3600000;
}

/** Whether a ZIP is encrypted (its first entry): null when it can't be told. */
function encryptedZip(file: string): boolean | null {
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(10);
    fs.readSync(fd, head, 0, 10, 0);
    fs.closeSync(fd);
    return head.readUInt32LE(0) === 0x04034b50 ? (head.readUInt16LE(6) & 1) === 1 : null;
  } catch {
    return null;
  }
}

/** When a backup was made: from its name (zeff-backup-YYYY-MM-DD_HHMMSS…), else the file's time. */
function madeAt(name: string, mtime: Date): Date {
  const m = /^zeff-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : mtime;
}

/** Its ISO week ("2026-W41"), local time. */
function isoWeek(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  const week = 1 + Math.round(((t.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The rotation (grandfather-father-son): of the backups newest first, the newest of each of the
 * last `daily` days, `weekly` weeks and `monthly` months are kept — one backup can be all three.
 * Those made by hand around a restore (labelled) are kept apart from it.
 */
export function rotation(list: { name: string; at: Date }[], keep: { daily: number; weekly: number; monthly: number }): Map<string, BackupTier[]> {
  const out = new Map<string, BackupTier[]>(list.map((b) => [b.name, []]));
  const scheduled = [...list].filter((b) => !/-(vor-wiederherstellung|upload)/.test(b.name)).sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const b of list) if (!scheduled.includes(b)) out.get(b.name)!.push("manual");
  const tiers: [BackupTier, number, (d: Date) => string][] = [
    ["daily", keep.daily, (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`],
    ["weekly", keep.weekly, isoWeek],
    ["monthly", keep.monthly, (d) => `${d.getFullYear()}-${d.getMonth()}`],
  ];
  for (const [tier, n, bucket] of tiers) {
    const seen = new Set<string>();
    for (const b of scheduled) {
      if (seen.size >= n) break;
      const k = bucket(b.at);
      if (seen.has(k)) continue;
      seen.add(k);
      out.get(b.name)!.push(tier);
    }
  }
  return out;
}

/** The backups in the folder, newest first — each with why it's kept (none: the next backup removes it). */
export function listBackups(dir = backupDir()): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  const s = getAppSettings();
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(PREFIX) && n.endsWith(".zip"))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: madeAt(name, st.mtime), encrypted: encryptedZip(path.join(dir, name)) };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const kept = rotation(files, { daily: s.backupKeepDaily, weekly: s.backupKeepWeekly, monthly: s.backupKeepMonthly });
  return files.map((f) => ({ ...f, at: f.at.toISOString(), tiers: kept.get(f.name) ?? [] }));
}

/** A backup's path in the folder — only names from the list (no paths). */
export function backupPath(name: string): string {
  if (!/^zeff-backup-[\w.-]+\.zip$/.test(name)) throw new ValidationError("Unbekanntes Backup.");
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw new ValidationError(`${name} gibt es nicht (mehr).`);
  return file;
}

/** An uploaded backup, put in the folder (to restore it from there). Its name in the list. */
export function storeUploadedBackup(original: string, data: Buffer): string {
  if (data.readUInt32LE(0) !== 0x04034b50) throw new ValidationError("Das ist keine ZIP-Datei.");
  const base = path.basename(original).replace(/\.zip$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80);
  const name = `${PREFIX}upload-${stamp()}-${base}.zip`;
  fs.mkdirSync(backupDir(), { recursive: true });
  fs.writeFileSync(path.join(backupDir(), name), data);
  return name;
}

/**
 * Restore a backup: opened with the password (the settings' one when none is given) and checked —
 * a readable Zeff database in it — then a backup of the current state is made, and the files are
 * staged; the server restarts and puts them in place before it opens the database.
 */
export async function stageRestore(name: string, password?: string): Promise<{ files: number; safety: string }> {
  const file = backupPath(name);
  const entries = readZip(fs.readFileSync(file), password || getAppSettings().backupPassword || undefined);
  const db = entries.find((e) => e.name === DB_FILE);
  if (!db) throw new ValidationError(`Kein ${DB_FILE} im Backup — kein Zeff-Backup?`);
  // A Zeff database: it opens, and has the tables.
  const probe = path.join(os.tmpdir(), `zeff-restore-probe-${Date.now()}.db`);
  fs.writeFileSync(probe, db.data);
  try {
    const d = new Database(probe, { readonly: true });
    try {
      const ok = d.prepare("select count(*) n from sqlite_master where type='table' and name in ('time_entries','jobs')").get() as { n: number };
      if (ok.n < 2) throw new ValidationError("Die Datenbank im Backup ist keine Zeff-Datenbank.");
      const check = d.pragma("quick_check", { simple: true });
      if (check !== "ok") throw new ValidationError(`Die Datenbank im Backup ist beschädigt: ${String(check)}`);
    } finally {
      d.close();
    }
  } finally {
    fs.rmSync(probe, { force: true });
  }
  // The state now, kept first.
  const safety = await runBackup("vor-wiederherstellung");
  if (!safety.ok) throw new Error(`Sicherung des aktuellen Stands fehlgeschlagen — nichts wiederhergestellt: ${safety.message}`);
  fs.rmSync(RESTORE_DIR, { recursive: true, force: true });
  for (const e of entries) {
    const target = path.resolve(RESTORE_DIR, e.name);
    if (!target.startsWith(path.resolve(RESTORE_DIR) + path.sep)) continue; // nothing outside
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  fs.writeFileSync(path.join(RESTORE_DIR, ".ready"), JSON.stringify({ from: name, at: new Date().toISOString() }));
  return { files: entries.length, safety: safety.file ? path.basename(safety.file) : "" };
}
