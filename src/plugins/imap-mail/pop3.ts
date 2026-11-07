import type { Duplex } from "node:stream";
import { getPref, setPref } from "@/lib/prefs";
import type { MailInput } from "@/lib/mail/store";
import { t } from "@/lib/i18n/server";
import { loginOf, mailboxName, pop3SeenKey, type MailAccount } from "./config";
import { messageIds, toMailInput, type ParsedMail } from "./map";

/**
 * A POP3 mailbox read: a tiny client (RFC 1939 — USER/PASS, UIDL, TOP or RETR, QUIT; STLS for STARTTLS) that never deletes
 * anything on the server (no DELE is ever sent). It reads only the messages whose UIDL it hasn't kept yet — the first time the
 * newest few hundred, the older ones counted as read — into one folder, the account's name. Server only.
 */

/** The connection made (already encrypted) — tests hand in a plain socket to a fake server. */
export type Pop3Deps = { connect?: (c: MailAccount) => Promise<Duplex>; parse?: (source: Buffer) => Promise<ParsedMail> };

/** How many messages the first read takes (the newest). */
export const POP3_FIRST_READ = 200;
/** How much of a message is read (TOP): its header and the first lines of its text. */
const TOP_LINES = 300;
const TIMEOUT = 30000;

/** A POP3 conversation on a socket: one command, its answer (one line, or a multi-line one up to "."). */
export class Pop3Session {
  private buf = "";
  private wake: (() => void) | null = null;
  private failed: Error | null = null;

  constructor(private sock: Duplex) {
    this.listen(sock);
  }

  private listen(sock: Duplex) {
    sock.on("data", (d: Buffer) => {
      // latin1: one character per byte — the message's bytes come back unchanged.
      this.buf += d.toString("latin1");
      this.wake?.();
    });
    sock.on("error", (e: Error) => ((this.failed = e), this.wake?.()));
    sock.on("close", () => ((this.failed ??= new Error("POP3: the server closed the connection.")), this.wake?.()));
  }

  /** The socket upgraded (STLS): the encrypted one takes over. */
  rebind(sock: Duplex) {
    this.sock = sock;
    this.failed = null;
    this.listen(sock);
  }

  private async until(end: string): Promise<string> {
    const started = Date.now();
    for (;;) {
      const i = this.buf.indexOf(end);
      if (i >= 0) {
        const out = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + end.length);
        return out;
      }
      if (this.failed) throw this.failed;
      if (Date.now() - started > TIMEOUT) throw new Error("POP3: timeout");
      await new Promise<void>((r) => {
        this.wake = r;
        setTimeout(r, 1000).unref();
      });
      this.wake = null;
    }
  }

  /** The server's one-line answer ("+OK …"); "-ERR …" throws. */
  async line(): Promise<string> {
    const l = await this.until("\r\n");
    if (!l.startsWith("+OK")) throw Object.assign(new Error(`POP3: ${l.replace(/^-ERR\s*/, "") || "error"}`), { response: l });
    return l;
  }

  /** A command and its one-line answer. */
  async cmd(command: string): Promise<string> {
    this.sock.write(`${command}\r\n`);
    return this.line();
  }

  /** A command and its multi-line answer (dot-unstuffed, without the status line). */
  async multi(command: string): Promise<string> {
    await this.cmd(command);
    const lines: string[] = [];
    for (let l = await this.until("\r\n"); l !== "."; l = await this.until("\r\n")) lines.push(l.startsWith("..") ? l.slice(1) : l);
    return lines.join("\r\n");
  }

  end() {
    this.sock.end();
  }
}

/** The account's server reached: TLS from the start (995), or plain and then STLS (110). */
async function open(c: MailAccount, deps: Pop3Deps): Promise<Pop3Session> {
  if (deps.connect) {
    const s = new Pop3Session(await deps.connect(c));
    await s.line();
    return s;
  }
  const tls = await import("node:tls");
  const net = await import("node:net");
  if (c.imapTls) {
    const sock = tls.connect({ host: c.imapHost, port: c.imapPort, servername: c.imapHost, timeout: TIMEOUT });
    const s = new Pop3Session(sock);
    await s.line();
    return s;
  }
  const raw = net.connect({ host: c.imapHost, port: c.imapPort, timeout: TIMEOUT });
  const s = new Pop3Session(raw);
  await s.line();
  await s.cmd("STLS");
  const secure = tls.connect({ socket: raw, servername: c.imapHost });
  await new Promise<void>((ok, fail) => secure.once("secureConnect", ok).once("error", fail));
  s.rebind(secure);
  return s;
}

