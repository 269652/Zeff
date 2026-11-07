import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The mail accounts read like a mail program (the imap-mail plugin): several side by side, over IMAP (read-only: nothing marked
 * read) or POP3 (nothing deleted, each message once), written to over SMTP — and the one list of all mail accounts (Settings →
 * E-Mail). No network here: the IMAP and SMTP clients are fakes handed in, the POP3 server a fake on localhost; the MIME is
 * nodemailer's and mailparser's own.
 */

const CRLF = "\r\n";
const raw = (headers: Record<string, string>, body: string) => Buffer.from(`${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(CRLF)}${CRLF}${CRLF}${body.replace(/\n/g, CRLF)}`);

type Structure = import("@/plugins/imap-mail/client").FetchedLike["bodyStructure"];
type Box = { path: string; specialUse?: string; uidValidity: number; messages: { uid: number; flags: string[]; source: Buffer; internalDate?: Date; bodyStructure?: Structure }[] };

/** An IMAP server in memory: its folders, what was opened how, what was appended. */
function fakeImap(boxes: Box[]) {
  const log = { locks: [] as { path: string; readOnly?: boolean }[], appended: [] as { path: string; content: Buffer; flags?: string[] }[], fetched: [] as Record<string, unknown>[] };
  let open: Box | null = null;
  const client = {
    mailbox: false as false | { uidValidity: number },
    async connect() {},
    async logout() {},
    async list() {
      return boxes.map((b) => ({ path: b.path, specialUse: b.specialUse, flags: new Set<string>() }));
    },
    async getMailboxLock(path: string, o?: { readOnly?: boolean }) {
      log.locks.push({ path, readOnly: o?.readOnly });
      open = boxes.find((b) => b.path === path)!;
      client.mailbox = { uidValidity: open.uidValidity };
      return { release: () => void (open = null) };
    },
    async *fetch(range: { since: Date }, query: Record<string, unknown>) {
      log.fetched.push(query);
      for (const m of open!.messages) if (!m.internalDate || m.internalDate >= range.since) yield { uid: m.uid, flags: new Set(m.flags), internalDate: m.internalDate, bodyStructure: m.bodyStructure, source: m.source };
    },
    async append(path: string, content: Buffer, flags?: string[]) {
      log.appended.push({ path, content, flags });
    },
  };
  return { client, log };
}

/**
 * A POP3 server on localhost: its messages by UIDL, every command it was sent. `noTop`: these message numbers answer TOP
 * with -ERR (a server without TOP: RETR then).
 */
function fakePop3(messages: { uidl: string; source: string }[], noTop: number[] = []) {
  const commands: string[] = [];
  const server = net.createServer((sock) => {
    sock.write(`+OK fake POP3 ready${CRLF}`);
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (let i = buf.indexOf(CRLF); i >= 0; i = buf.indexOf(CRLF)) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        commands.push(line);
        const [cmd, a] = line.split(" ");
        const body = (n: number) => `+OK${CRLF}${messages[n - 1].source.split(CRLF).map((l) => (l.startsWith(".") ? `.${l}` : l)).join(CRLF)}${CRLF}.${CRLF}`;
        if (cmd === "USER" || cmd === "PASS") sock.write(`+OK${CRLF}`);
        else if (cmd === "STAT") sock.write(`+OK ${messages.length} 1234${CRLF}`);
        else if (cmd === "UIDL") sock.write(`+OK${CRLF}${messages.map((m, j) => `${j + 1} ${m.uidl}`).join(CRLF)}${messages.length ? CRLF : ""}.${CRLF}`);
        else if (cmd === "TOP") sock.write(noTop.includes(Number(a)) ? `-ERR no TOP${CRLF}` : body(Number(a)));
        else if (cmd === "RETR") sock.write(body(Number(a)));
        else if (cmd === "QUIT") sock.end(`+OK bye${CRLF}`);
        else sock.write(`-ERR unknown${CRLF}`);
      }
    });
  });
  return {
    commands,
    messages,
    start: () => new Promise<number>((ok) => server.listen(0, "127.0.0.1", () => ok((server.address() as net.AddressInfo).port))),
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const ACCOUNT = {
  method: "imap" as const,
  provider: "t-online" as const,
  name: "T-Online",
  senderName: "Erika Muster",
  address: "erika@t-online.de",
  user: "",
  password: "geheim",
  imapHost: "secureimap.t-online.de",
  imapPort: 993,
  imapTls: true,
  smtpHost: "securesmtp.t-online.de",
  smtpPort: 465,
  smtpSecurity: "tls" as const,
  folders: ["INBOX"],
  serverFolders: [],
  sentFolder: "",
  saveSent: true,
};

test("the single mailbox of before moves into the account list once — its password kept, its mails' conversations with it", async () => {
  const { setPref, getPref } = await import("@/lib/prefs");
  const { saveMails, listMails } = await import("@/lib/mail/store");
  setPref("imap-mail.config", { ...ACCOUNT, password: "alt-geheim" });
  saveMails([{ id: "old@x", attachRef: "old@x", convId: "imap:old@x", folder: "T-Online", from: "Anna", fromEmail: "anna@x.de", subject: "Alt", preview: "alt", receivedAt: "2026-10-01T10:00:00.000Z", unread: false }]);
  const before = listMails({}).find((m) => m.subject === "Alt")!;
  const { mailAccounts } = await import("@/plugins/imap-mail/config");
  const list = mailAccounts();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].id, list[0].method, list[0].provider, list[0].password, list[0].address], ["m1", "imap", "t-online", "alt-geheim", "erika@t-online.de"]);
  const after = listMails({}).find((m) => m.subject === "Alt")!;
  assert.equal(after.convId, "imap:m1:old@x");
  assert.equal(after.key, `imap:m1:old@x|${before.key.split("|")[1]}`, "the key follows (the next read of the same message lands on it)");
  assert.equal(mailAccounts().length, 1, "only once");
  assert.equal(getPref<unknown[]>("imap-mail.accounts", []).length, 1);
});

