/**
 * The Explorer on the disk: a folder's entries, the places of the side pane, a file opened for the viewer, a text file saved.
 * Paths are the host's (Windows: C:\…); in Docker they are mapped to the mounted folders (lib/hostpath). Server only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toHostPath, toLocalPath } from "@/lib/hostpath";
import { t } from "@/lib/i18n/server";
import { listFolders } from "@/plugins/documents/folders";
import { kindOf, MAX_DOCUMENT_BYTES } from "@/plugins/documents/shared";
import { importState } from "./imports";
import { isTextual, languageOf, MAX_EDIT_BYTES, MAX_VIEW_BYTES, viewKind, type Entry, type Listing, type Opened, type Places } from "./shared";

/** At most this many entries listed per folder (a folder of 100 000 files stays quick). */
const MAX_ENTRIES = 5000;

/** A path given by the page: absolute, normalised, a drive's root kept as "C:\". */
export function normPath(raw: string): string {
  const given = toLocalPath(String(raw ?? "").trim());
  if (!given) throw new Error(t("No path given."));
  const abs = path.resolve(/^[A-Za-z]:$/.test(given) ? `${given}\\` : given);
  const root = path.parse(abs).root;
  return abs.replace(/[\\/]+$/, "") === root.replace(/[\\/]+$/, "") ? root : abs.replace(/[\\/]+$/, "");
}

const under = (child: string, parent: string) => {
  const c = process.platform === "win32" ? child.toLowerCase() : child;
  const p = (process.platform === "win32" ? parent.toLowerCase() : parent).replace(/[\\/]+$/, "");
  return c === p || c.startsWith(`${p}${path.sep}`) || c.startsWith(`${p}/`);
};

/** The watched folder (Documents' local folders) a path is in, if any. */
export function watchedFolderOf(p: string): Listing["watched"] {
  const f = listFolders().find((x) => under(p, toLocalPath(x.path)));
  return f ? { id: f.id, path: f.path, mode: f.mode } : null;
}

/** The drives (Windows) or "/" and the mounted folders (elsewhere). */
function drives(): { name: string; path: string }[] {
  if (process.platform === "win32") return "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((p) => fs.existsSync(p)).map((p) => ({ name: p, path: p }));
  return [{ name: "/", path: "/" }];
}

/** The side pane: home, desktop, documents, downloads, pictures (those there), the watched folders, the drives. */
export function places(): Places {
  const home = os.homedir();
  const quick = [
    { name: t("Home"), path: home, icon: "🏠" },
    { name: t("Desktop"), path: path.join(home, "Desktop"), icon: "🖥️" },
    { name: t("Documents"), path: path.join(home, "Documents"), icon: "📂" },
    { name: t("Downloads"), path: path.join(home, "Downloads"), icon: "⬇️" },
    { name: t("Pictures"), path: path.join(home, "Pictures"), icon: "🖼️" },
  ].filter((p) => fs.existsSync(p.path));
  const watched = listFolders().map((f) => ({ id: f.id, mode: f.mode, name: path.basename(f.path) || f.path, path: f.path, icon: "👁️" }));
  return { quick, watched, drives: drives().map((d) => ({ ...d, icon: "💽" })) };
}

