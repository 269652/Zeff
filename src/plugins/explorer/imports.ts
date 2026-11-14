/**
 * Files imported into Documents from the Explorer: which file became which document (explorer_imports), so the Explorer shows
 * what is in Documents already and what changed since. Files read in from a watched folder (Documents' doc_local_files) count
 * too. A file imported again after it changed updates its document in place. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "@/db";
import { toHostPath, toLocalPath } from "@/lib/hostpath";
import { t } from "@/lib/i18n/server";
import { kindOf, MAX_DOCUMENT_BYTES } from "@/plugins/documents/shared";

/** At most this many files imported from one folder at once (a whole drive by mistake stays bounded). */
export const MAX_FOLDER_IMPORT = 500;
const SKIP_DIRS = new Set(["node_modules", "$recycle.bin", "system volume information", "__pycache__"]);

let made = false;
function db() {
  const d = getSqlite();
  if (!made) {
    d.exec("create table if not exists explorer_imports (path text primary key, doc_id integer not null, size integer not null, mtime integer not null, at text not null)");
    // (Documents' own table, made here too when the Explorer asks before Documents ever scanned a folder.)
    d.exec("create table if not exists doc_local_files (path text primary key, folder_id text not null, rel text not null, doc_id integer, size integer not null, mtime integer not null, missing_at text); create index if not exists doc_local_files_folder on doc_local_files (folder_id);");
    made = true;
  }
  return d;
}

const key = (p: string) => (process.platform === "win32" ? toLocalPath(p).toLowerCase() : toLocalPath(p));

/** For each file (the host's path, its size and time now): its document, and whether it changed since — only those in Documents. */
export function importState(files: { path: string; size: number; mtime: number }[]): Map<string, { docId: number; changed: boolean }> {
  const out = new Map<string, { docId: number; changed: boolean }>();
  if (!files.length) return out;
  const d = db();
  const known = new Map<string, { doc_id: number; size: number; mtime: number }>();
  // In chunks (SQLite's limit on parameters).
  for (let i = 0; i < files.length; i += 400) {
    const keys = files.slice(i, i + 400).map((f) => key(f.path));
    const marks = keys.map(() => "?").join(",");
    const col = process.platform === "win32" ? "lower(path)" : "path";
    for (const r of d.prepare(`select path, doc_id, size, mtime from doc_local_files where doc_id is not null and ${col} in (${marks})`).all(...keys) as { path: string; doc_id: number; size: number; mtime: number }[]) known.set(key(r.path), r);
    // What was imported here wins over the folder's (it is the later word on it).
    for (const r of d.prepare(`select path, doc_id, size, mtime from explorer_imports where ${col} in (${marks})`).all(...keys) as { path: string; doc_id: number; size: number; mtime: number }[]) known.set(key(r.path), r);
  }
  const live = existingDocs([...known.values()].map((r) => r.doc_id));
  for (const f of files) {
    const r = known.get(key(f.path));
    if (r && live.has(r.doc_id)) out.set(f.path, { docId: r.doc_id, changed: r.size !== f.size || Math.abs(r.mtime - f.mtime) > 1 });
  }
  return out;
}

/** Which of these documents are still there (one deleted in Documents: the file shows as not imported). */
function existingDocs(ids: number[]): Set<number> {
  if (!ids.length) return new Set();
  const uniq = [...new Set(ids)];
  const d = db();
  const out = new Set<number>();
  for (let i = 0; i < uniq.length; i += 400) {
    const part = uniq.slice(i, i + 400);
    for (const r of d.prepare(`select id from documents where id in (${part.map(() => "?").join(",")})`).all(...part) as { id: number }[]) out.add(r.id);
  }
  return out;
}

export type ImportResult = { added: number; updated: number; same: number; skipped: string[]; docIds: number[] };

/** Files imported into Documents (a changed one updates its document); reading them starts. */
export async function importFiles(paths: string[]): Promise<ImportResult> {
  const { addDocument, replaceDocument } = await import("@/plugins/documents/store");
  const d = db();
  const res: ImportResult = { added: 0, updated: 0, same: 0, skipped: [], docIds: [] };
  const state = importState(
    paths.flatMap((p) => {
      try {
        const st = fs.statSync(/*turbopackIgnore: true*/ toLocalPath(p));
        return [{ path: p, size: st.size, mtime: Math.round(st.mtimeMs) }];
      } catch {
        return [];
      }
    }),
  );
  for (const raw of paths) {
    const local = toLocalPath(raw);
    const name = path.basename(local);
    try {
      const st = fs.statSync(/*turbopackIgnore: true*/ local);
      if (!st.isFile()) throw new Error(t("not a file"));
      if (kindOf(name) === "other") throw new Error(t("Documents doesn't read this kind of file"));
      if (st.size === 0) throw new Error(t("empty"));
      if (st.size > MAX_DOCUMENT_BYTES) throw new Error(t("larger than {n} MB", { n: MAX_DOCUMENT_BYTES / 1024 / 1024 }));
      const had = state.get(raw);
      if (had && !had.changed) {
        res.same++;
        res.docIds.push(had.docId);
        continue;
      }
      const data = fs.readFileSync(/*turbopackIgnore: true*/ local);
      let docId: number;
      if (had) {
        docId = replaceDocument(had.docId, name, data).id;
        res.updated++;
      } else {
        const r = addDocument(name, data);
        docId = r.doc.id;
        if (r.fresh) res.added++;
        else res.same++;
      }
      res.docIds.push(docId);
      d.prepare("insert into explorer_imports (path, doc_id, size, mtime, at) values (?, ?, ?, ?, ?) on conflict(path) do update set doc_id = excluded.doc_id, size = excluded.size, mtime = excluded.mtime, at = excluded.at").run(
        toHostPath(local),
        docId,
        st.size,
        Math.round(st.mtimeMs),
        new Date().toISOString(),
      );
    } catch (e) {
      res.skipped.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (res.added || res.updated) (await import("@/plugins/documents/process")).startProcessing();
  return res;
}

/** The files of a folder Documents can read (subfolders too, hidden ones left out), at most MAX_FOLDER_IMPORT. */
export function readableFiles(folder: string): { files: string[]; cut: boolean } {
  const root = toLocalPath(folder);
  const out: string[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < 50_000) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      seen++;
      if (e.name.startsWith(".") || e.name.startsWith("~$") || e.name.startsWith("$")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) stack.push(p);
      } else if (e.isFile() && kindOf(e.name) !== "other") {
        if (out.length >= MAX_FOLDER_IMPORT) return { files: out, cut: true };
        out.push(toHostPath(p));
      }
    }
  }
  return { files: out, cut: false };
}
