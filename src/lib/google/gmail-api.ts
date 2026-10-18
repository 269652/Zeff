/**
 * Gmail through Google's REST API with an OAuth sign-in (read-only) — the other driver next to the
 * automation Chrome (src/plugins/gmail/driver.mjs): `readGmail` gives what its `gmail_mail` gives,
 * `gmailApiCall` answers its `gmail_attachments` / `gmail_download`. One account: the one signed in
 * on the Connections page. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { apiGet } from "@/lib/connectors/http";
import type { MailInput } from "@/lib/mail/store";

export const GM = "/gmail/v1/users/me";

type Part = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: Part[] };
export type Msg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

export const flat = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
export const enc = encodeURIComponent;

/** Gmail's snippet comes HTML-escaped. */
export const unescapeHtml = (s: string) => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The id the Chrome driver names a message by (msg-f:<decimal>) — the same rows whichever driver reads. */
export const refOf = (id: string) => `msg-f:${BigInt(`0x${id}`).toString()}`;
/** …and back: the API's hex id of a ref (a bare hex id is accepted too). */
export function apiId(ref: string): string {
  const m = /^msg-f:(\d+)$/.exec(String(ref ?? "").trim());
  if (m) return BigInt(m[1]).toString(16);
  if (/^[0-9a-f]{8,}$/i.test(String(ref ?? "").trim())) return String(ref).trim().toLowerCase();
  throw new Error(`Not a Gmail message id: ${String(ref).slice(0, 40)}`);
}

export const header = (m: Msg | Part, name: string): string => (m as Msg).payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? (m as Part).headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** "Name <a@b.de>" → name and address. */
export function parseFrom(v: string): { name: string; email: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v);
  if (m) return { name: flat(m[1]) || m[2], email: m[2].trim().toLowerCase() };
  const bare = v.trim();
  return { name: bare, email: bare.includes("@") ? bare.toLowerCase() : null };
}

const decode = (data: string | undefined) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

function walk(p: Part | undefined, out: Part[] = []): Part[] {
  if (!p) return out;
  out.push(p);
  for (const c of p.parts ?? []) walk(c, out);
  return out;
}

/** A message's text without what it quotes: the plain part (else the HTML one, stripped). */
function bodyText(p: Part | undefined): string {
  const parts = walk(p).filter((x) => !x.filename);
  const plain = parts.filter((x) => x.mimeType === "text/plain" && x.body?.data).map((x) => decode(x.body!.data)).join("\n");
  let text = plain;
  if (!text.trim()) {
    const html = parts.filter((x) => x.mimeType === "text/html" && x.body?.data).map((x) => decode(x.body!.data)).join("\n");
    text = html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
    text = unescapeHtml(text.replace(/&nbsp;/g, " "));
  }
  const lines: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (/^\s*(On .+ wrote:|Am .+ schrieb .*:|-{2,}\s*(Original|Ursprüngliche|Forwarded)|_{5,})/i.test(l)) break;
    if (/^\s*>/.test(l)) continue;
    lines.push(l);
  }
  return flat(lines.join(" "));
}

export type ApiAttachment = { id: string; name: string; mime: string; size: number; inline: boolean; attachmentId?: string; data?: string };

function attachmentsOf(p: Part | undefined): ApiAttachment[] {
  const out: ApiAttachment[] = [];
  for (const x of walk(p)) {
    if (!x.filename || !(x.body?.attachmentId || x.body?.data)) continue;
    const cid = header(x, "content-id");
    const dispo = header(x, "content-disposition").toLowerCase();
    out.push({
      id: String(out.length),
      name: x.filename,
      mime: x.mimeType || "application/octet-stream",
      size: x.body.size ?? 0,
      inline: dispo.startsWith("inline") || (!!cid && !dispo.startsWith("attachment")),
      attachmentId: x.body.attachmentId,
      data: x.body.data,
    });
  }
  return out;
}

/** All pages (up to `maxPages`) of a message search: the ids. */
export async function search(q: string, maxPages: number): Promise<{ id: string; threadId: string }[]> {
  const out: { id: string; threadId: string }[] = [];
  let token = "";
  for (let i = 0; i < maxPages; i++) {
    const r = await apiGet<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("google", `${GM}/messages?q=${enc(q)}&maxResults=100${token ? `&pageToken=${enc(token)}` : ""}`);
    out.push(...(r.messages ?? []));
    token = r.nextPageToken ?? "";
    if (!token) break;
  }
  return out;
}

/** `fn` over the items, a few at a time (Gmail allows about 250 quota units a second per user; a message read costs 5). */
async function each<T, R>(items: T[], fn: (x: T) => Promise<R>, width = 4): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += width) out.push(...(await Promise.all(items.slice(i, i + width).map(fn))));
  return out;
}