/** A folder's entries (null: the drives): folders first, then files, by name — hidden ones and system folders left out. */
export function listDir(raw: string | null): Listing {
  if (!raw) return { path: null, parent: null, entries: drives().map((d) => ({ name: d.name, path: d.path, dir: true, size: 0, mtime: 0, docId: null, changed: false })), watched: null, cut: false };
  const p = normPath(raw);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(/*turbopackIgnore: true*/ p, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(t("“{path}” isn't there.", { path: raw }));
    if (code === "ENOTDIR") throw new Error(t("“{path}” is a file, not a folder.", { path: raw }));
    throw new Error(t("“{path}” can't be opened.", { path: raw }));
  }
  const visible = dirents.filter((d) => !d.name.startsWith(".") && !d.name.startsWith("$") && !d.name.startsWith("~$") && !/^(desktop\.ini|thumbs\.db|ntuser\.dat.*)$/i.test(d.name));
  const cut = visible.length > MAX_ENTRIES;
  const entries: Entry[] = [];
  for (const d of visible.slice(0, MAX_ENTRIES)) {
    const full = path.join(p, d.name);
    let size = 0;
    let mtime = 0;
    let dir = d.isDirectory();
    try {
      const st = fs.statSync(/*turbopackIgnore: true*/ full);
      dir = st.isDirectory();
      size = dir ? 0 : st.size;
      mtime = Math.round(st.mtimeMs);
    } catch {
      // a broken link, a locked system file: listed without its numbers
    }
    entries.push({ name: d.name, path: toHostPath(full), dir, size, mtime, docId: null, changed: false });
  }
  const state = importState(entries.filter((e) => !e.dir).map((e) => ({ path: e.path, size: e.size, mtime: e.mtime })));
  for (const e of entries) {
    const s = state.get(e.path);
    if (s) Object.assign(e, s);
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.dir ? -1 : 1));
  const up = path.dirname(p);
  return { path: toHostPath(p), parent: up === p ? null : toHostPath(up), entries, watched: watchedFolderOf(p), cut };
}

/** Decoded as UTF-8 if it is UTF-8 (a BOM dropped); null: it isn't text this editor can keep as it is. */
function utf8(buf: Buffer): string | null {
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

/** A file opened for the viewer: its kind, its text where it has one (Office files: the text Documents reads out of them). */
export async function openFile(raw: string): Promise<Opened> {
  const p = normPath(raw);
  const st = fs.statSync(/*turbopackIgnore: true*/ p);
  if (st.isDirectory()) throw new Error(t("“{path}” is a folder.", { path: raw }));
  const name = path.basename(p);
  const view = viewKind(name);
  const host = toHostPath(p);
  const state = importState([{ path: host, size: st.size, mtime: Math.round(st.mtimeMs) }]).get(host);
  const base: Opened = {
    path: host,
    name,
    size: st.size,
    mtime: Math.round(st.mtimeMs),
    view,
    text: null,
    editable: false,
    readOnlyWhy: null,
    language: languageOf(name),
    docId: state?.docId ?? null,
    changed: state?.changed ?? false,
    importable: kindOf(name) !== "other" && st.size > 0 && st.size <= MAX_DOCUMENT_BYTES,
  };
  if (isTextual(view)) {
    if (st.size > MAX_VIEW_BYTES) return { ...base, readOnlyWhy: t("Too large to show here ({n} MB at most).", { n: MAX_VIEW_BYTES / 1024 / 1024 }) };
    const buf = fs.readFileSync(/*turbopackIgnore: true*/ p);
    const text = utf8(buf);
    if (text === null) return { ...base, text: new TextDecoder("latin1").decode(buf), readOnlyWhy: t("Not UTF-8 text — shown, but not editable here (saving would change its characters).") };
    if (st.size > MAX_EDIT_BYTES) return { ...base, text, readOnlyWhy: t("Too large to edit here ({n} MB at most).", { n: MAX_EDIT_BYTES / 1024 / 1024 }) };
    return { ...base, text, editable: true };
  }
  if (view === "office") {
    try {
      const { extractText } = await import("@/plugins/documents/extract");
      return { ...base, text: await extractText(p, name, "office", { lane: "fast" }) };
    } catch {
      return { ...base, readOnlyWhy: t("Its text couldn't be read.") };
    }
  }
  return base;
}

/** A text file saved — refused when it changed on the disk since it was opened (`mtime`: what it was then). Answers its new time. */
export function saveText(raw: string, text: string, mtime: number): { mtime: number; size: number } {
  const p = normPath(raw);
  const name = path.basename(p);
  if (!isTextual(viewKind(name))) throw new Error(t("Only text files can be edited here."));
  const data = Buffer.from(String(text), "utf8");
  if (data.length > MAX_EDIT_BYTES) throw new Error(t("Too large to edit here ({n} MB at most).", { n: MAX_EDIT_BYTES / 1024 / 1024 }));
  let had: fs.Stats | null = null;
  try {
    had = fs.statSync(/*turbopackIgnore: true*/ p);
  } catch {
    // a new file
  }
  if (had && mtime && Math.round(had.mtimeMs) !== Math.round(mtime)) throw new Error(t("“{name}” was changed on the disk since you opened it — open it again to see the change.", { name }));
  if (had) {
    // Keep a BOM the file had (some programs need it).
    const old = fs.readFileSync(/*turbopackIgnore: true*/ p);
    if (utf8(old) === null) throw new Error(t("Not UTF-8 text — shown, but not editable here (saving would change its characters)."));
    const bom = old[0] === 0xef && old[1] === 0xbb && old[2] === 0xbf;
    fs.writeFileSync(/*turbopackIgnore: true*/ p, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), data]) : data);
  } else fs.writeFileSync(/*turbopackIgnore: true*/ p, data, { flag: "wx" });
  const st = fs.statSync(/*turbopackIgnore: true*/ p);
  return { mtime: Math.round(st.mtimeMs), size: st.size };
}

