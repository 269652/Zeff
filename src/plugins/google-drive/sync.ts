/**
 * The two syncs the Google Drive plugin brings, as extensions of two other plugins:
 *  - Backups → Drive: the backup ZIPs (and their config ZIPs) go up as they're made; what the
 *    local retention removes goes from Drive too (when set). Unencrypted ones stay home unless allowed.
 *  - Documents ↔ Drive: every document goes up; files you add to Drive's Documents folder come
 *    in (only when set — that needs full Drive access). Nothing is ever removed on one side
 *    because it went on the other.
 * Only files Zeff recorded as its own are ever removed. Server only.
 */
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { accountBackupFiles } from "@/plugins/backup/backup";
import { addDocument, documentFile, listDocuments } from "@/plugins/documents/store";
import { MAX_DOCUMENT_BYTES } from "@/plugins/documents/shared";
import { deleteFile, download, ensureFolder, exportFile, folderExists, FOLDER_MIME, listFolder, uploadFile } from "./api";
import { driveFiles, driveRow, folderNameOf, forgetDriveFile, hasFullAccess, isConnected, recordDriveFile, updateDrive } from "./config";

export type SyncResult = { ok: boolean; message: string };

/** At most this many files come in per run (the rest next time). */
const PULL_MAX = 25;

/** Google's own documents, as the Office file Zeff's Documents reads. */
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ".pptx" },
};

/** Running now (one at a time, per step). */
const flags = globalThis as unknown as Record<string, boolean | undefined>;
export const driveBusy = (flag: string) => !!flags[flag];

async function guarded(flag: string, run: () => Promise<SyncResult>): Promise<SyncResult> {
  if (flags[flag]) return { ok: true, message: t("Already running.") };
  flags[flag] = true;
  try {
    if (!isConnected()) return { ok: false, message: t("Google Drive isn't connected — connect it on its page.") };
    return await run();
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  } finally {
    flags[flag] = false;
  }
}

/** The Drive folder for a kind of file: Zeff's folder, and in it Backups or Documents — made when they're not there (or were deleted). */
async function folderFor(kind: "backups" | "documents"): Promise<string> {
  const column = kind === "backups" ? "backupsFolderId" : "documentsFolderId";
  const row = driveRow();
  if (row[column] && (await folderExists(row[column]))) return row[column];
  let root = row.rootFolderId;
  if (!root || !(await folderExists(root))) root = await ensureFolder(folderNameOf(row));
  const id = await ensureFolder(kind === "backups" ? "Backups" : "Documents", root);
  updateDrive({ rootFolderId: root, [column]: id });
  return id;
}

const summary = (parts: [number, string][]) => parts.filter(([n]) => n > 0).map(([, text]) => text).join(" · ");

