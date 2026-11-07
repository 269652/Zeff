import type { MailInput } from "@/lib/mail/store";
import { t } from "@/lib/i18n/server";
import { folderLabel, loginOf, mailboxName, type ImapConfig } from "./config";
import { hasAttachment, toMailInput, type ParsedMail } from "./map";

/**
 * The IMAP mailbox reached: read (the folders chosen and the Sent folder — examined read-only, so nothing is marked read),
 * tested (IMAP login and folder list, SMTP login), and a mail sent over SMTP with a copy put in the Sent folder. The IMAP and
 * SMTP clients are made through `deps` (imapflow and nodemailer by default) so tests run without a network. Server only.
 */

/** What Zeff uses of an IMAP client (imapflow's ImapFlow). */
export type ImapLike = {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(): Promise<{ path: string; specialUse?: string; flags?: Set<string> }[]>;
  getMailboxLock(path: string, o?: { readOnly?: boolean }): Promise<{ release(): void }>;
  mailbox: false | { uidValidity?: bigint | number | string };
  fetch(range: { since: Date }, query: Record<string, unknown>, o?: { uid?: boolean }): AsyncIterable<FetchedLike>;
  append(path: string, content: Buffer, flags?: string[], date?: Date): Promise<unknown>;
  search?(query: Record<string, unknown>, o?: { uid?: boolean }): Promise<number[] | false>;
  messageFlagsAdd?(range: number[], flags: string[], o?: { uid?: boolean }): Promise<unknown>;
  messageMove?(range: number[], destination: string, o?: { uid?: boolean }): Promise<unknown>;
};
export type FetchedLike = { uid: number; flags?: Set<string>; internalDate?: Date | string; bodyStructure?: Parameters<typeof hasAttachment>[0]; source?: Buffer };
/** What Zeff uses of an SMTP transport (nodemailer's). */
export type SmtpLike = { verify(): Promise<unknown>; sendMail(o: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>; close?(): void };
export type MailDeps = { imap?: (c: ImapConfig) => ImapLike | Promise<ImapLike>; smtp?: (c: ImapConfig) => SmtpLike | Promise<SmtpLike>; parse?: (source: Buffer) => Promise<ParsedMail>; pop3?: import("./pop3").Pop3Deps };

const TIMEOUT = 30000;

async function imapOf(c: ImapConfig, deps: MailDeps): Promise<ImapLike> {
  if (deps.imap) return deps.imap(c);
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapTls,
    auth: { user: loginOf(c), pass: c.password },
    logger: false,
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: 5 * 60000,
  } as ConstructorParameters<typeof ImapFlow>[0]) as unknown as ImapLike;
}

async function smtpOf(c: ImapConfig, deps: MailDeps): Promise<SmtpLike> {
  if (deps.smtp) return deps.smtp(c);
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecurity === "tls",
    requireTLS: c.smtpSecurity === "starttls",
    auth: { user: loginOf(c), pass: c.password },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: 60000,
  }) as unknown as SmtpLike;
}

async function parseOf(source: Buffer, deps: MailDeps): Promise<ParsedMail> {
  if (deps.parse) return deps.parse(source);
  const { simpleParser } = await import("mailparser");
  return (await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })) as unknown as ParsedMail;
}

/** A failure said so a person can act on it (a wrong password, a server that can't be reached), the server's words after it. */
export function explain(e: unknown, part: "IMAP" | "POP3" | "SMTP"): string {
  const x = e as { message?: string; code?: string; authenticationFailed?: boolean; responseText?: string; response?: string; responseCode?: number };
  const said = String(x?.responseText ?? x?.response ?? x?.message ?? e).slice(0, 200);
  if (x?.authenticationFailed || x?.code === "EAUTH" || x?.responseCode === 535 || /auth|login|credentials|password/i.test(said))
    return t("{part}: the server refused the login — check the user name and the password (T-Online: the separate e-mail password for mail programs). ({said})", { part, said });
  if (/ENOTFOUND|EAI_AGAIN/.test(String(x?.code ?? said))) return t("{part}: the server's name is unknown — check the host. ({said})", { part, said });
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout/i.test(String(x?.code ?? said))) return t("{part}: the server didn't answer — check the host, the port and the encryption. ({said})", { part, said });
  if (/certificate|SSL|TLS|wrong version/i.test(said)) return t("{part}: the encrypted connection failed — check the port and the encryption (TLS or STARTTLS). ({said})", { part, said });
  return `${part}: ${said}`;
}

/** The server's Sent folder: the one set, else the one it marks as \Sent, else one named so. */
export function sentFolderOf(list: { path: string; specialUse?: string }[], set = ""): string {
  if (set && list.some((f) => f.path === set)) return set;
  return list.find((f) => f.specialUse === "\\Sent")?.path ?? list.find((f) => /^(inbox[./])?(sent|gesendet|gesendete (objekte|elemente)|sent (items|messages))$/i.test(f.path))?.path ?? "";
}

