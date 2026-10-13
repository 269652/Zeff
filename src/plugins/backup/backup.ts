import { pad2 as p } from "@/lib/text";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "@/db";
import { ACCOUNTS_DIR, currentAccountId, DEFAULT_ACCOUNT } from "@/db/accounts";
import { getAppSettings, updateAppSettings } from "@/lib/ai";
import { errorMessage, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { CONFIG_FILE, exportConfig, importConfig, parseConfig } from "./config";
import { createZip, readZip, type ZipEntry } from "./zip";

/**
 * Backups: Zeff's data — the database (a consistent snapshot, its WAL in) and the files beside it
 * (the calendar inbox, the work logs, context files) — as a ZIP, AES-256-encrypted with the
 * password from the settings. Every N hours by itself (the scheduler), the last N kept. A restore
 * is staged and put in place when the server starts next (the database is open while it runs).
 * Each account (Accounts plugin) backs up its own folder, with its own settings — its files named
 * after it, so two accounts can share a backup folder.
 */

const DB_FILE = "zeff.db";
/** The account's backups: zeff-backup-… (the first account), zeff-konto-<account>-backup-… (the others). */
const prefix = (kind: "backup" | "config" = "backup") => (currentAccountId() === DEFAULT_ACCOUNT ? `zeff-${kind}-` : `zeff-konto-${currentAccountId()}-${kind}-`);
/** A backup's config ZIP (settings and configuration), beside it. */
const configName = (backup: string) => prefix("config") + backup.slice(prefix().length);
/** Where a restore waits for the next start. */
export const restoreDir = () => path.join(dataDir(), "restore-pending");

export type BackupSettingsView = {
  enabled: boolean;
  everyHours: number;
  /** Kept: the newest of each of the last N days, weeks and months. */
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  /** Settings and configuration also as a config ZIP of their own. */
  config: boolean;
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
export type BackupFile = { name: string; size: number; at: string; encrypted: boolean | null; tiers: BackupTier[]; config: boolean };

export const backupDir = (dir = getAppSettings().backupDir) => (dir.trim() ? path.resolve(dir.trim()) : path.join(dataDir(), "backups"));

export function getBackupSettings(): BackupSettingsView {
  const s = getAppSettings();
  return {
    enabled: s.backupEnabled,
    everyHours: s.backupEveryHours,
    keepDaily: s.backupKeepDaily,
    keepWeekly: s.backupKeepWeekly,
    keepMonthly: s.backupKeepMonthly,
    config: s.backupConfig,
    dir: s.backupDir,
    resolvedDir: backupDir(s.backupDir),
    hasPassword: !!s.backupPassword,
    lastAt: s.backupLastAt,
    lastOk: s.backupLastOk,
    lastResult: s.backupLastResult,
  };
}

/** Change the settings — the password only when one is given (`clearPassword`: none any more). */
export function saveBackupSettings(v: { enabled: boolean; everyHours: number; keepDaily: number; keepWeekly: number; keepMonthly: number; config?: boolean; dir: string; password?: string; clearPassword?: boolean }): BackupSettingsView & { moved: number } {
  const everyHours = Math.round(Number(v.everyHours));
  if (!(everyHours >= 1 && everyHours <= 24 * 30)) throw new ValidationError(t("Interval: 1 hour to 30 days."));
  const count = (n: number, what: string, max: number) => {
    const k = Math.round(Number(n));
    if (!(k >= 0 && k <= max)) throw new ValidationError(t("{what}: 0 to {max}.", { what, max }));
    return k;
  };
  const keepDaily = count(v.keepDaily, t("Daily"), 365);
  const keepWeekly = count(v.keepWeekly, t("Weekly"), 260);
  const keepMonthly = count(v.keepMonthly, t("Monthly"), 240);
  if (!keepDaily && !keepWeekly && !keepMonthly) throw new ValidationError(t("At least one tier has to keep backups."));
  const dir = v.dir.trim();
  if (dir && !path.isAbsolute(dir)) throw new ValidationError(t("Folder: an absolute path (or empty for {dir}).", { dir: "data\\backups" }));
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
    backupConfig: !!v.config,
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
    throw new ValidationError(t("Zeff can't write to {dir}: {error}", { dir: to, error: errorMessage(e) }));
  }
  let n = 0;
  for (const name of listBackups(from).flatMap((b) => (b.config ? [b.name, configName(b.name)] : [b.name]))) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
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

/** The files that go in besides the database: everything in the account's folder but databases, logs, backups, scratch and the other accounts. */
function dataFiles(): ZipEntry[] {
  const DATA_DIR = dataDir();
  const skipDirs = new Set([path.resolve(backupDir()), path.resolve(restoreDir()), path.join(DATA_DIR, "work", "scratch"), ACCOUNTS_DIR].map((d) => path.resolve(d).toLowerCase()));
  const out: ZipEntry[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(path.resolve(full).toLowerCase())) walk(full);
      } else if (e.isFile() && !/\.(db|db-wal|db-shm|log)$/i.test(e.name) && !(dir === DATA_DIR && e.name === "accounts.json")) {
        const st = fs.statSync(full);
        out.push({ name: path.relative(DATA_DIR, full).replace(/\\/g, "/"), data: fs.readFileSync(full), modified: st.mtime });
      }
    }
  };
  walk(DATA_DIR);
  return out;
}

