"use server";

import { currentAccountId } from "@/db/accounts";
import { pluginAction } from "@/lib/action-result";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { Listing, Opened, Places } from "./shared";

/** The Explorer's server actions: each answers `{ ok: true, … }` or `{ ok: false, error }`. */

const inPlugin = pluginAction("explorer", () => t("The Explorer plugin is not installed (Menu → Plugins)."));
const withDocuments = () => {
  if (!isInstalled("documents")) throw new Error(t("The Documents plugin is not installed (Menu → Plugins)."));
};

/** A folder's entries (null: This PC) — remembered as the page's folder. */
export async function listFolderAction(pageId: number | null, path: string | null) {
  return inPlugin(async (): Promise<{ listing: Listing }> => {
    const listing = (await import("./files")).listDir(path ? String(path) : null);
    if (pageId) (await import("./pages")).rememberPath(Number(pageId), listing.path);
    return { listing };
  });
}

/** The side pane anew (a folder watched or no longer), and which folders are watched live. */
export async function placesAction() {
  return inPlugin(async (): Promise<{ places: Places; live: string[] }> => ({
    places: (await import("./files")).places(),
    live: (await import("./watch")).liveFolders(currentAccountId()),
  }));
}

/** A file opened for the viewer. */
export async function openFileAction(path: string) {
  return inPlugin(async (): Promise<{ file: Opened }> => ({ file: await (await import("./files")).openFile(String(path)) }));
}

/** A text file saved (refused when it changed on the disk since `mtime`). A file in Documents is imported again. */
export async function saveFileAction(path: string, text: string, mtime: number) {
  return inPlugin(async (): Promise<{ mtime: number; size: number; message: string }> => {
    const files = await import("./files");
    const saved = files.saveText(String(path), String(text), Number(mtime) || 0);
    let message = t("Saved.");
    if (isInstalled("documents") && !files.watchedFolderOf(files.normPath(String(path)))) {
      const { importState, importFiles } = await import("./imports");
      // Imported by hand before: its document follows the file (a watched folder's follows by itself).
      const had = importState([{ path: String(path), size: saved.size, mtime: saved.mtime }]).get(String(path));
      if (had?.changed) {
        await importFiles([String(path)]);
        message = t("Saved — its document in Documents is updated.");
      }
    }
    return { ...saved, message };
  });
}

/** Files imported into Documents. */
export async function importFilesAction(paths: string[]) {
  return inPlugin(async (): Promise<{ message: string; docIds: number[] }> => {
    withDocuments();
    const list = (Array.isArray(paths) ? paths : []).map(String).slice(0, 500);
    const r = await (await import("./imports")).importFiles(list);
    return { message: importMessage(r), docIds: r.docIds };
  });
}

/** Every file of a folder Documents can read imported once (subfolders too, at most 500). */
export async function importFolderAction(path: string) {
  return inPlugin(async (): Promise<{ message: string }> => {
    withDocuments();
    const { readableFiles, importFiles, MAX_FOLDER_IMPORT } = await import("./imports");
    const { files, cut } = readableFiles(String(path));
    if (!files.length) return { message: t("Nothing in this folder that Documents reads.") };
    const r = await importFiles(files);
    return { message: `${importMessage(r)}${cut ? ` ${t("Only the first {n} files — watch the folder to take in all of it.", { n: MAX_FOLDER_IMPORT })}` : ""}` };
  });
}

function importMessage(r: { added: number; updated: number; same: number; skipped: string[] }): string {
  const parts = [
    r.added && t("{n} imported", { n: r.added }),
    r.updated && t("{n} updated", { n: r.updated }),
    r.same && t("{n} already in Documents", { n: r.same }),
    r.skipped.length && t("{n} skipped ({why})", { n: r.skipped.length, why: r.skipped.slice(0, 2).join("; ") }),
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : t("Nothing to import.");
}

/** A folder watched: a local folder of Documents (read in now, then on every change and on its schedule). */
export async function watchFolderAction(path: string, mode: "auto" | "confirm") {
  return inPlugin(async (): Promise<{ message: string }> => {
    withDocuments();
    const f = (await import("@/plugins/documents/folders")).addFolder(String(path), mode === "confirm" ? "confirm" : "auto");
    void (await import("@/lib/sync/registry")).startSync("localdocs");
    // Watched live from now on (the minute's refresh keeps it so).
    (await import("./watch")).watchFolder(currentAccountId(), f.path);
    return { message: mode === "confirm" ? t("“{path}” is watched — its documents wait for your confirmation in Documents.", { path: f.path }) : t("“{path}” is watched — what changes in it comes into Documents.", { path: f.path }) };
  });
}

/** A watched folder no longer watched (its documents stay in Documents). */
export async function unwatchFolderAction(id: string) {
  return inPlugin(async (): Promise<{ message: string }> => {
    withDocuments();
    (await import("@/plugins/documents/folders")).removeFolder(String(id));
    await (await import("./watch")).refreshWatchers();
    return { message: t("No longer watched; its documents stay in Documents.") };
  });
}

/** A watched folder's mode changed: automatically on to the AI, or waiting for your confirmation. */
export async function watchModeAction(id: string, mode: "auto" | "confirm") {
  return inPlugin(async (): Promise<{ message: string }> => {
    withDocuments();
    (await import("@/plugins/documents/folders")).setFolderMode(String(id), mode === "confirm" ? "confirm" : "auto");
    return { message: t("Saved.") };
  });
}

/** A new folder or text file in a folder; its path. */
export async function createAction(parent: string, name: string, kind: "folder" | "file") {
  return inPlugin(async (): Promise<{ path: string }> => {
    const f = await import("./files");
    return { path: kind === "folder" ? f.makeFolder(String(parent), String(name)) : f.makeTextFile(String(parent), String(name)) };
  });
}

/** The file opened with this computer's own program for it — or shown in Windows Explorer (`reveal`). */
export async function openHereAction(path: string, reveal: boolean) {
  return inPlugin(async (): Promise<{ message: string }> => {
    await (await import("./files")).openHere(String(path), !!reveal);
    return { message: reveal ? t("Shown in Windows Explorer.") : t("Opened on this computer.") };
  });
}

/** An Explorer page's places shown in the Workspace tree (under the page) or beside its files. */
export async function placesInTreeAction(pageId: number, on: boolean) {
  return inPlugin(async (): Promise<{ message: string }> => {
    (await import("./pages")).setPlacesInTree(Number(pageId), !!on);
    (await import("@/app/action-helpers")).revalidateAll();
    return { message: on ? t("The places are in the sidebar now, under this page.") : t("The places are beside the files again.") };
  });
}