test("toMailInput: the account's thread from References / In-Reply-To, yours as 'Ich' in '<name> · Sent', unread from \\Seen", async () => {
  const { toMailInput, threadKey, previewOf } = await import("@/plugins/imap-mail/map");
  const meta = { account: "m1", path: "INBOX", uidValidity: "7", uid: 3, flags: [] as string[], hasAttachments: false, folder: "T-Online", mailbox: "T-Online", sent: false, me: "Erika@T-Online.de" };
  assert.equal(threadKey({ references: ["<root@x>", "<two@x>"], inReplyTo: "<two@x>", messageId: "<three@x>" }), "root@x", "the thread's start");
  assert.equal(threadKey({ inReplyTo: "<two@x>", messageId: "<three@x>" }), "two@x");
  assert.equal(threadKey({ messageId: "<one@x>" }), "one@x");

  const reply = toMailInput({ messageId: "<three@x>", references: "<root@x> <two@x>", from: { value: [{ name: "Anna Berg", address: "anna@x.de" }] }, subject: "AW: Sonntag", date: new Date("2026-11-01T10:00:00Z"), text: "Gerne!\n\n> Kommst du?\n> Gruß" }, meta);
  assert.equal(reply.convId, "imap:m1:root@x");
  assert.equal(reply.id, "three@x");
  assert.equal(reply.attachRef, "three@x", "the Message-ID is kept for a reply's headers");
  assert.deepEqual([reply.from, reply.fromEmail, reply.folder, reply.unread, reply.preview], ["Anna Berg", "anna@x.de", "T-Online", true, "Gerne!"]);
  assert.equal(toMailInput({ messageId: "<root@x>", subject: "x", text: "x" }, { ...meta, account: "m2" }).convId, "imap:m2:root@x", "the same thread in another account is another conversation");

  const seen = toMailInput({ messageId: "<a@x>", from: { value: [{ address: "anna@x.de" }] }, subject: "Hi", text: "x" }, { ...meta, flags: ["\\Seen"] });
  assert.deepEqual([seen.unread, seen.from], [false, "anna@x.de"]);
  const mine = toMailInput({ messageId: "<m@x>", from: { value: [{ name: "Erika", address: "erika@t-online.de" }] }, subject: "Hallo", text: "Hi" }, meta);
  assert.deepEqual([mine.from, mine.fromEmail, mine.folder, mine.unread], ["Ich", null, "T-Online · Sent", false], "from your own address: yours");
  assert.equal(toMailInput({ messageId: "<s@x>", from: { value: [{ address: "alias@other.de" }] }, subject: "Hallo", text: "Hi" }, { ...meta, sent: true }).from, "Ich", "read in the Sent folder: yours");

  const bare = toMailInput({ subject: "", html: "<p>Hallo&nbsp;<b>Welt</b></p><style>p{}</style>" }, { ...meta, internalDate: new Date("2026-10-01T08:00:00Z") });
  assert.deepEqual([bare.id, bare.convId, bare.subject, bare.preview, bare.receivedAt], ["m1:INBOX:7:3", "imap:m1:m1:INBOX:7:3", "(ohne Betreff)", "Hallo Welt", "2026-10-01T08:00:00.000Z"]);
  assert.equal(previewOf({ text: "x".repeat(2000) }).length, 1000);
});

