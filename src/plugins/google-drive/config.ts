/**
 * The Google Drive plugin's store: your own OAuth client, the tokens it got, how the syncs behave
 * (one row per account) — and which Drive file each backup and document is (so nothing goes up
 * twice and nothing is removed that isn't Zeff's). Server only.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentAccountId, DEFAULT_ACCOUNT } from "@/db/accounts";
import type { GoogleDriveRow } from "@/db/schema";

const { googleDrive, googleDriveFiles } = schema;

/** Only the files Zeff makes in Drive — all that Zeff needs to put its own files there. */
export const SCOPE_FILE = "https://www.googleapis.com/auth/drive.file";
/** All of Drive — needed to see the files you add to Zeff's folder yourself (documents coming back). */
export const SCOPE_FULL = "https://www.googleapis.com/auth/drive";

export type DriveRow = GoogleDriveRow;

/** The settings row (made when first asked for). */
export function driveRow(): DriveRow {
  const db = getDb();
  const row = db.select().from(googleDrive).where(eq(googleDrive.id, 1)).get();
  if (row) return row;
  db.insert(googleDrive).values({ id: 1 }).onConflictDoNothing().run();
  return db.select().from(googleDrive).where(eq(googleDrive.id, 1)).get()!;
}

export function updateDrive(patch: Partial<Omit<DriveRow, "id">>): DriveRow {
  driveRow();
  return getDb().update(googleDrive).set(patch).where(eq(googleDrive.id, 1)).returning().get();
}

/** Signed in (a refresh token is there). */
export const isConnected = (r: DriveRow = driveRow()) => !!r.refreshToken;
/** Zeff may see all of Drive (not only its own files). */
export const hasFullAccess = (r: DriveRow = driveRow()) => r.scope.split(/\s+/).includes(SCOPE_FULL);

/** Zeff's folder in Drive, as named for this account unless you chose another name. */
export const defaultFolderName = () => (currentAccountId() === DEFAULT_ACCOUNT ? "Zeff" : `Zeff - ${currentAccountId()}`);
export const folderNameOf = (r: DriveRow = driveRow()) => r.folderName.trim() || defaultFolderName();

export type DriveFileRow = typeof googleDriveFiles.$inferSelect;

export const driveFiles = (kind: "backup" | "document"): DriveFileRow[] => getDb().select().from(googleDriveFiles).where(eq(googleDriveFiles.kind, kind)).all();

export function recordDriveFile(v: { kind: "backup" | "document"; key: string; driveId: string; version: string; size: number; origin: "push" | "pull" }): void {
  const row = { ...v, syncedAt: new Date().toISOString() };
  getDb().insert(googleDriveFiles).values(row).onConflictDoUpdate({ target: googleDriveFiles.driveId, set: row }).run();
}

export function forgetDriveFile(driveId: string): void {
  getDb().delete(googleDriveFiles).where(eq(googleDriveFiles.driveId, driveId)).run();
}

/**
 * Signed out: the tokens go; what was uploaded stays in Drive — and Zeff keeps its list of it (and
 * whose Drive it was: `email`), so connecting the same account again doesn't upload everything twice.
 */
export function disconnect(): void {
  updateDrive({ refreshToken: "", accessToken: "", expiresAt: 0, scope: "", connectedAt: null });
}

/** Another Google account's Drive: what Zeff knew of the one before (its files, its folders) doesn't apply. */
export function forgetDrive(): void {
  updateDrive({ rootFolderId: "", backupsFolderId: "", documentsFolderId: "" });
  getDb().delete(googleDriveFiles).run();
}
