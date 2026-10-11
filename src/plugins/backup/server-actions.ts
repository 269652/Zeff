"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** Backups (Settings): when and where, the password, a backup now, a restore — its server actions (each answers an ActionState unless it says otherwise). */

/** The backup settings — the password only when one is typed (or removed on purpose). */
export async function saveBackupSettingsAction(v: { enabled: boolean; everyHours: number; keepDaily: number; keepWeekly: number; keepMonthly: number; config?: boolean; dir: string; password?: string; clearPassword?: boolean }): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: t("Backups are not installed (Menu → Plugins).") };
    const { saveBackupSettings } = await import("@/plugins/backup/backup");
    const s = saveBackupSettings({ enabled: !!v.enabled, everyHours: Number(v.everyHours), keepDaily: Number(v.keepDaily), keepWeekly: Number(v.keepWeekly), keepMonthly: Number(v.keepMonthly), config: !!v.config, dir: String(v.dir ?? ""), password: v.password ? String(v.password) : undefined, clearPassword: !!v.clearPassword });
    revalidatePath("/preferences");
    const dir = s.resolvedDir;
    const message = !s.moved
      ? t("Backup settings saved — target: {dir}.", { dir })
      : s.moved === 1
        ? t("Backup settings saved — target: {dir} (1 backup moved there).", { dir })
        : t("Backup settings saved — target: {dir} ({n} backups moved there).", { dir, n: s.moved });
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A backup now. */
export async function runBackupAction(): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: t("Backups are not installed (Menu → Plugins).") };
    const { runBackup } = await import("@/plugins/backup/backup");
    const r = await runBackup();
    revalidatePath("/preferences");
    return r.ok ? { ok: true, message: t("Backed up: {result}", { result: r.message }) } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Restore a backup (by its name in the list; the password when it isn't the settings' one):
 * checked, the current state backed up first, then put in place as Zeff restarts.
 */
export async function restoreBackupAction(name: string, password?: string): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: t("Backups are not installed (Menu → Plugins).") };
    const { stageRestore } = await import("@/plugins/backup/backup");
    const r = await stageRestore(String(name), password ? String(password) : undefined);
    // The server restarts (its launcher starts it again) and puts the backup in place before it opens the database.
    setTimeout(() => process.exit(0), 800);
    return { ok: true, message: t("{n} files ready — Zeff restarts and restores {name}. The state before is backed up: {safety}", { n: r.files, name, safety: r.safety }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A backup file from elsewhere (another machine, a copy), put in the backup folder to restore from. */
export async function uploadBackupAction(fd: FormData): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: t("Backups are not installed (Menu → Plugins).") };
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, error: t("No file chosen.") };
    const { storeUploadedBackup } = await import("@/plugins/backup/backup");
    const name = storeUploadedBackup(file.name, Buffer.from(await file.arrayBuffer()));
    revalidatePath("/preferences");
    return { ok: true, message: name };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Settings and configuration taken over into the account you're in — from the config ZIP beside a
 * backup (`backup`: its name) or an uploaded one (`file`); `password` when not the settings' one.
 */
export async function importConfigAction(fd: FormData): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: t("Backups are not installed (Menu → Plugins).") };
    const { importConfigZip } = await import("@/plugins/backup/backup");
    const backup = fd.get("backup");
    const file = fd.get("file");
    const password = String(fd.get("password") ?? "") || undefined;
    const from = typeof backup === "string" && backup ? { backup } : file instanceof File && file.size ? { data: Buffer.from(await file.arrayBuffer()) } : null;
    if (!from) return { ok: false, error: t("No configuration chosen.") };
    const r = importConfigZip(from, password);
    (await import("@/plugins/knowledge/instances")).writeKnowledgeInstances(); // the plugins may have changed
    revalidateAll();
    return { ok: true, message: t("Configuration of “{account}” taken over — {rows} rows in {tables} tables.", { account: r.account, rows: r.rows, tables: r.tables }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