test("two IMAP accounts side by side: each read read-only, its folders under its name, its conversations its own", async () => {
  const { saveMailAccount } = await import("@/plugins/imap-mail/config");
  const tOnline = saveMailAccount("m1", { ...ACCOUNT, folders: ["INBOX", "Archiv"] });
  const gmx = saveMailAccount(null, { ...ACCOUNT, provider: "gmx", name: "", address: "erika@gmx.de", imapHost: "imap.gmx.net" });
  assert.deepEqual([tOnline.id, tOnline.name, gmx.id, gmx.name], ["m1", "T-Online", "m2", "GMX"], "a name from its provider when none is set");
  assert.equal(saveMailAccount(null, { ...ACCOUNT, address: "erika2@t-online.de", name: "T-Online" }).name, "T-Online 2", "never two accounts of one name");
  assert.equal(saveMailAccount(null, { ...ACCOUNT, address: "erika3@t-online.de", name: "Gmail" }).name, "Gmail (IMAP)", "never a name another channel owns");
  const { removeMailAccount, mailAccounts } = await import("@/plugins/imap-mail/config");
  removeMailAccount("m3");
  removeMailAccount("m4");
  assert.deepEqual(mailAccounts().map((a) => a.id), ["m1", "m2"]);

  const { readImap } = await import("@/plugins/imap-mail/client");
  const now = Date.parse("2026-11-05T12:00:00Z");
  const { client, log } = fakeImap([
    {
      path: "INBOX",
      uidValidity: 11,
      messages: [
        { uid: 1, flags: [], internalDate: new Date("2026-11-04T09:00:00Z"), source: raw({ "Message-ID": "<q1@anna>", From: "Anna Berg <anna@x.de>", To: "erika@t-online.de", Subject: "=?UTF-8?Q?Kuchen_f=C3=BCr_Sonntag?=", Date: "Tue, 04 Nov 2026 10:00:00 +0100", "Content-Type": "text/plain; charset=utf-8" }, "Backst du einen Kuchen?") },
        { uid: 2, flags: ["\\Seen"], internalDate: new Date("2026-11-04T11:00:00Z"), bodyStructure: { type: "multipart/mixed", childNodes: [{ type: "text/plain" }, { type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "a.pdf" } }] }, source: raw({ "Message-ID": "<q3@anna>", "In-Reply-To": "<q2@erika>", References: "<q1@anna> <q2@erika>", From: "Anna Berg <anna@x.de>", Subject: "AW: Kuchen", Date: "Tue, 04 Nov 2026 12:00:00 +0100" }, "Super, danke!") },
        { uid: 3, flags: [], internalDate: new Date("2026-09-01T09:00:00Z"), source: raw({ "Message-ID": "<old2@x>", From: "x@y.de", Subject: "Alt" }, "alt") },
      ],
    },
    { path: "Gesendet", specialUse: "\\Sent", uidValidity: 12, messages: [{ uid: 5, flags: ["\\Seen"], internalDate: new Date("2026-11-04T10:30:00Z"), source: raw({ "Message-ID": "<q2@erika>", "In-Reply-To": "<q1@anna>", References: "<q1@anna>", From: "Erika <erika@t-online.de>", To: "anna@x.de", Subject: "AW: Kuchen", Date: "Tue, 04 Nov 2026 11:30:00 +0100" }, "Ja, mache ich.") }] },
    { path: "Spam", uidValidity: 13, messages: [] },
  ]);
  const r = await readImap(tOnline, { days: 3, now }, { imap: () => client });
  assert.deepEqual(r.missing, ["Archiv"], "a folder the server doesn't have is said");
  assert.deepEqual(log.locks, [{ path: "INBOX", readOnly: true }, { path: "Gesendet", readOnly: true }], "EXAMINE only: nothing can be marked read; Spam not read");
  assert.deepEqual(log.fetched[0].source, { maxLength: 65536 }, "only the start of each message");
  assert.equal(r.messages.length, 3, "the one older than the window is left out");
  const [first, answer] = r.messages;
  const sent = r.messages.find((m) => m.id === "q2@erika")!;
  assert.deepEqual([first.subject, first.convId, first.unread], ["Kuchen für Sonntag", "imap:m1:q1@anna", true]);
  assert.deepEqual([answer.convId, answer.hasAttachments, answer.unread], ["imap:m1:q1@anna", true, false], "the whole conversation in one thread");
  assert.deepEqual([sent.from, sent.folder, sent.convId], ["Ich", "T-Online · Sent", "imap:m1:q1@anna"]);

  const other = fakeImap([{ path: "INBOX", uidValidity: 1, messages: [{ uid: 9, flags: [], internalDate: new Date("2026-11-05T09:00:00Z"), source: raw({ "Message-ID": "<g1@bob>", From: "Bob <bob@y.de>", Subject: "Hallo GMX" }, "Hi") }] }]);
  const r2 = await readImap(gmx, { days: 3, now }, { imap: () => other.client });
  assert.deepEqual([r2.messages[0].convId, r2.messages[0].folder], ["imap:m2:g1@bob", "GMX"]);

  const { saveMails, listMails, imapFolderNames } = await import("@/lib/mail/store");
  saveMails([...r.messages, ...r2.messages]);
  assert.deepEqual([...imapFolderNames()].sort(), ["GMX", "T-Online", "T-Online · Sent"]);
  const kept = listMails({}).find((m) => m.subject === "AW: Kuchen" && m.fromName !== "Ich")!;
  const shared = await import("@/lib/mail/shared");
  assert.equal(shared.outlookLink(kept), null);
  assert.equal(shared.sourceLink(kept), null);
  assert.equal(shared.channelOfFolder(kept.folder, imapFolderNames()), "imap");
  assert.equal(shared.channelOfFolder("GMX", imapFolderNames()), "imap");
  assert.equal(shared.channelOfFolder("Posteingang", imapFolderNames()), "outlook");
});

