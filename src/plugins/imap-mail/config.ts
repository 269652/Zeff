import { and, like, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { IMAP_ACCOUNT } from "@/lib/mail/shared";
import { providerById, providerOfHost, type ProviderId, type SmtpSecurity } from "./presets";

/**
 * The mail accounts read over IMAP or POP3 and written to over SMTP (Settings → E-Mail): several side by side, each with who
 * you are, its servers, its password, the folders read. Kept in the Zeff account's prefs like the other plugins' keys — the
 * password in plain text there, never shown again on a page. Server only.
 */

export type MailAccount = {
  /** Its id ("m…"), part of its conversations' ids: "imap:<id>:<thread>". */
  id: string;
  /** IMAP (folders, flags, a Sent folder) or POP3 (one inbox; nothing is deleted on the server). */
  method: "imap" | "pop3";
  provider: ProviderId;
  /** Its name in Zeff: its folders are called by it ("T-Online", "T-Online · Work"). */
  name: string;
  /** Your name as the people you write to see it (the From line). */
  senderName: string;
  address: string;
  /** The login name (empty: the address). */
  user: string;
  password: string;
  /** The incoming server (IMAP or POP3, as `method` says): TLS from the start (993 / 995), else STARTTLS (143 / 110). */
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  /** IMAP: the folders read (their paths on the server); the inbox by default. */
  folders: string[];
  /** IMAP: the server's folders, as the last test listed them (to choose from). */
  serverFolders: string[];
  /** IMAP: the folder sent mail is kept in — read too, and where a sent copy goes. */
  sentFolder: string;
  /** IMAP: a copy of what Zeff sends is put in the Sent folder (most servers don't do it themselves; T-Online doesn't). */
  saveSent: boolean;
  /** IMAP: where an archived mail goes (Gmail: All Mail) — found on the server when empty. */
  archiveFolder: string;
  /** A mail opened in Zeff is marked read — in Zeff, and on the server (IMAP: its \\Seen flag). */
  markReadOnOpen: boolean;
  /** How its last sync went. */
  lastSyncAt: string | null;
  lastResult: string | null;
  lastOk: boolean | null;
};
/** What a form or the old single setting gives (the rest from defaults). */
export type ImapConfig = MailAccount;

const KEY = "imap-mail.accounts";
/** The one mailbox of before (a single setting): moved into the list once. */
const LEGACY_KEY = "imap-mail.config";
const LEGACY_ID = "m1";

export const EMPTY_ACCOUNT: Omit<MailAccount, "id"> = {
  method: "imap",
  provider: "other",
  name: "",
  senderName: "",
  address: "",
  user: "",
  password: "",
  imapHost: "",
  imapPort: 993,
  imapTls: true,
  smtpHost: "",
  smtpPort: 465,
  smtpSecurity: "tls",
  folders: ["INBOX"],
  serverFolders: [],
  sentFolder: "",
  saveSent: true,
  archiveFolder: "",
  markReadOnOpen: true,
  lastSyncAt: null,
  lastResult: null,
  lastOk: null,
};

/** The mail accounts — the single mailbox of before moved into the list the first time (its mails' conversations with it). */
export function mailAccounts(): MailAccount[] {
  const list = getPref<MailAccount[] | null>(KEY, null);
  if (list) return list.map((a) => ({ ...EMPTY_ACCOUNT, ...a }));
  const legacy = getPref<Partial<MailAccount> | null>(LEGACY_KEY, null);
  if (!legacy) return [];
  const moved: MailAccount = { ...EMPTY_ACCOUNT, ...legacy, id: LEGACY_ID, method: "imap", provider: providerOfHost(legacy.imapHost ?? "") };
  setPref(KEY, [moved]);
  moveLegacyMails(LEGACY_ID);
  return [moved];
}

/** The mails kept before accounts had ids ("imap:<thread>") are the moved account's: "imap:<id>:<thread>", their keys alike. */
function moveLegacyMails(id: string): void {
  const db = getDb();
  const rows = db.select({ key: schema.emails.key, convId: schema.emails.convId }).from(schema.emails).where(like(schema.emails.convId, "imap:%")).all();
  db.transaction((tx) => {
    for (const r of rows) {
      if (IMAP_CONV.test(r.convId)) continue;
      const conv = `imap:${id}:${r.convId.slice("imap:".length)}`;
      const key = `${conv}|${r.key.split("|").at(-1)}`;
      tx.update(schema.emails).set({ convId: conv, key }).where(and(sql`${schema.emails.key} = ${r.key}`)).run();
    }
  });
}

export const getMailAccount = (id: string): MailAccount | null => mailAccounts().find((a) => a.id === id) ?? null;

const port = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return n > 0 && n < 65536 ? n : fallback;
};
const host = (v: string) => v.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/\s].*$/, "");
/** Folder names other channels own: an account isn't called so ("Gmail" would be read as Gmail's). */
const RESERVED = /^(gmail|outlook|whatsapp|signal|teams|posteingang|inbox|notifications)\b/i;

