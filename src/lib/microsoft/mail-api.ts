/**
 * Outlook Mail through Microsoft Graph (the "api" driver): the same mails the automation Chrome's
 * Outlook driver (src/plugins/outlook/driver.mjs, outlook_mail) reads from the list — and the
 * attachments of one mail (outlook_attachments / outlook_download). Read-only: Mail.Read. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { apiGet } from "@/lib/connectors/http";
import { t } from "@/lib/i18n/server";
import type { MailInput } from "@/lib/mail/store";

type Folder = { id: string; displayName: string };
type GraphMail = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
};
type Page<T> = { value?: T[]; "@odata.nextLink"?: string };

/** At most this many mails per folder (the driver reads ~1000 rows too). */
const MAX_PER_FOLDER = 1000;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Folder names (German or English, as Outlook shows them) → Graph's well-known folder names. */
const WELL_KNOWN: Record<string, string> = {
  posteingang: "inbox",
  inbox: "inbox",
  "gesendete elemente": "sentitems",
  gesendet: "sentitems",
  "sent items": "sentitems",
  sent: "sentitems",
  entwurfe: "drafts",
  drafts: "drafts",
  "geloschte elemente": "deleteditems",
  "deleted items": "deleteditems",
  "junk-e-mail": "junkemail",
  "junk email": "junkemail",
  archiv: "archive",
  archive: "archive",
};

const enc = encodeURIComponent;

async function pages<T>(first: string, max: number): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = first;
  for (let i = 0; next && i < 50 && out.length < max; i++) {
    const page: Page<T> = await apiGet<Page<T>>("microsoft", next);
    out.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }
  return out;
}

/** The folder names asked for, as folder ids (or well-known names) — and the ones Outlook doesn't have. */
async function resolveFolders(names: string[]): Promise<{ folders: { name: string; id: string }[]; missing: string[] }> {
  const top = await pages<Folder>("/me/mailFolders?$top=100&$select=id,displayName", 500);
  // The inbox's own subfolders count too (notification folders usually live there).
  let all = top;
  const inbox = top.find((f) => WELL_KNOWN[norm(f.displayName)] === "inbox");
  if (inbox) all = [...top, ...(await pages<Folder>(`/me/mailFolders/${enc(inbox.id)}/childFolders?$top=100&$select=id,displayName`, 500).catch(() => []))];
  const folders: { name: string; id: string }[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const hit = all.find((f) => norm(f.displayName) === norm(name));
    const known = WELL_KNOWN[norm(name)];
    if (hit) folders.push({ name, id: hit.id });
    else if (known) folders.push({ name, id: known });
    else missing.push(name);
  }
  return { folders, missing };
}

/** The mails of the last `days` days in these folders — as the Outlook driver gives them. */
export async function readMail({ days, folders }: { days: number; folders: string[] }): Promise<{ messages: MailInput[]; missing: string[] }> {
  const { folders: found, missing } = await resolveFolders(folders.length ? folders : ["Posteingang"]);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const messages: MailInput[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const q = new URLSearchParams({
      $filter: `receivedDateTime ge ${since}`,
      $orderby: "receivedDateTime desc",
      $select: "id,conversationId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,from",
      $top: "100",
    });
    // A folder Outlook doesn't have (a well-known name for a folder that isn't there): not found.
    let list: GraphMail[];
    try {
      list = await pages<GraphMail>(`/me/mailFolders/${enc(f.id)}/messages?${q.toString().replaceAll("+", "%20")}`, MAX_PER_FOLDER);
    } catch (e) {
      if (/answered 404/.test(String((e as Error)?.message))) {
        missing.push(f.name);
        continue;
      }
      throw e;
    }
    for (const m of list) {
      if (!m.id || seen.has(m.id) || !m.conversationId) continue;
      seen.add(m.id);
      const from = m.from?.emailAddress;
      messages.push({
        convId: m.conversationId,
        folder: f.name,
        from: from?.name || from?.address || "",
        fromEmail: from?.address ?? null,
        subject: m.subject ?? "",
        preview: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 1000),
        receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime).toISOString() : null,
        unread: m.isRead === false,
        hasAttachments: !!m.hasAttachments,
        ...(m.hasAttachments ? { attachRef: m.id } : {}),
      });
    }
  }
  return { messages, missing };
}

// ---------------------------------------------------------------------------
// Attachments (the same answers as the driver's outlook_attachments / outlook_download)
// ---------------------------------------------------------------------------

type GraphAttachment = { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean; "@odata.type"?: string; contentBytes?: string };

const isFile = (a: GraphAttachment) => !a["@odata.type"] || /fileAttachment$/i.test(a["@odata.type"]);

const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "file";

/** One mail's file attachments (name, size, type) — the mail is not opened, so nothing is marked read. */
export async function listAttachments(ref: string): Promise<{ opened: false; restoredUnread: false; attachments: { id: string; name: string; mime: string; size: number; inline: boolean }[] }> {
  if (!ref) throw new Error(t("{what} is required.", { what: "ref" }));
  const list = await pages<GraphAttachment>(`/me/messages/${enc(ref)}/attachments?$select=id,name,contentType,size,isInline`, 200);
  const attachments = list.filter(isFile).map((a) => ({ id: a.id, name: a.name ?? "file", mime: a.contentType ?? "", size: a.size ?? 0, inline: !!a.isInline }));
  return { opened: false, restoredUnread: false, attachments };
}

/** The chosen attachments (none chosen: all) saved into `dir`. */
export async function downloadAttachments({ ref, ids = [], dir, maxBytes = 0 }: { ref: string; ids?: string[]; dir: string; maxBytes?: number }) {
  if (!dir) throw new Error(t("{what} is required.", { what: "dir" }));
  fs.mkdirSync(dir, { recursive: true });
  const want = new Set(ids.map(String));
  const listed = (await listAttachments(ref)).attachments;
  const files: { id: string; name: string; mime: string; size: number; path: string }[] = [];
  const skipped: { id: string; why: string }[] = [];
  for (const a of listed) {
    if (want.size && !want.has(a.id)) continue;
    if (maxBytes > 0 && a.size > maxBytes) {
      skipped.push({ id: a.id, why: "too large" });
      continue;
    }
    try {
      const full = await apiGet<GraphAttachment>("microsoft", `/me/messages/${enc(ref)}/attachments/${enc(a.id)}`);
      if (typeof full.contentBytes !== "string") throw new Error(t("no file content"));
      const buf = Buffer.from(full.contentBytes, "base64");
      const p = path.join(dir, `${a.id.slice(-24).replace(/[^\w-]/g, "")}-${fileSafe(a.name)}`);
      fs.writeFileSync(p, buf);
      files.push({ id: a.id, name: a.name, mime: a.mime, size: buf.length, path: p });
    } catch (e) {
      skipped.push({ id: a.id, why: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }
  return { opened: false, restoredUnread: false, files, skipped };
}

/** The driver's attachment tools, answered through Graph (the same calls the attachments step makes on the Chrome driver). */
export async function outlookApiCall(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ref = String(args.ref ?? "");
  if (tool === "outlook_attachments") return listAttachments(ref);
  if (tool === "outlook_download") {
    return downloadAttachments({ ref, ids: Array.isArray(args.ids) ? args.ids.map(String) : [], dir: String(args.dir ?? ""), maxBytes: Number(args.maxBytes) || 0 });
  }
  throw new Error(t("Unknown tool \"{tool}\".", { tool }));
}