export const getMeta = (id: string) => apiGet<Msg>("google", `${GM}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);

function toInput(m: Msg, folder: string, o: { attach: boolean; text?: string }): MailInput {
  const mine = !!m.labelIds?.includes("SENT");
  const from = parseFrom(header(m, "from"));
  const full = !!o.text;
  return {
    id: refOf(m.id),
    convId: `gmail:${m.threadId}`,
    folder,
    from: mine ? "Ich" : from.name,
    fromEmail: mine ? null : from.email,
    subject: flat(header(m, "subject")),
    preview: full ? o.text!.slice(0, 1000) : flat(unescapeHtml(m.snippet ?? "")),
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    unread: mine ? false : !!m.labelIds?.includes("UNREAD"),
    ...(full ? { full: true } : {}),
    hasAttachments: o.attach,
  };
}

/**
 * The inbox's mails of the last days (and what you sent), plus — `conversations` — every
 * conversation you wrote in, whole, with the full text of the messages not in `fullKnown`.
 * Nothing is opened or marked read.
 */
export async function readGmail(o: { days: number; maxPages?: number; folder?: string; fullKnown?: string[] }): Promise<{ messages: MailInput[] }> {
  const folder = o.folder ?? "Gmail";
  const span = Math.min(120, Math.max(1, Math.round(Number(o.days) || 3)));
  const maxPages = Math.min(30, Math.max(1, Number(o.maxPages) || 10));
  const messages: MailInput[] = [];
  const have = new Set<string>();
  const sentThreads = new Map<string, string>();
  for (const box of ["inbox", "sent"] as const) {
    const q = `in:${box} newer_than:${span}d`;
    const ids = await search(q, maxPages);
    const withAttachment = new Set((await search(`${q} has:attachment`, maxPages)).map((x) => x.id));
    const metas = await each(ids, (x) => getMeta(x.id));
    for (const m of metas) {
      const input = toInput(m, folder, { attach: withAttachment.has(m.id) });
      if (!input.subject || have.has(input.id!)) continue;
      have.add(input.id!);
      messages.push(input);
      if (box === "sent" && !sentThreads.has(m.threadId)) sentThreads.set(m.threadId, input.subject);
    }
  }
  const known = new Set(o.fullKnown ?? []);
  for (const threadId of [...sentThreads.keys()].slice(0, 25)) {
    let thread: { messages?: Msg[] };
    try {
      thread = await apiGet<{ messages?: Msg[] }>("google", `${GM}/threads/${threadId}?format=full`);
    } catch {
      continue; // one conversation that can't be read: the rest still
    }
    for (const m of thread.messages ?? []) {
      const ref = refOf(m.id);
      const text = known.has(ref) ? "" : bodyText(m.payload);
      const input = toInput(m, folder, { attach: attachmentsOf(m.payload).some((a) => !a.inline), text });
      if (!input.subject) continue;
      if (have.has(ref)) {
        // Seen in the lists already: its full text, if read now.
        if (input.full) {
          const i = messages.findIndex((x) => x.id === ref);
          messages[i] = { ...messages[i], preview: input.preview, full: true };
        }
      } else {
        messages.push(input);
        have.add(ref);
      }
    }
  }
  return { messages };
}

const fileSafe = (name: string) => String(name).replace(/[\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "file";

async function listAttachments(ref: string): Promise<ApiAttachment[]> {
  const m = await apiGet<Msg>("google", `${GM}/messages/${apiId(ref)}?format=full`);
  return attachmentsOf(m.payload);
}

/** The driver's `gmail_attachments` / `gmail_download` for the mail sync's attachment step — through the API. */
export async function gmailApiCall(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ref = String(args.ref ?? "");
  if (tool === "gmail_attachments") {
    const list = await listAttachments(ref);
    return { opened: false, attachments: list.map(({ attachmentId: _a, data: _d, ...a }) => a) };
  }
  if (tool === "gmail_download") {
    const dir = String(args.dir ?? "");
    if (!dir) throw new Error("dir is required.");
    const maxBytes = Number(args.maxBytes) || 0;
    const want = new Set((Array.isArray(args.ids) ? args.ids : []).map(String));
    const files: { id: string; name: string; mime: string; size: number; path: string }[] = [];
    const skipped: { id: string; why: string }[] = [];
    fs.mkdirSync(dir, { recursive: true });
    for (const a of await listAttachments(ref)) {
      if (want.size && !want.has(a.id)) continue;
      if (maxBytes > 0 && a.size > maxBytes) {
        skipped.push({ id: a.id, why: "too large" });
        continue;
      }
      const b64 = a.data ?? (await apiGet<{ data?: string }>("google", `${GM}/messages/${apiId(ref)}/attachments/${a.attachmentId}`)).data;
      const buf = Buffer.from(b64 ?? "", "base64url");
      const p = path.join(dir, `${a.id}-${fileSafe(a.name)}`);
      fs.writeFileSync(p, buf);
      files.push({ id: a.id, name: a.name, mime: a.mime, size: buf.length, path: p });
    }
    return { opened: false, files, skipped };
  }
  throw new Error(`Unknown tool "${tool}".`);
}