/** An account's name in Zeff: set, else its provider's or its address; never one another channel owns, never one another account has. */
function nameFor(a: MailAccount, others: MailAccount[]): string {
  // (What this adds — " (IMAP)" — comes back with the form when it is saved again: taken off first, so it is added once.)
  let name = a.name.trim().replace(/\s*\((?:IMAP|POP3)\)/gi, "").replace(/\s*[·/]\s*/g, " ").trim() || (a.provider !== "other" ? providerById(a.provider).name.replace(/\s*\(.*\)$/, "").replace(/\s*\/.*$/, "") : "") || a.address || IMAP_ACCOUNT;
  if (RESERVED.test(name)) name = `${name} (${a.method.toUpperCase()})`;
  const taken = new Set(others.filter((o) => o.id !== a.id).map((o) => mailboxName(o).toLowerCase()));
  for (let i = 2, base = name; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

/** A new account's id. */
const newId = (taken: MailAccount[]) => {
  for (let n = taken.length + 1; ; n++) if (!taken.some((a) => a.id === `m${n}`)) return `m${n}`;
};

/** An account added (`id` null) or changed: what's set changes; a password left empty (or not given) stays. The account saved. */
export function saveMailAccount(id: string | null, patch: Partial<MailAccount>): MailAccount {
  const all = mailAccounts();
  // Added once more (the form sent twice, or the same mailbox again): the account that is there, not a second one.
  const same = !id && patch.address ? all.find((a) => a.address.toLowerCase() === String(patch.address).trim().toLowerCase() && a.method === (patch.method ?? a.method)) : undefined;
  const cur: MailAccount = (id && all.find((a) => a.id === id)) || same || { ...EMPTY_ACCOUNT, id: newId(all) };
  const s = (k: keyof MailAccount) => (typeof patch[k] === "string" ? String(patch[k]).trim() : undefined);
  const folders = patch.folders?.map((f) => f.trim()).filter(Boolean);
  const method = patch.method === "pop3" ? "pop3" : patch.method === "imap" ? "imap" : cur.method;
  const next: MailAccount = {
    ...cur,
    method,
    provider: patch.provider ? providerById(patch.provider).id : cur.provider,
    name: s("name") ?? cur.name,
    senderName: s("senderName") ?? cur.senderName,
    address: s("address") ?? cur.address,
    user: s("user") ?? cur.user,
    password: patch.password ? patch.password : cur.password,
    imapHost: patch.imapHost !== undefined ? host(patch.imapHost) : cur.imapHost,
    imapPort: patch.imapPort !== undefined ? port(patch.imapPort, cur.imapPort) : cur.imapPort,
    imapTls: patch.imapTls ?? cur.imapTls,
    smtpHost: patch.smtpHost !== undefined ? host(patch.smtpHost) : cur.smtpHost,
    smtpPort: patch.smtpPort !== undefined ? port(patch.smtpPort, cur.smtpPort) : cur.smtpPort,
    smtpSecurity: patch.smtpSecurity === "starttls" ? "starttls" : patch.smtpSecurity === "tls" ? "tls" : cur.smtpSecurity,
    folders: folders ? [...new Set(folders.length ? folders : ["INBOX"])] : cur.folders,
    serverFolders: patch.serverFolders ?? cur.serverFolders,
    sentFolder: s("sentFolder") ?? cur.sentFolder,
    archiveFolder: s("archiveFolder") ?? cur.archiveFolder,
    // (POP3 has no folders: nowhere to put a copy.)
    saveSent: method === "pop3" ? false : (patch.saveSent ?? cur.saveSent),
    markReadOnOpen: patch.markReadOnOpen ?? cur.markReadOnOpen,
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : cur.lastSyncAt,
    lastResult: patch.lastResult !== undefined ? patch.lastResult : cur.lastResult,
    lastOk: patch.lastOk !== undefined ? patch.lastOk : cur.lastOk,
  };
  // Switched between IMAP and POP3: the incoming server and port follow, where they were the provider's (or the usual ones).
  const was = all.find((a) => a.id === next.id)?.method;
  if (was && was !== method) {
    const p = providerById(next.provider);
    const [from, to] = method === "pop3" ? [p.imap, p.pop3] : [p.pop3, p.imap];
    if (to.host && (!next.imapHost || next.imapHost === from.host)) next.imapHost = to.host;
    const ports: Record<number, number> = method === "pop3" ? { 993: 995, 143: 110 } : { 995: 993, 110: 143 };
    next.imapPort = ports[next.imapPort] ?? next.imapPort;
  }
  next.name = nameFor(next, all);
  setPref(KEY, all.some((a) => a.id === next.id) ? all.map((a) => (a.id === next.id ? next : a)) : [...all, next]);
  alignFolders(next);
  return next;
}

/**
 * The folders of an account's mails carry its name ("<name>", "<name> · Sent"): after a rename, the mails already kept move along — a
 * name made wrong once (the same suffix added again and again) is put right with the next save.
 */
export function alignFolders(a: Pick<MailAccount, "id" | "name">): void {
  const name = mailboxName(a);
  getDb().run(sql`update emails set folder = ${name} || substr(folder, instr(folder, ' · ')) where conv_id like ${`imap:${a.id}:%`} and instr(folder, ' · ') > 0 and folder not like ${`${name} · %`}`);
  getDb().run(sql`update emails set folder = ${name} where conv_id like ${`imap:${a.id}:%`} and instr(folder, ' · ') = 0 and folder != ${name}`);
}

/** An account removed (its mails stay kept, as yours). */
export function removeMailAccount(id: string): void {
  setPref(
    KEY,
    mailAccounts().filter((a) => a.id !== id),
  );
  setPref(pop3SeenKey(id), []);
}

/** Whether there is enough to sign in (address, password, both servers). */
export const accountReady = (c: Pick<MailAccount, "address" | "password" | "imapHost" | "smtpHost">): boolean => !!c.address && !!c.password && !!c.imapHost && !!c.smtpHost;

/** The name the account's folders carry. */
export const mailboxName = (c: Pick<MailAccount, "name">): string => c.name.trim() || IMAP_ACCOUNT;

/** A server folder's name in Zeff: the inbox is the account's own name, any other "<name> · <folder>". */
export const folderLabel = (c: Pick<MailAccount, "name">, path: string): string => (path.toUpperCase() === "INBOX" ? mailboxName(c) : `${mailboxName(c)} · ${path}`);

/** The login name: set, else the address. */
export const loginOf = (c: Pick<MailAccount, "user" | "address">): string => c.user.trim() || c.address.trim();

/** An account's conversation: "imap:<account>:<thread>" (POP3's too — one kind of mail for the rest of Zeff). */
export const IMAP_CONV = /^imap:(m\d+):(.+)$/;
export const imapConv = (accountId: string, thread: string) => `imap:${accountId}:${thread}`;
/** The account a conversation is in (null: not an account's). */
export const accountIdOfConv = (convId: string | null | undefined): string | null => IMAP_CONV.exec(convId ?? "")?.[1] ?? null;

/** The UIDLs of a POP3 account's messages kept already (it reads only the others). */
export const pop3SeenKey = (id: string) => `imap-mail.pop3seen.${id}`;

const text = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : undefined);

/** The form's values as settings (a password left empty: undefined — the one kept stays). */
export function settingsOfForm(fd: FormData): Partial<MailAccount> {
  const folders = fd.getAll("folders").map(String).flatMap((f) => f.split(/[,;\n]/)).map((f) => f.trim()).filter(Boolean);
  return {
    ...(text(fd, "method") ? { method: text(fd, "method") === "pop3" ? "pop3" : "imap" } : {}),
    ...(text(fd, "provider") ? { provider: providerById(text(fd, "provider")).id } : {}),
    name: text(fd, "name"),
    senderName: text(fd, "senderName"),
    address: text(fd, "address"),
    user: text(fd, "user"),
    ...(text(fd, "password") ? { password: text(fd, "password") } : {}),
    imapHost: text(fd, "imapHost"),
    imapPort: Number(text(fd, "imapPort")),
    imapTls: text(fd, "imapSecurity") !== "starttls",
    smtpHost: text(fd, "smtpHost"),
    smtpPort: Number(text(fd, "smtpPort")),
    smtpSecurity: text(fd, "smtpSecurity") === "starttls" ? "starttls" : "tls",
    // (The folder choice is on the form once the server's folders are known: none ticked — the inbox.)
    ...(fd.has("foldersShown") ? { folders: folders.length ? folders : ["INBOX"] } : {}),
    ...(fd.has("sentFolder") ? { sentFolder: text(fd, "sentFolder") ?? "" } : {}),
    ...(fd.has("archiveFolder") ? { archiveFolder: text(fd, "archiveFolder") ?? "" } : {}),
    saveSent: fd.get("saveSent") === "on",
    // (On the form whatever the method: shown as markReadShown, so an unticked box means off.)
    ...(fd.has("markReadShown") ? { markReadOnOpen: fd.get("markReadOnOpen") === "on" } : {}),
  };
}