/** Backups → Drive. */
export function syncBackups(): Promise<SyncResult> {
  return guarded("__zeffDriveBackup", async () => {
    const row = driveRow();
    const local = accountBackupFiles();
    const known = new Map(driveFiles("backup").map((r) => [r.key, r]));
    const toSend = local.filter((f) => !known.has(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    let uploaded = 0;
    let withheld = 0;
    let removed = 0;
    const folder = toSend.length || known.size ? await folderFor("backups") : "";
    for (const f of toSend) {
      // A backup without a password is the whole database in the clear: not off to Google unless you said so.
      if (!row.uploadUnencrypted && f.encrypted !== true) {
        withheld++;
        continue;
      }
      let file;
      try {
        file = await uploadFile({ name: f.name, folderId: folder, file: f.path, mime: "application/zip" });
      } catch (e) {
        return { ok: false, message: `${f.name}: ${errorMessage(e)}${uploaded ? ` (${t("{n} uploaded before", { n: uploaded })})` : ""}` };
      }
      recordDriveFile({ kind: "backup", key: f.name, driveId: file.id, version: file.md5Checksum ?? "", size: f.size, origin: "push" });
      uploaded++;
    }
    // What the retention removed here goes from Drive too — only what Zeff put there, and never when the folder looks empty (a missing disk).
    if (row.mirrorBackupRetention && local.length) {
      const names = new Set(local.map((f) => f.name));
      for (const r of known.values()) {
        if (names.has(r.key)) continue;
        await deleteFile(r.driveId);
        forgetDriveFile(r.driveId);
        removed++;
      }
    }
    const text = summary([
      [uploaded, t("{n} uploaded", { n: uploaded })],
      [removed, t("{n} removed (the retention)", { n: removed })],
      [withheld, t("{n} not uploaded: no password set", { n: withheld })],
    ]);
    return { ok: true, message: text || t("Everything is in Drive already.") };
  });
}

/** Documents ↔ Drive. */
export function syncDocuments(): Promise<SyncResult> {
  return guarded("__zeffDriveDocs", async () => {
    const row = driveRow();
    const folder = await folderFor("documents");
    const known = driveFiles("document");
    const byKey = new Set(known.map((r) => r.key));
    const byDrive = new Map(known.map((r) => [r.driveId, r]));
    let uploaded = 0;
    let pulled = 0;
    let failed = 0;
    let note = "";

    // Zeff → Drive: each document that isn't there yet.
    for (const doc of listDocuments().sort((a, b) => a.id - b.id)) {
      const key = `doc:${doc.id}`;
      if (byKey.has(key)) continue;
      const stored = documentFile(doc.id);
      if (!stored) continue;
      try {
        const file = await uploadFile({ name: doc.name, folderId: folder, file: stored.path, mime: doc.mime || undefined });
        recordDriveFile({ kind: "document", key, driveId: file.id, version: file.md5Checksum ?? file.modifiedTime ?? "", size: doc.size, origin: "push" });
        uploaded++;
      } catch (e) {
        if (++failed === 1) note = `${doc.name}: ${errorMessage(e)}`;
      }
    }

    // Drive → Zeff: what you added to the folder (when set — and Zeff may see it).
    if (row.pullDocuments) {
      if (!hasFullAccess(row)) {
        note ||= t("Files you add in Drive can't be read with the access Zeff has — connect again to give it.");
      } else {
        for (const f of await listFolder(folder)) {
          if (pulled >= PULL_MAX) break;
          if (f.mimeType === FOLDER_MIME) continue;
          const version = f.md5Checksum ?? f.modifiedTime ?? "";
          const had = byDrive.get(f.id);
          if (had && had.version === version) continue;
          const exp = EXPORTS[f.mimeType];
          if (f.mimeType.startsWith("application/vnd.google-apps.") && !exp) continue;
          try {
            if (!exp && Number(f.size ?? 0) > MAX_DOCUMENT_BYTES) throw new Error(t("“{name}” is too large (at most {n} MB).", { name: f.name, n: MAX_DOCUMENT_BYTES / 1024 / 1024 }));
            const data = exp ? await exportFile(f.id, exp.mime) : await download(f.id);
            const name = exp && !f.name.toLowerCase().endsWith(exp.ext) ? `${f.name}${exp.ext}` : f.name;
            const { doc } = addDocument(name, data, exp ? exp.mime : f.mimeType);
            recordDriveFile({ kind: "document", key: `doc:${doc.id}`, driveId: f.id, version, size: data.length, origin: "pull" });
            pulled++;
          } catch (e) {
            // Remembered as it is (not tried again until it changes in Drive).
            recordDriveFile({ kind: "document", key: "skipped", driveId: f.id, version, size: Number(f.size ?? 0), origin: "pull" });
            if (++failed === 1) note ||= `${f.name}: ${errorMessage(e)}`;
          }
        }
      }
    }

    const text = summary([
      [uploaded, t("{n} uploaded", { n: uploaded })],
      [pulled, t("{n} came in from Drive", { n: pulled })],
      [failed, t("{n} failed", { n: failed })],
    ]);
    return { ok: failed === 0, message: [text || t("Everything is in sync."), note].filter(Boolean).join(" — ") };
  });
}

/** What Zeff has in Drive, for the page (the files it couldn't take in aren't counted). */
export const driveCounts = () => ({ backups: driveFiles("backup").length, documents: driveFiles("document").filter((r) => r.key !== "skipped").length });