test("provider inference: imap:… is its own account everywhere (pipeline, attachments, boundaries, capabilities)", async () => {
  const { accountOf } = await import("@/plugins/workspace/pipeline");
  assert.equal(accountOf("imap:m1:q1@anna"), "imap");
  assert.equal(accountOf("gmail:abc"), "gmail");
  assert.equal(accountOf("AAQkAD…"), "outlook");
  const { mailSourceOf } = await import("@/lib/mail/attachment-rules");
  assert.equal(mailSourceOf("imap:m1:q1@anna"), null, "no attachments fetched for IMAP (yet) — never as Outlook's");
  const { docSourceKey } = await import("@/lib/boundaries/shared");
  assert.equal(docSourceKey("zeff:mail:imap:m1:q1@anna|abc"), "imap");
  const { normalizePipeline } = await import("@/plugins/workspace/model/pipeline");
  const p = normalizePipeline({ steps: [{ id: "s1", kind: "source", from: "mail", mail: { accounts: ["imap", "nope"] } }] });
  assert.deepEqual(p?.steps[0].mail?.accounts, ["imap"], "kept, an unknown one dropped");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("imap-mail", true);
  const { capabilitiesOf } = await import("@/plugins/workspace/capabilities");
  const caps = capabilitiesOf({ titleName: "Subject", properties: [], views: [], pipeline: { steps: [{ id: "s1", kind: "source", from: "mail", mail: { accounts: ["imap"] } }] } } as never);
  assert.deepEqual([caps.reply, caps.sends, caps.drafts], [["E-Mail"], ["E-Mail"], []], "sent by Zeff on your click, not a draft");
});

test("runImapSend: from the conversation's account, In-Reply-To / References of the thread, a copy appended to its Sent folder", async () => {
  const { runImapSend, replyHeaders } = await import("@/plugins/imap-mail/run");
  assert.deepEqual(replyHeaders("imap:m1:q1@anna"), { inReplyTo: "q3@anna", references: ["q1@anna", "q2@erika", "q3@anna"] }, "the newest kept is answered");
  assert.deepEqual(replyHeaders("AAQ-outlook"), {});

  const { client, log } = fakeImap([
    { path: "INBOX", uidValidity: 1, messages: [] },
    { path: "Gesendet", specialUse: "\\Sent", uidValidity: 2, messages: [] },
  ]);
  const sent: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
  const smtp = { verify: async () => true, sendMail: async (o: (typeof sent)[number]) => void sent.push(o) };
  const used: string[] = [];
  const deps = { imap: (c: { id: string }) => (used.push(c.id), client), smtp: (c: { id: string }) => (used.push(c.id), smtp) };
  const r = await runImapSend({ type: "imap-send", to: "Anna Berg <anna@x.de>; bob@y.de", subject: "AW: Kuchen", body: "Bis Sonntag!\nErika", account: "m2" }, { conv: "imap:m1:q1@anna" }, deps as never);
  assert.match(r.what, /AW: Kuchen.*T-Online/);
  assert.deepEqual([...new Set(used)], ["m1"], "a reply goes from the conversation's account, whatever the op says");
  assert.deepEqual(sent[0].envelope, { from: "erika@t-online.de", to: ["anna@x.de", "bob@y.de"] });
  const mime = sent[0].raw.toString("utf8");
  assert.match(mime, /^In-Reply-To: <q3@anna>/m);
  assert.match(mime, /^References: <q1@anna> <q2@erika> <q3@anna>/m);
  assert.match(mime, /^From: Erika Muster <erika@t-online\.de>/m);
  assert.match(mime, /Bis Sonntag!\r\nErika/);
  assert.deepEqual([log.appended.length, log.appended[0].path, log.appended[0].flags], [1, "Gesendet", ["\\Seen"]], "T-Online doesn't keep it: Zeff puts a copy in Sent");
  assert.equal(log.appended[0].content.toString("utf8"), mime, "the very mail sent");
  const { conversationOf } = await import("@/lib/mail/store");
  const last = conversationOf("imap:m1:q1@anna").at(-1)!;
  assert.deepEqual([last.fromName, last.folder, last.subject], ["Ich", "T-Online · Sent", "AW: Kuchen"], "in the conversation at once");

  // A new mail from the account picked: no reply headers, its own conversation; GMX's copy setting off: no copy.
  const { saveMailAccount } = await import("@/plugins/imap-mail/config");
  saveMailAccount("m2", { saveSent: false });
  used.length = 0;
  const before = log.appended.length;
  await runImapSend({ type: "imap-send", to: "carl@z.de", subject: "Neu", body: "Hallo", account: "m2" }, { conv: "" }, deps as never);
  assert.deepEqual([...new Set(used)], ["m2"]);
  assert.equal(sent[1].envelope.from, "erika@gmx.de");
  assert.doesNotMatch(sent[1].raw.toString("utf8"), /^In-Reply-To:/m);
  assert.equal(log.appended.length, before);
  assert.match(conversationOf(`imap:m2:${/^Message-ID: <([^>]+)>/m.exec(sent[1].raw.toString("utf8"))![1]}`).at(-1)!.folder, /^GMX · Sent$/);
  await assert.rejects(runImapSend({ type: "imap-send", to: "a@b.de", subject: "x", body: "y" }, {}, deps as never), /Pick the account|account/i, "two accounts and none named: which?");
  await assert.rejects(runImapSend({ type: "imap-send", to: "", subject: "x", body: "y", account: "m1" }, {}, deps as never), /recipient|Empfänger/i);
  const refusing = { verify: async () => true, sendMail: async () => Promise.reject(Object.assign(new Error("Invalid login: 535 Authentication failed"), { code: "EAUTH", responseCode: 535 })) };
  await assert.rejects(runImapSend({ type: "imap-send", to: "a@b.de", subject: "x", body: "y", account: "m1" }, {}, { smtp: () => refusing }), /SMTP: .*(login|password)/i);
});

