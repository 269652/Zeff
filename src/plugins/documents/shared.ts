/**
 * Documents (the Documents plugin) — what pages and the server share: a document as the UI shows it,
 * its kinds and states, the ref a todo keeps it by. Client-safe.
 */

export const DOC_KINDS = ["text", "office", "pdf", "image", "audio", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_STATUSES = ["queued", "extracting", "ready", "failed", "unsupported"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export type DocView = {
  id: number;
  /** "doc:12" — how a todo keeps it. */
  ref: string;
  name: string;
  mime: string;
  size: number;
  kind: DocKind;
  status: DocStatus;
  error: string;
  /** The knowledge server's abstract — or, until it compiled it, the beginning of its text (`compiled`: false). */
  abstract: string;
  concepts: string[];
  compiled: boolean;
  /** How much text was read from it. */
  chars: number;
  createdAt: string;
  updatedAt: string;
};

export const docRef = (id: number) => `doc:${id}`;
export const docIdOf = (ref: string): number | null => (/^doc:\d+$/.test(ref) ? Number(ref.slice(4)) : null);

const EXT = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "log", "yaml", "yml", "ini", "rtf", "srt", "vtt", "eml", "ics", "tex"]);
const OFFICE_EXT = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "oga", "opus", "flac", "aac", "wma", "webm", "amr"]);

/** A file's kind, by its name and type. */
export function kindOf(name: string, mime = ""): DocKind {
  const ext = EXT(name);
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (OFFICE_EXT.has(ext)) return "office";
  if (IMAGE_EXT.has(ext) || /^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime)) return "image";
  if (AUDIO_EXT.has(ext) || mime.startsWith("audio/")) return "audio";
  if (TEXT_EXT.has(ext) || mime.startsWith("text/") || /json|xml/.test(mime)) return "text";
  return "other";
}

export const KIND_ICONS: Record<DocKind, string> = { text: "📄", office: "📝", pdf: "📕", image: "🖼️", audio: "🎙️", other: "📎" };

/** "12 KB", "3.4 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Largest file taken in. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