const stamp = (d = new Date()) => {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const state = globalThis as unknown as { __zeffBackups?: Map<string, Promise<{ ok: boolean; message: string; file?: string }>> };
const running = (state.__zeffBackups ??= new Map());

/**
 * A backup now: the database snapshot and the data files in one ZIP (encrypted when there's a
 * password), in the backup folder; those the rotation doesn't keep removed. `label` goes in the name
 * (e.g. "before-restore").
 */
export function runBackup(label = ""): Promise<{ ok: boolean; message: string; file?: string }> {
  const account = currentAccountId();
  const going = running.get(account);
  if (going) return going;
  const DATA_DIR = dataDir();
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
      const name = `${prefix()}${stamp()}${label ? `-${label}` : ""}.zip`;
      const file = path.join(dir, name);
      fs.writeFileSync(`${file}.part`, zip);
      fs.renameSync(`${file}.part`, file);
      // Settings and configuration besides, as a ZIP of their own (to take into any account).
      if (s.backupConfig) {
        const cfg = createZip([{ name: CONFIG_FILE, data: Buffer.from(JSON.stringify(exportConfig(), null, 2)), modified: new Date() }], s.backupPassword || undefined);
        const cfgFile = path.join(dir, configName(name));
        fs.writeFileSync(`${cfgFile}.part`, cfg);
        fs.renameSync(`${cfgFile}.part`, cfgFile);
      }
      // Kept: what the rotation keeps (the newest of each of the last N days, weeks, months) and
      // the ones made by hand around a restore — the others go (their config ZIPs with them).
      const old = listBackups(dir).filter((b) => !b.tiers.length);
      for (const b of old) for (const n of [b.name, configName(b.name)]) fs.rmSync(path.join(dir, n), { force: true });
      const message = [
        s.backupConfig ? `${name} ${t("(+ configuration)")}` : name,
        `${(zip.length / 1048576).toFixed(1)} MB`,
        t("{n} files", { n: entries.length }),
        s.backupPassword ? t("encrypted") : t("NOT ENCRYPTED (no password set)"),
        ...(old.length ? [t("{n} old ones removed", { n: old.length })] : []),
      ].join(" · ");
      updateAppSettings({ backupLastAt: new Date().toISOString(), backupLastOk: true, backupLastResult: message });
      // Extensions that keep a copy elsewhere (Google Drive): now, not at their next turn.
      void import("@/plugins/google-drive/after").then((m) => m.afterBackup()).catch(() => {});
      return { ok: true, message, file };
    } catch (e) {
      const message = errorMessage(e);
      updateAppSettings({ backupLastAt: new Date().toISOString(), backupLastOk: false, backupLastResult: message });
      return { ok: false, message };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  })().finally(() => {
    running.delete(account);
  });
  running.set(account, run);
  return run;
}

