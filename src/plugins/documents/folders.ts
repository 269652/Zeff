/**
 * Local folders (Settings → Documents): folders on this computer whose documents Zeff reads in by itself — subfolders
 * too — on a schedule (the "localdocs" sync step). A file changed: its document is updated in place (read and compiled
 * again). A file deleted: its document stays, marked as gone from the folder. Each folder either goes on automatically
 * or waits for you: then nothing with the AI happens to its documents until you confirm them (gate.ts).
 *
 * The folders are kept in a pref of the account; each file's state (path, size, time, its document) in doc_local_files.
 * In Docker a host path is mapped to the mounted one (lib/hostpath). Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { toLocalPath } from "@/lib/hostpath";
import { t } from "@/lib/i18n/server";
import { kindOf, MAX_DOCUMENT_BYTES } from "./shared";
import { addDocument, replaceDocument } from "./store";
import { hold } from "./gate";

export type FolderMode = "auto" | "confirm";
export type LocalFolder = { id: string; path: string; mode: FolderMode; addedAt: string; lastScanAt: string | null; files: number };
export type FolderFile = { rel: string; docId: number | null; size: number; mtime: number; missingAt: string | null };

const PREF = "documents:folders";
/** At most this many files read in (new or changed) per run — the rest the next time; a big folder doesn't block a sync. */
const PER_RUN = 150;
/** At most this many entries looked at per folder (a whole drive by mistake stays bounded). */
const MAX_ENTRIES = 50_000;
/** Folders never looked into (version control, packages, the system's own). */
const SKIP_DIRS = new Set(["node_modules", "$recycle.bin", "system volume information", "__pycache__"]);

let made = false;
function db() {
  const d = getSqlite();
  if (!made) {
    d.exec(
      "create table if not exists doc_local_files (path text primary key, folder_id text not null, rel text not null, doc_id integer, size integer not null, mtime integer not null, missing_at text); create index if not exists doc_local_files_folder on doc_local_files (folder_id);",
    );
    made = true;
  }
  return d;
}

/** A folder's path as kept: absolute, without a trailing separator — but a drive's root stays "C:\" ("C:" alone is the current folder on C). */
const norm = (p: string) => {
  const given = toLocalPath(p.trim());
  const abs = path.resolve(/^[A-Za-z]:$/.test(given) ? `${given}\\` : given);
  const root = path.parse(abs).root;
  return abs === root || abs.replace(/[\\/]+$/, "") === root.replace(/[\\/]+$/, "") ? root : abs.replace(/[\\/]+$/, "");
};
const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

export const listFolders = (): LocalFolder[] => getPref<LocalFolder[]>(PREF, []);
const save = (list: LocalFolder[]) => setPref(PREF, list);

/** A folder added (the same one again: that one, with the mode given). */
export function addFolder(raw: string, mode: FolderMode): LocalFolder {
  const p = norm(raw);
  if (!raw.trim() || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(t("“{path}” is not a folder on this computer.", { path: raw.trim() }));
  const list = listFolders();
  const had = list.find((f) => same(f.path, p));
  if (had) {
    had.mode = mode;
    save(list);
    return had;
  }
  const f: LocalFolder = { id: randomUUID().slice(0, 8), path: p, mode, addedAt: new Date().toISOString(), lastScanAt: null, files: 0 };
  save([...list, f]);
  return f;
}

export function setFolderMode(id: string, mode: FolderMode): void {
  save(listFolders().map((f) => (f.id === id ? { ...f, mode } : f)));
}

/** A folder no longer read (its documents stay in Zeff). */
export function removeFolder(id: string): void {
  save(listFolders().filter((f) => f.id !== id));
  db().prepare("delete from doc_local_files where folder_id = ?").run(id);
}

export const folderFiles = (folderId: string): FolderFile[] =>
  (db().prepare("select rel, doc_id, size, mtime, missing_at from doc_local_files where folder_id = ? order by rel").all(folderId) as { rel: string; doc_id: number | null; size: number; mtime: number; missing_at: string | null }[]).map((r) => ({ rel: r.rel, docId: r.doc_id, size: r.size, mtime: r.mtime, missingAt: r.missing_at }));

/** Where each document from a local folder comes from: its folder, its path, whether the file is gone. */
export function localOrigins(): Map<number, { folder: string; path: string; shown: string; missing: boolean }> {
  const folders = new Map(listFolders().map((f) => [f.id, f.path]));
  const rows = db().prepare("select path, rel, folder_id, doc_id, missing_at from doc_local_files where doc_id is not null").all() as { path: string; rel: string; folder_id: string; doc_id: number; missing_at: string | null }[];
  return new Map(
    rows.map((r) => {
      const folder = folders.get(r.folder_id) ?? "";
      // Shown short: the folder's own name and the path inside it ("Rechnungen › 2026 › rechnung.pdf").
      const shown = [path.basename(folder) || folder, ...r.rel.split(/[\\/]/)].filter(Boolean).join(" › ");
      return [r.doc_id, { folder, path: r.path, shown, missing: !!r.missing_at }];
    }),
  );
}

/** The files of a folder Zeff can read: subfolders too; hidden ones, Office's lock files and unknown kinds left out. */
function walk(root: string): { path: string; rel: string; size: number; mtime: number }[] {
  const out: { path: string; rel: string; size: number; mtime: number }[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < MAX_ENTRIES) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // not readable (permissions): left out
    }
    for (const e of entries) {
      seen++;
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) stack.push(p);
      } else if (e.isFile() && kindOf(e.name, "") !== "other") {
        try {
          const st = fs.statSync(p);
          if (st.size > 0 && st.size <= MAX_DOCUMENT_BYTES) out.push({ path: p, rel: path.relative(root, p), size: st.size, mtime: Math.round(st.mtimeMs) });
        } catch {
          // gone meanwhile
        }
      }
    }
  }
  return out;
}