test("POP3: only new messages (by UIDL), never a DELE; the first read counted as read, the next ones unread; TOP, else RETR", async () => {
  const srv = fakePop3([
    { uidl: "u1", source: ["Message-ID: <p1@x>", "From: Anna <anna@x.de>", "Subject: Eins", "Date: Mon, 03 Nov 2026 10:00:00 +0100", "", "Erste Mail", ".punkt am Anfang"].join(CRLF) },
    { uidl: "u2", source: ["From: Bob <bob@y.de>", "Subject: Ohne Message-ID", "Content-Type: multipart/mixed; boundary=b", "", "--b", "Content-Type: text/plain", "", "Zweite", "--b--"].join(CRLF) },
  ]);
  const port = await srv.start();
  try {
    const { saveMailAccount, getMailAccount } = await import("@/plugins/imap-mail/config");
    const acc = saveMailAccount(null, { ...ACCOUNT, method: "pop3", provider: "web-de", name: "", address: "erika@web.de", imapHost: "127.0.0.1", imapPort: port, imapTls: true, saveSent: true });
    assert.deepEqual([acc.name, acc.saveSent], ["WEB.DE", false], "POP3 has no Sent folder: no copy");
    const connect = async () => net.connect({ host: "127.0.0.1", port });
    const { readPop3, testPop3 } = await import("@/plugins/imap-mail/pop3");
    assert.match(await testPop3(acc, { connect }), /2/);

    const r1 = await readPop3(acc, { connect });
    assert.equal(r1.messages.length, 2);
    const [one, two] = r1.messages;
    assert.deepEqual([one.convId, one.folder, one.unread, one.from], [`imap:${acc.id}:p1@x`, "WEB.DE", false, "Anna"]);
    assert.match(one.preview, /Erste Mail\n\.punkt am Anfang/, "dot-unstuffed");
    assert.deepEqual([two.id, two.convId, two.hasAttachments], [`${acc.id}:uidl:u2`, `imap:${acc.id}:${acc.id}:uidl:u2`, true], "no Message-ID: the UIDL is its lasting id");
    r1.remember();

    srv.messages.push({ uidl: "u3", source: ["Message-ID: <p3@x>", "In-Reply-To: <p1@x>", "References: <p1@x>", "From: Anna <anna@x.de>", "Subject: AW: Eins", "", "Neu"].join(CRLF) });
    const r2 = await readPop3(getMailAccount(acc.id)!, { connect: async () => net.connect({ host: "127.0.0.1", port }) });
    assert.deepEqual(r2.messages.map((m) => [m.id, m.convId, m.unread]), [["p3@x", `imap:${acc.id}:p1@x`, true]], "only the new one, in its thread, unread");
    assert.ok(srv.commands.some((c) => /^TOP 1 /.test(c)), "TOP: the header and the first lines");
    assert.ok(!srv.commands.some((c) => /^DELE/i.test(c)), "nothing is ever deleted on the server");
    assert.ok(srv.commands.filter((c) => c === "QUIT").length >= 3);
    assert.ok(srv.commands.includes("PASS geheim"));

    // A server without TOP: the message read whole (RETR).
    const noTop = fakePop3([{ uidl: "z1", source: ["Message-ID: <z1@x>", "From: Z <z@x.de>", "Subject: Z", "", "zett"].join(CRLF) }], [1]);
    const p2 = await noTop.start();
    try {
      const acc2 = saveMailAccount(null, { ...ACCOUNT, method: "pop3", name: "Z", address: "z@z.de", imapHost: "127.0.0.1", imapPort: p2 });
      const r = await readPop3(acc2, { connect: async () => net.connect({ host: "127.0.0.1", port: p2 }) });
      assert.equal(r.messages[0].preview, "zett");
      assert.ok(noTop.commands.includes("RETR 1"));
      (await import("@/plugins/imap-mail/config")).removeMailAccount(acc2.id);
    } finally {
      await noTop.stop();
    }
  } finally {
    await srv.stop();
  }
});

test("testImap: both logins said, the folders and the Sent folder found", async () => {
  const { testImap } = await import("@/plugins/imap-mail/client");
  const { getMailAccount } = await import("@/plugins/imap-mail/config");
  const acc = getMailAccount("m1")!;
  const { client } = fakeImap([
    { path: "INBOX", uidValidity: 1, messages: [] },
    { path: "Gesendet", specialUse: "\\Sent", uidValidity: 2, messages: [] },
    { path: "Archiv", uidValidity: 3, messages: [] },
  ]);
  const ok = await testImap(acc, { imap: () => client, smtp: () => ({ verify: async () => true, sendMail: async () => undefined }) });
  assert.deepEqual([ok.ok, ok.folders, ok.sentFolder], [true, ["INBOX", "Archiv", "Gesendet"], "Gesendet"]);
  const bad = await testImap(acc, {
    imap: () => ({ ...client, connect: async () => Promise.reject(Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "AUTHENTICATIONFAILED" })) }),
    smtp: () => ({ verify: async () => Promise.reject(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })), sendMail: async () => undefined }),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.imap, /^IMAP: .*login/i);
  assert.match(bad.smtp, /^SMTP: .*(answer|port)/i);
});