async function withImap<T>(c: ImapConfig, deps: MailDeps, run: (client: ImapLike) => Promise<T>): Promise<T> {
  const client = await imapOf(c, deps);
  try {
    await client.connect();
  } catch (e) {
    throw new Error(explain(e, "IMAP"));
  }
  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** The messages of the last `days` in the folders chosen and the Sent folder — none marked read. Folders the server doesn't have: `missing`. */
export async function readImap(c: ImapConfig, o: { days: number; now?: number }, deps: MailDeps = {}): Promise<{ messages: MailInput[]; missing: string[] }> {
  const since = new Date((o.now ?? Date.now()) - o.days * 864e5);
  return withImap(c, deps, async (client) => {
    const list = await client.list();
    const have = new Set(list.map((f) => f.path));
    const sent = sentFolderOf(list, c.sentFolder);
    const wanted = [...new Set([...(c.folders.length ? c.folders : ["INBOX"]), ...(sent ? [sent] : [])])];
    const missing = wanted.filter((p) => !have.has(p) && p.toUpperCase() !== "INBOX");
    const messages: MailInput[] = [];
    for (const path of wanted.filter((p) => !missing.includes(p))) {
      // EXAMINE (read-only): fetching a message can never set its \Seen flag.
      const lock = await client.getMailboxLock(path, { readOnly: true });
      const fetched: FetchedLike[] = [];
      let uidValidity = "";
      try {
        uidValidity = String((client.mailbox && client.mailbox.uidValidity) ?? "");
        // The text is in the first part of a message: its first 64 KB (BODY.PEEK[]<0.65536>), not its attachments.
        for await (const m of client.fetch({ since }, { uid: true, flags: true, internalDate: true, bodyStructure: true, source: { maxLength: 65536 } }, { uid: true })) fetched.push(m);
      } finally {
        lock.release();
      }
      for (const m of fetched) {
        const parsed = m.source ? await parseOf(m.source, deps).catch(() => ({}) as ParsedMail) : ({} as ParsedMail);
        messages.push(
          toMailInput(parsed, {
            account: c.id,
            path,
            uidValidity,
            uid: m.uid,
            flags: m.flags ?? [],
            internalDate: m.internalDate,
            hasAttachments: hasAttachment(m.bodyStructure),
            folder: folderLabel(c, path),
            mailbox: mailboxName(c),
            sent: path === sent,
            me: c.address,
          }),
        );
      }
    }
    return { messages, missing };
  });
}

/** IMAP (its folders and the Sent folder listed) or POP3 signed in, and SMTP signed in. Each part says how it went. */
export async function testImap(c: ImapConfig, deps: MailDeps = {}): Promise<{ ok: boolean; imap: string; smtp: string; folders: string[]; sentFolder: string }> {
  let folders: string[] = [];
  let sentFolder = "";
  let imap: string;
  let ok = true;
  if (c.method === "pop3") {
    try {
      imap = await (await import("./pop3")).testPop3(c, deps.pop3);
    } catch (e) {
      ok = false;
      imap = explain(e, "POP3");
    }
  } else {
    try {
      const list = await withImap(c, deps, (client) => client.list());
      folders = list.map((f) => f.path).sort((a, b) => (a.toUpperCase() === "INBOX" ? -1 : b.toUpperCase() === "INBOX" ? 1 : a.localeCompare(b)));
      sentFolder = sentFolderOf(list, c.sentFolder);
      imap = t("IMAP: signed in, {n} folders.", { n: folders.length });
    } catch (e) {
      ok = false;
      imap = e instanceof Error && e.message.startsWith("IMAP") ? e.message : explain(e, "IMAP");
    }
  }
  let smtp: string;
  const transport = await smtpOf(c, deps);
  try {
    await transport.verify();
    smtp = t("SMTP: signed in, ready to send.");
  } catch (e) {
    ok = false;
    smtp = explain(e, "SMTP");
  } finally {
    transport.close?.();
  }
  return { ok, imap, smtp, folders, sentFolder };
}

/** Mails flagged read (\\Seen) on the server, found by their Message-ID in their folders. How many were found. */
export async function markSeenImap(c: ImapConfig, items: { path: string; messageId: string }[], deps: MailDeps = {}): Promise<number> {
  const byPath = new Map<string, string[]>();
  for (const i of items) byPath.set(i.path, [...(byPath.get(i.path) ?? []), i.messageId]);
  return withImap(c, deps, async (client) => {
    if (!client.search || !client.messageFlagsAdd) throw new Error("This IMAP client can't set flags.");
    let found = 0;
    for (const [path, ids] of byPath) {
      // (Opened for writing: a flag is set — nothing else is changed.)
      const lock = await client.getMailboxLock(path);
      try {
        for (const id of ids) {
          const uids = await client.search({ header: { "message-id": id } }, { uid: true });
          if (!uids || !uids.length) continue;
          await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
          found += uids.length;
        }
      } finally {
        lock.release();
      }
    }
    return found;
  });
}

/** The folder archived mail goes to: the one set, else the server's archive (\\Archive), else Gmail's All Mail (\\All), else one called so. */
export function archiveFolderOf(list: { path: string; specialUse?: string }[], set = ""): string {
  if (set && list.some((f) => f.path === set)) return set;
  return list.find((f) => f.specialUse === "\\Archive")?.path ?? list.find((f) => f.specialUse === "\\All")?.path ?? list.find((f) => /^(inbox[./])?(archive|archiv)$/i.test(f.path))?.path ?? "";
}

/** Mails moved to the archive on the server, found by their Message-ID in their folders. Where they went, and how many. */
export async function archiveImap(c: ImapConfig, items: { path: string; messageId: string }[], deps: MailDeps = {}): Promise<{ folder: string; moved: number }> {
  return withImap(c, deps, async (client) => {
    if (!client.search || !client.messageMove) throw new Error("This IMAP client can't move mails.");
    const folder = archiveFolderOf(await client.list(), c.archiveFolder);
    if (!folder) throw new Error("The server has no archive folder — choose one in the account's settings.");
    const byPath = new Map<string, string[]>();
    for (const i of items) if (i.path !== folder) byPath.set(i.path, [...(byPath.get(i.path) ?? []), i.messageId]);
    let moved = 0;
    for (const [path, ids] of byPath) {
      const lock = await client.getMailboxLock(path);
      try {
        for (const id of ids) {
          const uids = await client.search({ header: { "message-id": id } }, { uid: true });
          if (!uids || !uids.length) continue;
          await client.messageMove(uids, folder, { uid: true });
          moved += uids.length;
        }
      } finally {
        lock.release();
      }
    }
    return { folder, moved };
  });
}

export type OutMail = { to: string; cc?: string; subject: string; body: string; inReplyTo?: string; references?: string[] };

/** The mail as it goes out (MIME, built by nodemailer): its bytes, its Message-ID and its recipients. */
export async function buildMail(c: ImapConfig, m: OutMail): Promise<{ raw: Buffer; messageId: string; to: string[] }> {
  const nodemailer = await import("nodemailer");
  const one = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const ids = (list: string[]) => list.map((x) => `<${x.replace(/^<|>$/g, "")}>`);
  const info = (await builder.sendMail({
    from: c.senderName.trim() ? { name: one(c.senderName), address: c.address } : c.address,
    to: one(m.to).replace(/;/g, ","),
    ...(m.cc?.trim() ? { cc: one(m.cc).replace(/;/g, ",") } : {}),
    subject: one(m.subject),
    text: m.body,
    ...(m.inReplyTo ? { inReplyTo: ids([m.inReplyTo])[0] } : {}),
    ...(m.references?.length ? { references: ids(m.references) } : {}),
  })) as unknown as { message: Buffer; messageId: string; envelope: { to: string[] } };
  if (!info.envelope?.to?.length) throw new Error(t("The mail needs a recipient."));
  return { raw: info.message, messageId: info.messageId.replace(/^<|>$/g, ""), to: info.envelope.to };
}

/**
 * The mail sent over SMTP — then, when set (most servers don't do it themselves), a copy put in the Sent folder over IMAP. A copy
 * that couldn't be put there is said (`copy`), the mail is sent all the same.
 */
export async function sendImapMail(c: ImapConfig, m: OutMail, deps: MailDeps = {}): Promise<{ messageId: string; to: string[]; copy: string | null }> {
  const mail = await buildMail(c, m);
  const transport = await smtpOf(c, deps);
  try {
    await transport.sendMail({ envelope: { from: c.address, to: mail.to }, raw: mail.raw });
  } catch (e) {
    throw new Error(explain(e, "SMTP"));
  } finally {
    transport.close?.();
  }
  let copy: string | null = null;
  if (c.saveSent) {
    try {
      await withImap(c, deps, async (client) => {
        const sent = sentFolderOf(await client.list(), c.sentFolder);
        if (!sent) throw new Error(t("the server has no Sent folder"));
        await client.append(sent, mail.raw, ["\\Seen"], new Date());
      });
    } catch (e) {
      copy = t("Sent, but no copy was put in the Sent folder: {error}", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { messageId: mail.messageId, to: mail.to, copy };
}