type Row = { path: string; folder_id: string; rel: string; doc_id: number | null; size: number; mtime: number; missing_at: string | null };

/**
 * Every folder looked at: new files read in, changed ones updated, deleted ones marked. What was read in waits for the
 * reading (the caller starts it) — and, from a folder that waits for you, for your confirmation before any AI.
 */
export async function scanFolders(): Promise<{ added: number; updated: number; missing: number; errors: string[] }> {
  const d = db();
  const res = { added: 0, updated: 0, missing: 0, errors: [] as string[] };
  let budget = PER_RUN;
  const list = listFolders();
  for (const folder of list) {
    if (!fs.existsSync(folder.path)) {
      res.errors.push(t("“{path}” isn't there (a drive not connected?).", { path: folder.path }));
      continue;
    }
    const files = walk(folder.path);
    const known = new Map((d.prepare("select * from doc_local_files where folder_id = ?").all(folder.id) as Row[]).map((r) => [r.path, r]));
    const now = new Date().toISOString();
    for (const f of files) {
      const had = known.get(f.path);
      known.delete(f.path);
      if (had && had.size === f.size && had.mtime === f.mtime && !had.missing_at) continue;
      if (had && had.missing_at && had.size === f.size && had.mtime === f.mtime) {
        d.prepare("update doc_local_files set missing_at = null where path = ?").run(f.path);
        continue;
      }
      if (budget <= 0) continue;
      budget--;
      try {
        const data = fs.readFileSync(f.path);
        const name = path.basename(f.path);
        let docId: number;
        if (had?.doc_id) {
          docId = replaceDocument(had.doc_id, name, data).id;
          res.updated++;
        } else {
          const r = addDocument(name, data);
          docId = r.doc.id;
          if (r.fresh) res.added++;
        }
        // A folder that waits for you: the new or changed document waits (again) for your confirmation.
        if (folder.mode === "confirm") hold(docId);
        d.prepare("insert into doc_local_files (path, folder_id, rel, doc_id, size, mtime, missing_at) values (?, ?, ?, ?, ?, ?, null) on conflict(path) do update set folder_id = excluded.folder_id, rel = excluded.rel, doc_id = excluded.doc_id, size = excluded.size, mtime = excluded.mtime, missing_at = null").run(
          f.path,
          folder.id,
          f.rel,
          docId,
          f.size,
          f.mtime,
        );
      } catch (e) {
        res.errors.push(`${f.rel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // What's left of the known ones is gone from the folder: marked, its document kept.
    for (const r of known.values()) {
      if (r.missing_at) continue;
      d.prepare("update doc_local_files set missing_at = ? where path = ?").run(now, r.path);
      res.missing++;
    }
    folder.lastScanAt = now;
    folder.files = files.length;
  }
  save(list);
  return res;
}

/** The folder browser: a folder's subfolders (null: the drives, or / elsewhere) — hidden ones left out. */
export function browse(raw: string | null): { path: string | null; parent: string | null; dirs: { name: string; path: string }[] } {
  if (!raw) {
    if (process.platform === "win32") {
      const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((p) => fs.existsSync(p));
      return { path: null, parent: null, dirs: drives.map((p) => ({ name: p, path: p })) };
    }
    raw = "/";
  }
  const p = norm(raw);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch {
    throw new Error(t("“{path}” can't be opened.", { path: raw }));
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("$") && !SKIP_DIRS.has(e.name.toLowerCase()))
    .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 500);
  const up = path.dirname(p);
  return { path: p, parent: up === p ? null : up, dirs };
}
