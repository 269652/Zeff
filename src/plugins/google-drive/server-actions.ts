"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import type { ActionState } from "@/app/action-helpers";

/** The Google Drive page's server actions (each answers an ActionState). */

async function installed(): Promise<ActionState | null> {
  return (await import("@/plugins/state")).isInstalled("google-drive") ? null : { ok: false, error: t("Google Drive is not installed (Menu → Plugins).") };
}

/** Your OAuth client — the secret only when one is typed (else the saved one stays). A new client signs you out. */
export async function saveDriveClientAction(v: { clientId: string; clientSecret?: string }): Promise<ActionState> {
  try {
    const no = await installed();
    if (no) return no;
    const { driveRow, updateDrive, disconnect } = await import("./config");
    const clientId = String(v.clientId ?? "").trim();
    const secret = String(v.clientSecret ?? "").trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, error: t("The client ID looks like 123456-abc….apps.googleusercontent.com.") };
    const row = driveRow();
    if (!secret && !row.clientSecret) return { ok: false, error: t("The client secret is missing.") };
    const changed = clientId !== row.clientId || (secret !== "" && secret !== row.clientSecret);
    // (Another client may be another Google project's — and any account: connect again; the same account's files are recognised.)
    if (changed && row.refreshToken) disconnect();
    updateDrive({ clientId, ...(secret ? { clientSecret: secret } : {}) });
    revalidatePath("/google-drive");
    return { ok: true, message: changed && row.refreshToken ? t("Saved. The new client needs you to connect again.") : t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** What syncs and how. */
export async function saveDriveSettingsAction(v: { folderName: string; mirrorBackupRetention: boolean; uploadUnencrypted: boolean; pullDocuments: boolean }): Promise<ActionState> {
  try {
    const no = await installed();
    if (no) return no;
    const { driveRow, updateDrive, hasFullAccess, isConnected } = await import("./config");
    const before = driveRow();
    const folderName = String(v.folderName ?? "").trim().slice(0, 100);
    if (/[\\/]/.test(folderName)) return { ok: false, error: t("The folder's name can't have a slash.") };
    updateDrive({
      folderName,
      mirrorBackupRetention: !!v.mirrorBackupRetention,
      uploadUnencrypted: !!v.uploadUnencrypted,
      pullDocuments: !!v.pullDocuments,
      // Another folder: made (or found) at the next sync.
      ...(folderName !== before.folderName ? { rootFolderId: "", backupsFolderId: "", documentsFolderId: "" } : {}),
    });
    revalidatePath("/google-drive");
    const needsFull = !!v.pullDocuments && isConnected(before) && !hasFullAccess(before);
    return { ok: true, message: needsFull ? t("Saved. To read the files you add in Drive, connect again — Google then asks for access to all of Drive.") : t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Signed out: Zeff forgets the sign-in (what it uploaded stays in Drive). */
export async function disconnectDriveAction(): Promise<ActionState> {
  try {
    const no = await installed();
    if (no) return no;
    (await import("./config")).disconnect();
    revalidatePath("/google-drive");
    return { ok: true, message: t("Disconnected. What is in Drive stays there.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A sync now (it goes on in the background — the page shows how it went). */
export async function syncDriveNowAction(step: string): Promise<ActionState> {
  try {
    const no = await installed();
    if (no) return no;
    if (step !== "drivebackup" && step !== "drivedocs") return { ok: false, error: t("Unknown step.") };
    const r = await (await import("@/lib/sync/registry")).startSync(step);
    revalidatePath("/google-drive");
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The folders in a folder of your Drive ("root": My Drive) — to choose from. */
export async function listDriveFoldersAction(parentId: string): Promise<{ ok: true; folders: { id: string; name: string }[] } | { ok: false; error: string }> {
  try {
    return { ok: true, folders: await (await import("./folders")).listDriveFolders(String(parentId || "root")) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** A folder of your Drive chosen: what you put there comes into the documents. */
export async function addPullFolderAction(f: { id: string; path: string }): Promise<ActionState> {
  try {
    const { addPullFolder } = await import("./folders");
    const { driveRow, hasFullAccess, isConnected } = await import("./config");
    addPullFolder({ id: String(f.id), path: String(f.path ?? "") });
    revalidatePath("/google-drive");
    const row = driveRow();
    return { ok: true, message: isConnected(row) && !hasFullAccess(row) ? t("Added. To read the files you put there, connect again — Google then asks for access to all of Drive.") : t("Added — its files come in with the next sync.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function removePullFolderAction(id: string): Promise<ActionState> {
  try {
    (await import("./folders")).removePullFolder(String(id));
    revalidatePath("/google-drive");
    return { ok: true, message: t("Removed — what came in from it stays in the documents.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