test("settings: a password left empty stays; switching to POP3 takes the provider's POP3 server", async () => {
  const { getMailAccount, saveMailAccount, settingsOfForm, accountReady, folderLabel } = await import("@/plugins/imap-mail/config");
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "Mama", address: "mama@t-online.de", user: "", password: "", imapHost: "SecureIMAP.t-online.de ", imapPort: "993", imapSecurity: "tls", smtpHost: "securesmtp.t-online.de", smtpPort: "465", smtpSecurity: "tls", saveSent: "on" })) fd.set(k, v);
  saveMailAccount("m1", settingsOfForm(fd));
  const c = getMailAccount("m1")!;
  assert.equal(c.password, "geheim", "an empty password field keeps the one kept");
  assert.deepEqual([c.imapHost, c.saveSent, c.name], ["secureimap.t-online.de", true, "Mama"]);
  assert.ok(accountReady(c));
  assert.equal(folderLabel(c, "Familie"), "Mama · Familie");
  fd.set("password", "neu");
  fd.set("method", "pop3");
  saveMailAccount("m1", settingsOfForm(fd));
  const p = getMailAccount("m1")!;
  assert.deepEqual([p.password, p.method, p.imapHost, p.imapPort, p.saveSent], ["neu", "pop3", "securepop.t-online.de", 995, false]);
  saveMailAccount("m1", { method: "imap", imapHost: p.imapHost, imapPort: p.imapPort });
  assert.deepEqual([getMailAccount("m1")!.imapHost, getMailAccount("m1")!.imapPort], ["secureimap.t-online.de", 993], "and back");

  const { MAIL_PROVIDERS, providerById } = await import("@/plugins/imap-mail/presets");
  const tOnline = providerById("t-online");
  assert.deepEqual([tOnline.imap.host, tOnline.imap.port, tOnline.pop3.host, tOnline.smtp.host, tOnline.smtp.port, tOnline.smtp.security], ["secureimap.t-online.de", 993, "securepop.t-online.de", "securesmtp.t-online.de", 465, "tls"]);
  assert.deepEqual(providerById("gmail").methods, ["api", "browser", "imap"], "Gmail: its API, the automation Chrome, or IMAP");
  assert.ok(MAIL_PROVIDERS.filter((x) => !["gmail", "outlook"].includes(x.id)).every((x) => x.methods.join() === "imap,pop3"));
});

test("the account list: Outlook, Gmail's accounts and the IMAP / POP3 ones, each with how it is read", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("outlook-mail", true);
  setInstalled("gmail", true);
  const { setGmailAccounts } = await import("@/plugins/gmail/accounts");
  setGmailAccounts([{ account: "0", label: "" }, { account: "me@gmail.com", label: "Privat" }]);
  const { saveMailAccount } = await import("@/plugins/imap-mail/config");
  saveMailAccount("m1", { lastSyncAt: "2026-11-05T10:00:00.000Z", lastOk: false, lastResult: "IMAP: login refused" });
  const { listMailAccounts } = await import("@/lib/mail/accounts");
  const rows = await listMailAccounts();
  const view = rows.map((r) => [r.key, r.name, r.method, r.status]);
  assert.deepEqual(view.slice(0, 3), [
    ["outlook", "Outlook", "browser", "never"],
    ["gmail:0", "Gmail", "browser", "never"],
    ["gmail:me@gmail.com", "Gmail · Privat", "browser", "never"],
  ]);
  assert.deepEqual(view.find((v) => v[0] === "m1"), ["m1", "Mama", "imap", "error"]);
  assert.deepEqual(view.find((v) => v[0] === "m2"), ["m2", "GMX", "imap", "never"]);
  assert.equal(rows.find((r) => r.method === "pop3")?.name, "WEB.DE");
  assert.equal(rows.find((r) => r.key === "m1")?.href, "/settings/mail/account/m1");

  // Gmail through Google's API: one account (the one signed in on the Connections page).
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("gmail", { driver: "api" });
  const api = (await listMailAccounts()).filter((r) => r.provider === "gmail");
  assert.deepEqual(api.map((r) => [r.key, r.method, r.status]), [["gmail", "api", "signin"]], "not signed in yet: said so");
  updateConnector("gmail", { driver: "cdp" });
});

test("the inbox's reply may send imap-send; the action opens a mailto draft anywhere else", async () => {
  const { actionOf } = await import("@/plugins/actions/catalog");
  const a = actionOf("imap-send");
  assert.equal(a.plugin, "imap-mail");
  assert.equal(a.href!({ type: "imap-send", to: "a@b.de; c@d.de", subject: "AW: x", body: "Hallo" }), "mailto:a%40b.de%2C%20c%40d.de?subject=AW%3A%20x&body=Hallo");
  assert.deepEqual(a.clean({ to: "a@b.de", subject: "x", body: "y", account: "m2" }, { ticket: "" }), { type: "imap-send", to: "a@b.de", subject: "x", body: "y", account: "m2" });
  assert.equal((a.clean({ to: "a@b.de", subject: "x", body: "y", account: "evil" }, { ticket: "" }) as { account?: string }).account, undefined);
  const { runConvOp } = await import("@/lib/ops");
  const r = await runConvOp("imap:m1:q1@anna", "", { type: "imap-send", to: "a@b.de", subject: "x", body: "y" });
  assert.match(r.href ?? "", /^mailto:/, "without “send” only the draft's address — never sent by itself");
});

