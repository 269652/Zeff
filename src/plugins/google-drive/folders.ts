/**
 * Folders of your Drive Zeff reads (the Google Drive plugin): besides Zeff's own Documents folder, any folder you choose —
 * "My Drive → Kontoauszug" — is an inbox for the documents: what you put there comes in with the next sync, each file once
 * (an edited one again). Read only: Zeff never writes or deletes there. Files you put there yourself need full Drive
 * access. Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { FOLDER_MIME, listFolder } from "./api";
import { driveRow } from "./config";

const PREF = "googleDrive.pullFolders";

export type PullFolder = { id: string; path: string };

/** The folders chosen, as they were named when chosen. */
export const pullFolders = (): PullFolder[] => getPref<PullFolder[]>(PREF, []);

export function addPullFolder(f: PullFolder): void {
  if (!f.id.trim()) return;
  setPref(PREF, [...pullFolders().filter((x) => x.id !== f.id), { id: f.id.trim(), path: f.path.trim().slice(0, 300) || f.id }]);
}

export function removePullFolder(id: string): void {
  setPref(PREF, pullFolders().filter((x) => x.id !== id));
}

/** Whether the sign-in must ask for all of Drive: files you add yourself (Zeff's folder pulled, or a folder of yours chosen). */
export const needsFullAccess = (): boolean => driveRow().pullDocuments || pullFolders().length > 0;

/** The folders in a folder of your Drive ("root": My Drive), by name — to choose from. */
export async function listDriveFolders(parentId = "root"): Promise<{ id: string; name: string }[]> {
  return (await listFolder(parentId))
    .filter((f) => f.mimeType === FOLDER_MIME)
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
