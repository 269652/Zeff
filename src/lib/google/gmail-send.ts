/**
 * Mail through Gmail's API: sent, saved as a draft (and a draft sent), a conversation archived or marked unread — always on
 * your click (a todo's action, a reply in the inbox; never an agent's tool) and only with Gmail's write access (the Connections
 * page). A reply goes into its conversation: Gmail's thread, and In-Reply-To / References from its last message. Nothing is
 * deleted or trashed (the writes go through write-guard.ts). Server only.
 */
import { apiGet } from "@/lib/connectors/http";
import { t } from "@/lib/i18n/server";
import { GM, header, type Msg } from "./gmail-api";
import { gmailCanWrite } from "./gmail-write";
import { googleWrite } from "./write-guard";

export type OutMail = {
  /** Recipients: "a@b.de", "Name <a@b.de>", several separated by "," or ";". */
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /** The conversation it answers ("gmail:<thread id>", or the bare id) — sent into it. */
  thread?: string;
};

/** A header value on one line (no line breaks: nothing smuggled in as a header of its own). */
const oneLine = (s: unknown) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

/** RFC 2047: a value with anything but printable ASCII as encoded words (UTF-8, base64), each at most 75 characters. */
export function encodeWords(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words: string[] = [];
  let chunk = "";
  // 45 bytes of UTF-8 are 60 characters of base64 — with "=?UTF-8?B?" and "?=" 72; a character is never split.
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** "a@b.de; Name <c@d.de>, …" → each recipient checked, its name encoded. */
function addresses(list: string | undefined, required: boolean): string | null {
  const parts = oneLine(list)
    .split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) {
    if (required) throw new Error(t("The mail needs a recipient."));
    return null;
  }
  return parts
    .map((p) => {
      const m = /^"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>$/.exec(p);
      const email = m ? m[2] : p;
      if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) throw new Error(t("Not a mail address: {address}", { address: p.slice(0, 80) }));
      const name = m?.[1]?.trim();
      if (!name) return email;
      return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}" <${email}>` : `${encodeWords(name)} <${email}>`;
    })
    .join(", ");
}