/** This account's files in the backup folder — its backup ZIPs and their config ZIPs (nothing half written, no other account's). */
export function accountBackupFiles(dir = backupDir()): { name: string; path: string; size: number; encrypted: boolean | null; config: boolean }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const backups = prefix("backup");
  const configs = prefix("config");
  return names
    .filter((n) => n.endsWith(".zip") && (n.startsWith(backups) || n.startsWith(configs)))
    .flatMap((n) => {
      const file = path.join(dir, n);
      try {
        const st = fs.statSync(file);
        return st.isFile() ? [{ name: n, path: file, size: st.size, encrypted: encryptedZip(file), config: n.startsWith(configs) }] : [];
      } catch {
        return [];
      }
    });
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
  const m = /^zeff-(?:[\w-]+-)?backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
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
    .filter((n) => n.startsWith(prefix()) && n.endsWith(".zip"))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: madeAt(name, st.mtime), encrypted: encryptedZip(path.join(dir, name)) };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const kept = rotation(files, { daily: s.backupKeepDaily, weekly: s.backupKeepWeekly, monthly: s.backupKeepMonthly });
  return files.map((f) => ({ ...f, at: f.at.toISOString(), tiers: kept.get(f.name) ?? [], config: fs.existsSync(path.join(dir, configName(f.name))) }));
}

/** A backup's path in the folder — only names from the list (no paths). */
export function backupPath(name: string): string {
  if (!name.startsWith(prefix()) || !/^zeff-[\w.-]+\.zip$/.test(name)) throw new ValidationError(t("Unknown backup."));
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw new ValidationError(t("{name} doesn't exist (any more).", { name }));
  return file;
}

/** An uploaded backup, put in the folder (to restore it from there). Its name in the list. */
export function storeUploadedBackup(original: string, data: Buffer): string {
  if (data.readUInt32LE(0) !== 0x04034b50) throw new ValidationError(t("That's not a ZIP file."));
  const base = path.basename(original).replace(/\.zip$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80);
  const name = `${prefix()}upload-${stamp()}-${base}.zip`;
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
  if (!db) throw new ValidationError(t("No {file} in the backup — not a Zeff backup?", { file: DB_FILE }));
  // A Zeff database: it opens, and has the tables.
  const probe = path.join(os.tmpdir(), `zeff-restore-probe-${Date.now()}.db`);
  fs.writeFileSync(probe, db.data);
  try {
    const d = new Database(probe, { readonly: true });
    try {
      const ok = d.prepare("select count(*) n from sqlite_master where type='table' and name in ('time_entries','jobs')").get() as { n: number };
      if (ok.n < 2) throw new ValidationError(t("The database in the backup isn't a Zeff database."));
      const check = d.pragma("quick_check", { simple: true });
      if (check !== "ok") throw new ValidationError(t("The database in the backup is damaged: {check}", { check: String(check) }));
    } finally {
      d.close();
    }
  } finally {
    fs.rmSync(probe, { force: true });
  }
  // The state now, kept first.
  const safety = await runBackup("vor-wiederherstellung");
  if (!safety.ok) throw new Error(t("Backing up the current state failed — nothing restored: {error}", { error: safety.message }));
  const RESTORE_DIR = restoreDir();
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

/**
 * Settings and configuration taken over from a config ZIP — one beside a backup (by its backup's
 * name) or one uploaded — into the account you're in. Its password: the given one, else the settings'.
 */
export function importConfigZip(from: { backup: string } | { data: Buffer }, password?: string): { tables: number; rows: number; account: string } {
  let data: Buffer;
  if ("backup" in from) {
    const file = path.join(backupDir(), configName(path.basename(backupPath(from.backup))));
    if (!fs.existsSync(file)) throw new ValidationError(t("There's no configuration for this backup."));
    data = fs.readFileSync(file);
  } else data = from.data;
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) throw new ValidationError(t("That's not a ZIP file."));
  const entries = readZip(data, password || getAppSettings().backupPassword || undefined);
  const cfg = entries.find((e) => e.name === CONFIG_FILE);
  if (!cfg) throw new ValidationError(t("No {file} in the ZIP — not a Zeff configuration?", { file: CONFIG_FILE }));
  const c = parseConfig(cfg.data);
  return { ...importConfig(c), account: c.account };
}
