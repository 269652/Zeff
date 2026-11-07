/**
 * Mail attachments → Documents: the settings and the rules that decide what is taken — pure (no
 * database, no browser), so pages, the sync step and the tests share them. Client-safe.
 */
import { MAX_DOCUMENT_BYTES } from "@/plugins/documents/shared";

export const ATTACHMENT_SOURCES = ["outlook", "gmail"] as const;
export type AttachmentSource = (typeof ATTACHMENT_SOURCES)[number];

/**
 * Whether the driver can hand over a mail's attachments without opening it in the web app (so
 * without marking it read). Gmail: yes (its "original message" address, verified); Outlook: no — the
 * mail is opened by its id (an unread one may be marked read there).
 */
export const SOURCE_QUIET: Record<AttachmentSource, boolean> = { outlook: false, gmail: true };

export type AttachmentSettings = {
  /** Off by default: nothing is fetched until you turn it on. */
  enabled: boolean;
  sources: Record<AttachmentSource, boolean>;
  /** "sync": after every mail sync; "manual": only on “Fetch attachments now”. */
  when: "sync" | "manual";
  /** How far back mails are looked at — also what a first run catches up on. */
  days: number;
  /** Largest file taken, in MB (at most the Documents limit). */
  maxMB: number;
  kinds: { documents: boolean; pictures: boolean; audio: boolean; other: boolean };
  /** Pictures smaller than this (KB) are skipped: signatures, logos, tracking pixels. */
  minPictureKB: number;
  /** "skip": mails still unread are left alone; "include": opened too (and marked unread again where Zeff can). */
  unread: "skip" | "include";
  /** Only these folders (names as in the Messages page); none: all that are synced. */
  onlyFolders: string[];
  /** Only from these senders or domains (comma-separated); none: from anyone. */
  onlyFrom: string[];
  /** Never from these senders or domains. */
  neverFrom: string[];
};

export const DEFAULT_ATTACHMENT_SETTINGS: AttachmentSettings = {
  enabled: false,
  sources: { outlook: true, gmail: true },
  when: "sync",
  days: 14,
  maxMB: 25,
  kinds: { documents: true, pictures: true, audio: false, other: false },
  minPictureKB: 30,
  unread: "skip",
  onlyFolders: [],
  onlyFrom: [],
  neverFrom: [],
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** "a@b.com, b.org; c" → each entry once, lower-cased. */
export function parseList(v: unknown): string[] {
  const text = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
  return [...new Set(text.split(/[,;\n]/).map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))].slice(0, 100);
}

/** Folder names keep their case ("Posteingang"), each once. */
const folderList = (v: unknown): string[] => {
  const text = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
  return [...new Set(text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 30);
};

/** The settings as stored (anything, even nothing) → complete and within bounds. */
export function parseAttachmentSettings(raw: unknown): AttachmentSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ATTACHMENT_SETTINGS;
  const src = (o.sources && typeof o.sources === "object" ? o.sources : {}) as Record<string, unknown>;
  const kinds = (o.kinds && typeof o.kinds === "object" ? o.kinds : {}) as Record<string, unknown>;
  return {
    enabled: bool(o.enabled, d.enabled),
    sources: { outlook: bool(src.outlook, d.sources.outlook), gmail: bool(src.gmail, d.sources.gmail) },
    when: o.when === "manual" ? "manual" : "sync",
    days: clamp(o.days, 1, 120, d.days),
    maxMB: clamp(o.maxMB, 1, MAX_DOCUMENT_BYTES / 1024 / 1024, d.maxMB),
    kinds: { documents: bool(kinds.documents, d.kinds.documents), pictures: bool(kinds.pictures, d.kinds.pictures), audio: bool(kinds.audio, d.kinds.audio), other: bool(kinds.other, d.kinds.other) },
    minPictureKB: clamp(o.minPictureKB, 0, 5120, d.minPictureKB),
    unread: o.unread === "include" ? "include" : "skip",
    onlyFolders: folderList(o.onlyFolders),
    onlyFrom: parseList(o.onlyFrom),
    neverFrom: parseList(o.neverFrom),
  };
}

// ---------------------------------------------------------------------------
// What an attachment is
// ---------------------------------------------------------------------------

/**
 * Never downloaded, whatever the settings: programs, scripts and installers. Not configurable (the
 * Mail page's settings list it). Judged by the name's last extension ("invoice.pdf.exe" is blocked) and the file type.
 */
export const BLOCKED_EXTENSIONS = [
  "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "ps1", "ps1xml", "psm1", "psd1", "vbs", "vbe", "vb", "js", "jse", "mjs", "wsf", "wsh", "ws", "jar", "dll", "sys", "lnk", "url", "iso", "vhd", "reg", "inf", "hta", "cpl", "msc", "gadget", "scf", "cab", "appx", "msix", "apk", "ipa", "dmg", "pkg", "app", "sh", "run", "bin", "deb", "rpm", "docm", "xlsm", "pptm", "xlam", "dotm",
] as const;
const BLOCKED = new Set<string>(BLOCKED_EXTENSIONS);
const BLOCKED_MIME = /^application\/(x-msdownload|x-msdos-program|x-dosexec|vnd\.microsoft\.portable-executable|x-executable|x-sh|x-csh|x-bat|java-archive|x-java-archive|x-msi|x-ms-installer|x-apple-diskimage|vnd\.android\.package-archive)$/i;