/** The text, base64, in lines of 76 (line breaks as CRLF). */
const base64Body = (text: string) =>
  Buffer.from(String(text ?? "").replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n")
    .replace(/\r\n$/, "");

/** The message as Gmail takes it (RFC 2822 / MIME, plain text in UTF-8) — with the reply headers when given. */
export function buildMime(m: Omit<OutMail, "thread"> & { inReplyTo?: string; references?: string }): string {
  const to = addresses(m.to, true)!;
  const cc = addresses(m.cc, false);
  const bcc = addresses(m.bcc, false);
  const head = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    // (Gmail takes the Bcc for the delivery and leaves it out of what the others get.)
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${encodeWords(oneLine(m.subject))}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${oneLine(m.inReplyTo)}`] : []),
    ...(m.references ? [`References: ${oneLine(m.references)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return `${head.join("\r\n")}\r\n\r\n${base64Body(m.body)}`;
}

/** Gmail's thread id of a conversation ("gmail:<id>" as Zeff keeps it, or the bare id) — else an error. */
export function threadIdOf(conv: string): string {
  const id = String(conv ?? "").trim().replace(/^gmail:/, "");
  if (!/^[0-9a-f]{6,}$/i.test(id)) throw new Error(t("Not a Gmail conversation."));
  return id.toLowerCase();
}

const stripRe = (s: string) => s.replace(/^\s*((re|aw|fw|fwd|wg)\s*:\s*)+/i, "").trim();

/** What a reply in a thread needs: its last message's Message-ID, the references so far, the subject. */
async function replyHeaders(threadId: string): Promise<{ inReplyTo: string; references: string; subject: string }> {
  const th = await apiGet<{ messages?: Msg[] }>("google", `${GM}/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
  const last = th.messages?.at(-1);
  if (!last) throw new Error(t("Gmail doesn't have this conversation (any more)."));
  const id = header(last, "message-id");
  const refs = header(last, "references");
  return { inReplyTo: id, references: [refs, id].filter(Boolean).join(" ").trim(), subject: header(th.messages![0], "subject") };
}

/** The raw message and its thread — a reply's headers looked up in its conversation. */
async function prepare(m: OutMail): Promise<{ raw: string; threadId?: string }> {
  if (!gmailCanWrite()) throw new Error(t("Google was only asked for read access to Gmail. Allow writing to Gmail on the Connections page and sign in to Google again."));
  let extra: { inReplyTo?: string; references?: string } = {};
  let subject = m.subject;
  let threadId: string | undefined;
  if (m.thread) {
    threadId = threadIdOf(m.thread);
    const r = await replyHeaders(threadId);
    extra = { inReplyTo: r.inReplyTo || undefined, references: r.references || undefined };
    // Gmail keeps a reply in its thread only when the subject is the thread's: an answer's own ("Re: …", "AW: …") stays.
    const base = stripRe(r.subject);
    if (base && stripRe(subject).toLowerCase() !== base.toLowerCase()) subject = `Re: ${base}`;
  }
  return { raw: Buffer.from(buildMime({ ...m, subject, ...extra }), "utf8").toString("base64url"), threadId };
}

const failed = (what: string, status: number, body: unknown): Error =>
  new Error(t("Gmail refused {what} ({status}): {why}", { what, status, why: JSON.stringify((body as { error?: { message?: string } })?.error?.message ?? body ?? "").slice(0, 200) }));

/** The mail sent — its id and its thread. */
export async function sendGmail(m: OutMail): Promise<{ id: string; threadId: string }> {
  const { raw, threadId } = await prepare(m);
  const r = await googleWrite<{ id: string; threadId: string }>("POST", `${GM}/messages/send`, { raw, ...(threadId ? { threadId } : {}) });
  if (r.status < 200 || r.status >= 300 || !r.body?.id) throw failed(t("the mail"), r.status, r.body);
  return { id: r.body.id, threadId: r.body.threadId };
}

/** The mail saved as a draft in Gmail (in its thread) — you find it there, or send it with {@link sendGmailDraft}. */
export async function createGmailDraft(m: OutMail): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const { raw, threadId } = await prepare(m);
  const r = await googleWrite<{ id: string; message?: { id: string; threadId: string } }>("POST", `${GM}/drafts`, { message: { raw, ...(threadId ? { threadId } : {}) } });
  if (r.status < 200 || r.status >= 300 || !r.body?.id) throw failed(t("the draft"), r.status, r.body);
  return { draftId: r.body.id, messageId: r.body.message?.id ?? "", threadId: r.body.message?.threadId ?? threadId ?? "" };
}

/** A draft of Gmail's sent as it is. */
export async function sendGmailDraft(draftId: string): Promise<{ id: string; threadId: string }> {
  if (!gmailCanWrite()) throw new Error(t("Google was only asked for read access to Gmail. Allow writing to Gmail on the Connections page and sign in to Google again."));
  const id = String(draftId ?? "").trim();
  if (!/^[\w-]+$/.test(id)) throw new Error(t("Not a Gmail draft."));
  const r = await googleWrite<{ id: string; threadId: string }>("POST", `${GM}/drafts/send`, { id });
  if (r.status < 200 || r.status >= 300 || !r.body?.id) throw failed(t("the draft"), r.status, r.body);
  return { id: r.body.id, threadId: r.body.threadId };
}

async function modifyThread(conv: string, change: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void> {
  const id = threadIdOf(conv);
  if (!gmailCanWrite()) throw new Error(t("Google was only asked for read access to Gmail. Allow writing to Gmail on the Connections page and sign in to Google again."));
  const r = await googleWrite("POST", `${GM}/threads/${id}/modify`, change);
  if (r.status < 200 || r.status >= 300) throw failed(t("the change"), r.status, r.body);
}

/** The conversation out of the inbox (archived: still in All Mail — nothing deleted). */
export const archiveGmail = (conv: string) => modifyThread(conv, { removeLabelIds: ["INBOX"] });

/** The conversation marked unread. */
export const markGmailUnread = (conv: string) => modifyThread(conv, { addLabelIds: ["UNREAD"] });
