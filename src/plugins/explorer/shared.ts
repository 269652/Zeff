/**
 * The Explorer's shapes and its rules about files — what a file is shown as, whether it can be edited, its editor's language.
 * Client-safe: no imports from server code.
 */

/** How a file is shown in the Explorer's viewer. */
export type ViewKind = "text" | "markdown" | "csv" | "image" | "pdf" | "audio" | "video" | "office" | "none";

/** One entry of a folder as the Explorer lists it. */
export type Entry = {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  /** Last change (ms since 1970); 0: not known. */
  mtime: number;
  /** In Documents: the document's id (imported here, or read in from a watched folder). */
  docId: number | null;
  /** Imported, but the file changed since. */
  changed: boolean;
};

/** A folder's listing: its entries, where it is and what Documents does with it. */
export type Listing = {
  /** null: "This PC" (the drives). */
  path: string | null;
  parent: string | null;
  entries: Entry[];
  /** The watched folder this one is in (or is), if any. */
  watched: { id: string; path: string; mode: "auto" | "confirm" } | null;
  /** More entries were there than shown. */
  cut: boolean;
};

/** A place in the side pane: the home folders, the watched folders, the drives. */
export type Place = { name: string; path: string; icon: string };
export type Places = { quick: Place[]; watched: (Place & { id: string; mode: "auto" | "confirm" })[]; drives: Place[] };

/** A file opened in the viewer. */
export type Opened = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  view: ViewKind;
  /** The text (text, markdown, csv; office: what Documents reads out of it). */
  text: string | null;
  /** May be changed and saved here. */
  editable: boolean;
  /** Why not (too large, not UTF-8 …). */
  readOnlyWhy: string | null;
  /** Monaco's language for it. */
  language: string;
  docId: number | null;
  changed: boolean;
  /** Can be imported into Documents (a kind Documents reads). */
  importable: boolean;
};

const EXT = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/** Text files by extension → Monaco's language. */
const TEXT_LANGS: Record<string, string> = {
  txt: "plaintext", log: "plaintext", ini: "ini", cfg: "ini", conf: "ini", env: "plaintext", srt: "plaintext", vtt: "plaintext", eml: "plaintext", ics: "plaintext", tex: "plaintext", rtf: "plaintext",
  json: "json", jsonc: "json", xml: "xml", svg: "xml", html: "html", htm: "html", css: "css", scss: "scss", less: "less",
  yaml: "yaml", yml: "yaml", toml: "ini", sql: "sql", sh: "shell", bash: "shell", ps1: "powershell", psm1: "powershell", bat: "bat", cmd: "bat",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", mts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", cs: "csharp", c: "c", h: "c", cpp: "cpp", hpp: "cpp", php: "php", lua: "lua", r: "r", swift: "swift",
  gitignore: "plaintext", editorconfig: "ini",
};
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);
const AUDIO = new Set(["mp3", "wav", "m4a", "ogg", "oga", "opus", "flac", "aac"]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const OFFICE = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp"]);

/** What a file is shown as, by its name. */
export function viewKind(name: string): ViewKind {
  const ext = EXT(name) || (name.startsWith(".") ? name.slice(1).toLowerCase() : "");
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "pdf") return "pdf";
  if (IMAGES.has(ext)) return "image";
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  if (OFFICE.has(ext)) return "office";
  if (ext in TEXT_LANGS) return "text";
  return "none";
}

/** Monaco's language for a file. */
export function languageOf(name: string): string {
  const ext = EXT(name) || (name.startsWith(".") ? name.slice(1).toLowerCase() : "");
  if (ext === "md" || ext === "markdown") return "markdown";
  return TEXT_LANGS[ext] ?? "plaintext";
}

/** Shown and edited as text (the viewer's editor). */
export const isTextual = (v: ViewKind) => v === "text" || v === "markdown" || v === "csv";

/** Text files larger than this are shown, not edited (the editor stays quick). */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
/** Text files larger than this aren't loaded into the viewer at all. */
export const MAX_VIEW_BYTES = 10 * 1024 * 1024;

export const ENTRY_ICONS: Record<ViewKind, string> = { text: "📄", markdown: "📝", csv: "📊", image: "🖼️", pdf: "📕", audio: "🎵", video: "🎬", office: "📘", none: "📎" };
export const entryIcon = (e: { dir: boolean; name: string }) => (e.dir ? "📁" : ENTRY_ICONS[viewKind(e.name)]);

/** The file's address for the viewer (pictures, PDFs, audio, video) and for downloading. */
export const fileUrl = (path: string, download = false) => `/api/explorer/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

/** A folder's or file's last part ("C:\" stays "C:\"). */
export function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return i < 0 || trimmed.length === 0 ? p : trimmed.slice(i + 1) || p;
}

/** A path cut into its folders, each with the path up to it — the address bar's crumbs. */
export function crumbs(p: string): { name: string; path: string }[] {
  const win = /^[A-Za-z]:/.test(p) || p.startsWith("\\\\");
  const sep = win ? "\\" : "/";
  const parts = p.split(/[\\/]+/).filter(Boolean);
  const out: { name: string; path: string }[] = [];
  let acc = win ? "" : "/";
  if (!win) out.push({ name: "/", path: "/" });
  for (const [i, part] of parts.entries()) {
    acc = win ? (i === 0 ? `${part}${sep}` : `${acc.replace(/[\\/]+$/, "")}${sep}${part}`) : `${acc.replace(/\/+$/, "")}/${part}`;
    out.push({ name: part, path: acc });
  }
  return out;
}

/** Simple CSV / TSV rows for the table preview (quotes understood, at most `max` rows). */
export function parseCsv(text: string, tab = false, max = 500): string[][] {
  const sep = tab ? "\t" : text.slice(0, 2000).split(";").length > text.slice(0, 2000).split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < max) rows.push([...row, cell]);
  return rows;
}

/** A place's entry in the Workspace tree (`?nav=` of the page) and back. */
export const navIdOf = (path: string) => `path:${path}`;
export const pathOfNav = (nav: string | null): string | null => (nav && nav.startsWith("path:") ? nav.slice(5) || null : null);