const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name.trim())?.[1] ?? "").toLowerCase();
const DOCUMENT_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "log", "yaml", "yml", "tex"]);
const PICTURE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "oga", "opus", "flac", "aac", "wma", "amr"]);

export type AttachmentKind = "blocked" | "document" | "picture" | "audio" | "other";

/** Whether a file is something that must never be downloaded (a program, script or installer). */
export function isBlocked(name: string, mime = ""): boolean {
  if (BLOCKED_MIME.test(mime.trim())) return true;
  // Only the last extension decides (what the system runs by): "report.pdf.exe" is blocked, "www.shop.com.pdf" is a PDF.
  return BLOCKED.has(ext(name));
}

/** What kind of attachment this is, by its name and type. */
export function attachmentKind(name: string, mime = ""): AttachmentKind {
  if (isBlocked(name, mime)) return "blocked";
  const e = ext(name);
  const m = mime.toLowerCase();
  if (e === "pdf" || DOCUMENT_EXT.has(e)) return "document";
  if (PICTURE_EXT.has(e)) return "picture";
  if (AUDIO_EXT.has(e)) return "audio";
  if (!e) {
    if (m === "application/pdf" || m.startsWith("text/plain") || m.startsWith("text/csv") || /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(m)) return "document";
    if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(m)) return "picture";
    if (m.startsWith("audio/")) return "audio";
  }
  return "other";
}

export type AttachmentFacts = { name: string; mime?: string; size: number };
export type Decision = { take: true } | { take: false; why: "blocked" | "kind" | "large" | "empty" | "small-picture" };

/** Whether an attachment is taken: blocklist first, then its kind, then its size. */
export function decideAttachment(a: AttachmentFacts, s: AttachmentSettings): Decision {
  const kind = attachmentKind(a.name, a.mime);
  if (kind === "blocked") return { take: false, why: "blocked" };
  if (a.size <= 0) return { take: false, why: "empty" };
  const on = kind === "document" ? s.kinds.documents : kind === "picture" ? s.kinds.pictures : kind === "audio" ? s.kinds.audio : s.kinds.other;
  if (!on) return { take: false, why: "kind" };
  if (a.size > Math.min(s.maxMB * 1024 * 1024, MAX_DOCUMENT_BYTES)) return { take: false, why: "large" };
  if (kind === "picture" && a.size < s.minPictureKB * 1024) return { take: false, why: "small-picture" };
  return { take: true };
}

/** Largest file in bytes the settings allow. */
export const maxBytesOf = (s: AttachmentSettings) => Math.min(s.maxMB * 1024 * 1024, MAX_DOCUMENT_BYTES);

// ---------------------------------------------------------------------------
// Which mails
// ---------------------------------------------------------------------------

/**
 * Whether a mail may be looked into. Mails still unread are the "to do" signal — opening one in the
 * web app can mark it read — so they are left alone unless a source hands over attachments without
 * opening (Gmail) or you allowed it.
 */
export function mayOpenMail(m: { unread: boolean }, source: AttachmentSource, s: AttachmentSettings): boolean {
  return !m.unread || SOURCE_QUIET[source] || s.unread === "include";
}

/** Whether a mail was received within the last `days` days. */
export function inWindow(receivedAt: string, days: number, now = Date.now()): boolean {
  const t = Date.parse(receivedAt);
  return Number.isFinite(t) && t >= now - days * 864e5;
}

const matchesEntry = (email: string, entry: string) => {
  if (entry.includes("@")) return email === entry;
  return email.endsWith(`@${entry}`) || email.endsWith(`.${entry}`);
};

/** Whether a sender passes the “only from” / “never from” lists (a full address or a domain, subdomains included). */
export function senderAllowed(fromEmail: string | null | undefined, s: Pick<AttachmentSettings, "onlyFrom" | "neverFrom">): boolean {
  const email = (fromEmail ?? "").trim().toLowerCase();
  if (email && s.neverFrom.some((e) => matchesEntry(email, e))) return false;
  if (s.onlyFrom.length) return !!email && s.onlyFrom.some((e) => matchesEntry(email, e));
  return true;
}

/** Whether a folder passes the folder list (none: all). */
export const folderAllowed = (folder: string, s: Pick<AttachmentSettings, "onlyFolders">) =>
  !s.onlyFolders.length || s.onlyFolders.some((f) => f.toLowerCase() === folder.toLowerCase());

/** Which source a mail came from (by its conversation id), or null for chats. */
export function mailSourceOf(convId: string): AttachmentSource | null {
  if (convId.startsWith("gmail:")) return "gmail";
  // (An IMAP mailbox's attachments aren't fetched yet: like a chat's, none.)
  if (/^(wa|sg|imap):/.test(convId)) return null;
  return "outlook";
}

/** An attachment's identity within a mail. */
export const attachmentKey = (a: { name: string; size: number }) => `${a.name}|${a.size}`;

/** A document's file name that keeps its mail's subject: "<subject> - <file>" within the store's 120-character cut. */
export function documentName(subject: string, file: string): string {
  const clean = subject.replace(/^((re|aw|wg|fwd?|antw)\s*:\s*)+/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  const room = 120 - file.length - 3;
  return room >= 8 && clean ? `${clean.slice(0, room).trim()} - ${file}` : file;
}