test("renamed: the mails kept move to its new name, the Sent ones too", async () => {
  const { saveMailAccount } = await import("@/plugins/imap-mail/config");
  const { saveMails, listMails } = await import("@/lib/mail/store");
  const a = saveMailAccount(null, { method: "imap", provider: "other", name: "Alt", address: "umbenennen@example.org", password: "x", imapHost: "imap.example.org", smtpHost: "smtp.example.org" });
  saveMails([
    { id: "<r1@x>", convId: `imap:${a.id}:<r1@x>`, folder: "Alt (IMAP) (IMAP)", from: "A", fromEmail: "a@x", subject: "Hallo", preview: "", receivedAt: new Date().toISOString(), unread: true },
    { id: "<r2@x>", convId: `imap:${a.id}:<r1@x>`, folder: "Alt (IMAP) (IMAP) · Sent", from: "Ich", fromEmail: "", subject: "Re: Hallo", preview: "", receivedAt: new Date().toISOString(), unread: false },
  ]);
  saveMailAccount(a.id, { name: "Neu" });
  const folders = listMails({ limit: 2000 }).filter((m) => m.convId.startsWith(`imap:${a.id}:`)).map((m) => m.folder).sort();
  assert.deepEqual(folders, ["Neu", "Neu · Sent"]);
});

