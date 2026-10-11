import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ValidationError } from "@/lib/errors";
import { workDir } from "./log";

/**
 * Pictures and documents pasted or dropped into a session's chat: kept in the account's work folder
 * (attachments/<id>/<name>), given to the CLI as files to read — Claude reads images and PDFs itself.
 */
export const attachmentsDir = () => path.join(workDir(), "attachments");
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export type Attachment = { /** What the browser sends back to name it: "<id>/<file>". */ ref: string; name: string; size: number };

/** A file name that stays in its folder: no path, no odd characters, never empty. */
export function safeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[^\p{L}\p{N}._ ()-]+/gu, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return base || "datei";
}

/** Keep a file. */
export function saveAttachment(name: string, data: Buffer): Attachment {
  if (data.length === 0) throw new ValidationError(`„${name}“ ist leer.`);
  if (data.length > MAX_ATTACHMENT_BYTES) throw new ValidationError(`„${name}“ ist zu groß (höchstens ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).`);
  const id = randomUUID().slice(0, 12);
  const file = safeName(name);
  const dir = path.join(attachmentsDir(), id);
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, file), data);
  return { ref: `${id}/${file}`, name: file, size: data.length };
}

/** The kept files these refs name, with their full paths — only what this folder holds (refs come from the browser). */
export function resolveAttachments(refs: unknown): { name: string; path: string }[] {
  if (!Array.isArray(refs) || !refs.length) return [];
  if (refs.length > MAX_ATTACHMENTS) throw new ValidationError(`Höchstens ${MAX_ATTACHMENTS} Anhänge.`);
  return refs.map((r) => {
    const m = /^([a-f0-9-]{12})\/([^/\\]+)$/.exec(String(r));
    const file = m ? path.join(attachmentsDir(), m[1], m[2]) : "";
    if (!m || m[2] !== safeName(m[2]) || !fs.existsSync(/*turbopackIgnore: true*/ file)) throw new ValidationError("Ein Anhang gibt es nicht (mehr).");
    return { name: m[2], path: file };
  });
}

/** The attachments as the CLI gets them: where to read each — and how they show in your own message. */
export const attachmentsPrompt = (list: { name: string; path: string }[]) =>
  list.length ? `\n\n## Anhänge des Nutzers (Dateien — lies sie, bei Bedarf mit dem Read-Werkzeug; Bilder und PDFs kannst du ansehen)\n${list.map((a) => `- ${a.path}`).join("\n")}` : "";
export const attachmentsNote = (list: { name: string }[]) => (list.length ? `\n${list.map((a) => `📎 ${a.name}`).join("\n")}` : "");