/** Signed in (USER / PASS) — the session, closed by `run`'s end with QUIT (nothing marked for deletion: nothing is deleted). */
export async function withPop3<T>(c: MailAccount, deps: Pop3Deps, run: (s: Pop3Session) => Promise<T>): Promise<T> {
  const s = await open(c, deps);
  try {
    await s.cmd(`USER ${loginOf(c)}`);
    await s.cmd(`PASS ${c.password}`);
    const out = await run(s);
    await s.cmd("QUIT").catch(() => undefined);
    return out;
  } finally {
    s.end();
  }
}

async function parseOf(source: Buffer, deps: Pop3Deps): Promise<ParsedMail> {
  if (deps.parse) return deps.parse(source);
  const { simpleParser } = await import("mailparser");
  return (await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })) as unknown as ParsedMail;
}

/** "1 abc\r\n2 def" → [[1, "abc"], [2, "def"]]. */
const uidlsOf = (text: string): [number, string][] =>
  text
    .split("\r\n")
    .map((l) => /^(\d+)\s+(\S+)/.exec(l))
    .flatMap((m) => (m ? [[Number(m[1]), m[2]] as [number, string]] : []));

/**
 * The account's new messages (their UIDL not kept yet) — the first time the newest POP3_FIRST_READ, counted as read. `remember`:
 * what to keep as read once they are saved (the UIDLs the server has now; one gone from the server is forgotten).
 */
export async function readPop3(c: MailAccount, deps: Pop3Deps = {}): Promise<{ messages: MailInput[]; missing: string[]; remember: () => void }> {
  const known = new Set(getPref<string[]>(pop3SeenKey(c.id), []));
  const first = known.size === 0;
  return withPop3(c, deps, async (s) => {
    const all = uidlsOf(await s.multi("UIDL"));
    const fresh = all.filter(([, uid]) => !known.has(uid)).sort((a, b) => a[0] - b[0]);
    const take = first ? fresh.slice(-POP3_FIRST_READ) : fresh;
    const messages: MailInput[] = [];
    for (const [n, uidl] of take) {
      // TOP: the header and the first lines (attachments stay on the server); a server without TOP: RETR, the whole.
      const text = await s.multi(`TOP ${n} ${TOP_LINES}`).catch(() => s.multi(`RETR ${n}`));
      const source = Buffer.from(text, "latin1");
      const parsed = await parseOf(source, deps).catch(() => ({}) as ParsedMail);
      const m = toMailInput(parsed, {
        account: c.id,
        path: "INBOX",
        uidValidity: "pop3",
        uid: n,
        flags: first ? ["\\Seen"] : [],
        hasAttachments: /^content-disposition:\s*attachment/im.test(text) || /^content-type:\s*multipart\/mixed/im.test(text),
        folder: mailboxName(c),
        mailbox: mailboxName(c),
        sent: false,
        me: c.address,
      });
      // (No Message-ID: the UIDL is its lasting id — the message number isn't.)
      if (!messageIds(parsed.messageId).length) {
        const id = `${c.id}:uidl:${uidl}`;
        messages.push({ ...m, id, convId: `imap:${c.id}:${id}` });
      } else messages.push(m);
    }
    const now = all.map(([, uid]) => uid);
    return { messages, missing: [], remember: () => setPref(pop3SeenKey(c.id), now) };
  });
}

/** Signed in, and how many messages the mailbox holds (STAT). */
export async function testPop3(c: MailAccount, deps: Pop3Deps = {}): Promise<string> {
  const stat = await withPop3(c, deps, (s) => s.cmd("STAT"));
  const n = Number(/^\+OK\s+(\d+)/.exec(stat)?.[1] ?? 0);
  return t("POP3: signed in, {n} messages on the server.", { n });
}