test("saved again: the name gets its (IMAP) once, and the same mailbox added twice stays one account", async () => {
  const { saveMailAccount, mailAccounts } = await import("@/plugins/imap-mail/config");
  const before = mailAccounts().length;
  const a = saveMailAccount(null, { method: "imap", provider: "gmail", name: "Gmail", address: "oma.test@gmail.com", password: "x", imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com" });
  assert.equal(a.name, "Gmail (IMAP)");
  for (let i = 0; i < 3; i++) assert.equal(saveMailAccount(a.id, { name: saveMailAccount(a.id, {}).name }).name, "Gmail (IMAP)", "the form sends its name back");
  const twice = saveMailAccount(null, { method: "imap", provider: "gmail", name: "Gmail (IMAP)", address: "Oma.Test@gmail.com" });
  assert.equal(twice.id, a.id, "a second click on Save: the same account");
  assert.equal(mailAccounts().length, before + 1);
});

test("opened: an IMAP account's mail is read in Zeff and flagged \Seen on the server in its folder — unless the account says no", async () => {
  const { saveMailAccount } = await import("@/plugins/imap-mail/config");
  const { saveMails, listMails } = await import("@/lib/mail/store");
  const { markOpenedRead, serverFolderOf } = await import("@/plugins/imap-mail/read-on-open");
  const { createPage, addRow, getPage } = await import("@/plugins/workspace/store");
  const a = saveMailAccount(null, { method: "imap", provider: "other", name: "Lesen", address: "lesen@example.org", password: "x", imapHost: "imap.example.org", smtpHost: "smtp.example.org", sentFolder: "Gesendet" });
  assert.equal(a.markReadOnOpen, true, "on by default");
  assert.equal(serverFolderOf(a, "Lesen"), "INBOX");
  assert.equal(serverFolderOf(a, "Lesen · Archiv"), "Archiv");
  assert.equal(serverFolderOf(a, "Lesen · Sent"), "Gesendet");
  const conv = `imap:${a.id}:<o1@x>`;
  saveMails([{ id: "<o1@x>", convId: conv, folder: "Lesen · Archiv", from: "A", fromEmail: "a@x", subject: "Offen", preview: "", receivedAt: new Date().toISOString(), unread: true, attachRef: "<o1@x>" }]);
  const key = listMails({ limit: 2000 }).find((m) => m.convId === conv)!.key;
  const db = createPage({ parentId: null, title: "Inbox", kind: "database", schema: { titleName: "Title", properties: [{ id: "communread", name: "Unread", type: "checkbox" }], views: [] } });
  const { getSqlite } = await import("@/db");
  // (The pipeline keeps a row's source in its props, as here.)
  const withSource = (id: number, ref: string) => void getSqlite().prepare("update ws_pages set props = json_set(props, '$.srcref', ?) where id = ?").run(ref, id);
  const row = addRow(db, { title: "Offen", cells: { communread: true } });
  withSource(row, `mail:${key}`);

  const flagged: { path: string; ids: number[]; flags: string[] }[] = [];
  let path = "";
  const imap = () => ({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [],
    mailbox: false as const,
    getMailboxLock: async (p: string, o?: { readOnly?: boolean }) => ((path = p), assert.ok(!o?.readOnly, "opened to set a flag"), { release: () => undefined }),
    fetch: () => (async function* () {})(),
    append: async () => undefined,
    search: async (q: Record<string, unknown>) => (JSON.stringify(q).includes("<o1@x>") ? [42] : []),
    messageFlagsAdd: async (ids: number[], flags: string[]) => void flagged.push({ path, ids, flags }),
  });
  const r = await markOpenedRead([row], { imap });
  assert.equal(r.marked, 1);
  await new Promise((done) => setTimeout(done, 50));
  assert.deepEqual(flagged, [{ path: "Archiv", ids: [42], flags: ["\\Seen"] }]);
  assert.equal(listMails({ limit: 2000 }).find((m) => m.key === key)!.unread, false);
  assert.equal(getPage(row)!.props.communread, false, "the row too");

  // Read already: nothing more. The account off: nothing at all.
  assert.equal((await markOpenedRead([row], { imap })).marked, 0);
  saveMailAccount(a.id, { markReadOnOpen: false });
  saveMails([{ id: "<o2@x>", convId: `imap:${a.id}:<o2@x>`, folder: "Lesen", from: "B", fromEmail: "b@x", subject: "Zwei", preview: "", receivedAt: new Date().toISOString(), unread: true, attachRef: "<o2@x>" }]);
  const key2 = listMails({ limit: 2000 }).find((m) => m.convId === `imap:${a.id}:<o2@x>`)!.key;
  const row2 = addRow(db, { title: "Zwei", cells: { communread: true } });
  withSource(row2, `mail:${key2}`);
  assert.equal((await markOpenedRead([row2], { imap })).marked, 0);
});

test("archived: the whole conversation moves to the server's archive (Gmail: All Mail) and out of every inbox row; read ones at once", async () => {
  const { saveMailAccount } = await import("@/plugins/imap-mail/config");
  const { saveMails, listMails } = await import("@/lib/mail/store");
  const { archiveMails, archiveReadInbox } = await import("@/plugins/imap-mail/archive");
  const { archiveFolderOf } = await import("@/plugins/imap-mail/client");
  const { createPage, addRow, getPage } = await import("@/plugins/workspace/store");
  const { getSqlite } = await import("@/db");
  assert.equal(archiveFolderOf([{ path: "INBOX" }, { path: "[Gmail]/Alle Nachrichten", specialUse: "\\All" }]), "[Gmail]/Alle Nachrichten");
  assert.equal(archiveFolderOf([{ path: "INBOX" }, { path: "Archiv" }]), "Archiv");
  assert.equal(archiveFolderOf([{ path: "INBOX" }]), "");

  const a = saveMailAccount(null, { method: "imap", provider: "other", name: "Box", address: "box@example.org", password: "x", imapHost: "imap.example.org", smtpHost: "smtp.example.org" });
  const at = new Date().toISOString();
  saveMails([
    { id: "<t1@x>", convId: `imap:${a.id}:<t1@x>`, folder: "Box", from: "A", fromEmail: "a@x", subject: "Eins", preview: "", receivedAt: at, unread: false, attachRef: "<t1@x>" },
    { id: "<t2@x>", convId: `imap:${a.id}:<t1@x>`, folder: "Box", from: "A", fromEmail: "a@x", subject: "Re: Eins", preview: "", receivedAt: at, unread: false, attachRef: "<t2@x>" },
    { id: "<u1@x>", convId: `imap:${a.id}:<u1@x>`, folder: "Box", from: "B", fromEmail: "b@x", subject: "Ungelesen", preview: "", receivedAt: at, unread: true, attachRef: "<u1@x>" },
    { id: "<r1@x>", convId: `imap:${a.id}:<r1@x>`, folder: "Box", from: "C", fromEmail: "c@x", subject: "Gelesen", preview: "", receivedAt: at, unread: false, attachRef: "<r1@x>" },
  ]);
  const keyOf = (subject: string) => listMails({ limit: 2000 }).find((m) => m.convId.startsWith(`imap:${a.id}:`) && m.subject === subject)!.key;
  const db = createPage({ parentId: null, title: "Inbox", kind: "database", schema: { titleName: "Title", properties: [], views: [] } });
  const other = createPage({ parentId: null, title: "Other inbox", kind: "database", schema: { titleName: "Title", properties: [], views: [] } });
  const rowFor = (dbId: number, subject: string) => {
    const id = addRow(dbId, { title: subject });
    getSqlite().prepare("update ws_pages set props = json_set(props, '$.srcref', ?) where id = ?").run(`mail:${keyOf(subject)}`, id);
    return id;
  };
  const r1 = rowFor(db, "Eins");
  const r1b = rowFor(other, "Re: Eins");

  const moved: { from: string; ids: number[]; to: string }[] = [];
  let open = "";
  const imap = () => ({
    connect: async () => undefined,
    logout: async () => undefined,
    list: async () => [{ path: "INBOX" }, { path: "[Gmail]/Alle Nachrichten", specialUse: "\\All" }],
    mailbox: false as const,
    getMailboxLock: async (p: string) => ((open = p), { release: () => undefined }),
    fetch: () => (async function* () {})(),
    append: async () => undefined,
    search: async (q: Record<string, unknown>) => [JSON.stringify(q).length],
    messageMove: async (ids: number[], to: string) => void moved.push({ from: open, ids, to }),
  });
  const r = await archiveMails([keyOf("Eins")], { imap });
  assert.deepEqual(r, { archived: 2, failed: [] }, "the whole conversation");
  assert.equal(moved.length, 2);
  assert.ok(moved.every((m) => m.from === "INBOX" && m.to === "[Gmail]/Alle Nachrichten"));
  const folders = listMails({ limit: 2000 }).filter((m) => m.convId === `imap:${a.id}:<t1@x>`).map((m) => m.folder);
  assert.deepEqual([...new Set(folders)], ["Box · Archive"]);
  assert.ok(getPage(r1)!.archivedAt && getPage(r1b)!.archivedAt, "out of both inboxes");

  moved.length = 0;
  const all = await archiveReadInbox(a.id, { imap });
  assert.equal(all.archived, 1, "the read one; the unread one stays");
  assert.equal(listMails({ limit: 2000 }).find((m) => m.subject === "Ungelesen" && m.convId.startsWith(`imap:${a.id}:`))!.folder, "Box");
});