/** A name for a new file or folder: no path in it, nothing Windows refuses. */
function cleanName(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name) || /[. ]$/.test(name)) throw new Error(t("“{name}” can't be a file name.", { name }));
  return name;
}

/** A new folder in a folder; its path. */
export function makeFolder(parent: string, name: string): string {
  const p = path.join(normPath(parent), cleanName(name));
  if (fs.existsSync(p)) throw new Error(t("“{name}” is already there.", { name }));
  fs.mkdirSync(/*turbopackIgnore: true*/ p);
  return toHostPath(p);
}

/** A new, empty text file in a folder; its path. */
export function makeTextFile(parent: string, name: string): string {
  const clean = cleanName(name);
  const withExt = clean.includes(".") ? clean : `${clean}.txt`;
  if (!isTextual(viewKind(withExt))) throw new Error(t("Only text files can be made here (.txt, .md, .csv …)."));
  const p = path.join(normPath(parent), withExt);
  if (fs.existsSync(p)) throw new Error(t("“{name}” is already there.", { name: withExt }));
  fs.writeFileSync(/*turbopackIgnore: true*/ p, "", { flag: "wx" });
  return toHostPath(p);
}

/** Whether Zeff can hand a file to this computer's own programs (not in a container, not on a server without a desktop). */
export const canOpenHere = (): boolean => !process.env.ZEFF_PATH_MAP && !fs.existsSync("/.dockerenv") && (process.platform === "win32" || process.platform === "darwin" || !!process.env.DISPLAY);

/** What would run rather than open (programs, scripts, shortcuts). */
const RUNS = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|cpl|lnk|url|reg|jar|appref-ms|sh|command|app)$/i;

/** The file opened with the program Windows (macOS, Linux) opens it with — or, `reveal`, shown in Windows Explorer. */
export async function openHere(raw: string, reveal = false): Promise<void> {
  if (!canOpenHere()) throw new Error(t("Zeff can't open programs on this computer (it runs in a container or without a desktop)."));
  const p = normPath(raw);
  if (!fs.existsSync(p)) throw new Error(t("“{path}” isn't there.", { path: raw }));
  // Programs and scripts are never started from here — only shown in their folder.
  if (!reveal && RUNS.test(p)) throw new Error(t("Programs and scripts aren't started from Zeff — use “Show in folder”."));
  const { spawn } = await import("node:child_process");
  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", reveal ? [`/select,${p}`] : [p]] : process.platform === "darwin" ? ["open", reveal ? ["-R", p] : [p]] : ["xdg-open", [reveal ? path.dirname(p) : p]];
  const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => undefined);
  child.unref();
}
