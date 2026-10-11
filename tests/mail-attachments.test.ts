import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

test("attachment settings: defaults are off and safe, anything stored is clamped", async () => {
  const { parseAttachmentSettings, DEFAULT_ATTACHMENT_SETTINGS } = await import("@/lib/mail/attachment-rules");
  const d = parseAttachmentSettings(undefined);
  assert.deepEqual(d, DEFAULT_ATTACHMENT_SETTINGS);
  assert.equal(d.enabled, false);
  assert.equal(d.when, "sync");
  assert.equal(d.days, 14);
  assert.equal(d.maxMB, 25);
  assert.deepEqual(d.kinds, { documents: true, pictures: true, audio: false, other: false });
  assert.equal(d.minPictureKB, 30);
  assert.equal(d.unread, "skip");
  const c = parseAttachmentSettings({ enabled: "yes", days: 9999, maxMB: 5000, minPictureKB: -4, when: "manual", unread: "include", onlyFrom: "A@B.com; example.org\nx", kinds: { audio: true }, sources: { gmail: false } });
  assert.equal(c.enabled, false, "only a real boolean turns it on");
  assert.equal(c.days, 120);
  assert.equal(c.maxMB, 50, "capped by the Documents limit");
  assert.equal(c.minPictureKB, 0);
  assert.equal(c.when, "manual");
  assert.equal(c.unread, "include");
  assert.deepEqual(c.onlyFrom, ["a@b.com", "example.org", "x"]);
  assert.equal(c.kinds.audio, true);
  assert.equal(c.kinds.documents, true);
  assert.deepEqual(c.sources, { outlook: true, gmail: false });
  assert.equal(parseAttachmentSettings({ days: 0 }).days, 1);
  assert.equal(parseAttachmentSettings({ days: "abc" }).days, 14);
});

test("attachment kinds and the fixed blocklist", async () => {
  const { attachmentKind, isBlocked, BLOCKED_EXTENSIONS } = await import("@/lib/mail/attachment-rules");
  assert.equal(attachmentKind("Vertrag.PDF"), "document");
  assert.equal(attachmentKind("a.docx"), "document");
  assert.equal(attachmentKind("notes.txt"), "document");
  assert.equal(attachmentKind("foto.JPG"), "picture");
  assert.equal(attachmentKind("memo.m4a"), "audio");
  assert.equal(attachmentKind("archive.zip"), "other");
  assert.equal(attachmentKind("invite.ics"), "other");
  assert.equal(attachmentKind("noext", "application/pdf"), "document");
  for (const e of ["exe", "msi", "bat", "cmd", "ps1", "vbs", "js", "jar", "scr", "com", "dll", "lnk", "iso"]) {
    assert.ok(BLOCKED_EXTENSIONS.includes(e as never), e);
    assert.equal(attachmentKind(`thing.${e}`), "blocked", e);
  }
  assert.equal(attachmentKind("SETUP.EXE"), "blocked");
  assert.equal(attachmentKind("invoice.pdf.exe"), "blocked", "the last extension decides");
  assert.equal(attachmentKind("www.shop.com.pdf"), "document", "a dot in the name is not an extension");
  assert.equal(isBlocked("x", "application/x-msdownload"), true);
  assert.equal(isBlocked("x.bin", "application/octet-stream"), true);
  assert.equal(isBlocked("report.pdf", "application/pdf"), false);
});

test("attachment rules: kinds, size, tiny pictures", async () => {
  const { decideAttachment, parseAttachmentSettings } = await import("@/lib/mail/attachment-rules");
  const s = parseAttachmentSettings({ enabled: true });
  const KB = 1024;
  assert.deepEqual(decideAttachment({ name: "a.pdf", size: 200 * KB }, s), { take: true });
  assert.deepEqual(decideAttachment({ name: "a.pdf", size: 0 }, s), { take: false, why: "empty" });
  assert.deepEqual(decideAttachment({ name: "a.pdf", size: 26 * 1024 * KB }, s), { take: false, why: "large" });
  assert.deepEqual(decideAttachment({ name: "a.pdf", size: 25 * 1024 * KB }, s), { take: true });
  assert.deepEqual(decideAttachment({ name: "logo.png", size: 5 * KB }, s), { take: false, why: "small-picture" });
  assert.deepEqual(decideAttachment({ name: "scan.png", size: 300 * KB }, s), { take: true });
  assert.deepEqual(decideAttachment({ name: "memo.mp3", size: 300 * KB }, s), { take: false, why: "kind" }, "audio is off by default");
  assert.deepEqual(decideAttachment({ name: "x.zip", size: 300 * KB }, s), { take: false, why: "kind" });
  assert.deepEqual(decideAttachment({ name: "setup.exe", size: 300 * KB }, parseAttachmentSettings({ kinds: { other: true, documents: true } })), { take: false, why: "blocked" }, "never, whatever the kinds");
  assert.deepEqual(decideAttachment({ name: "memo.mp3", size: 300 * KB }, parseAttachmentSettings({ kinds: { audio: true } })), { take: true });
  assert.deepEqual(decideAttachment({ name: "logo.png", size: 5 * KB }, parseAttachmentSettings({ minPictureKB: 2 })), { take: true });
  assert.deepEqual(decideAttachment({ name: "a.pdf", size: 3 * 1024 * KB }, parseAttachmentSettings({ maxMB: 2 })), { take: false, why: "large" });
});

test("attachment rules: the unread rule, windows, senders and folders", async () => {
  const { mayOpenMail, inWindow, senderAllowed, folderAllowed, parseAttachmentSettings, mailSourceOf, documentName } = await import("@/lib/mail/attachment-rules");
  const skip = parseAttachmentSettings({});
  const include = parseAttachmentSettings({ unread: "include" });
  assert.equal(mayOpenMail({ unread: false }, "outlook", skip), true);
  assert.equal(mayOpenMail({ unread: true }, "outlook", skip), false, "an unread mail that has to be opened is left alone");
  assert.equal(mayOpenMail({ unread: true }, "outlook", include), true);
  assert.equal(mayOpenMail({ unread: true }, "gmail", skip), true, "Gmail hands attachments over without opening the mail");

  const now = Date.parse("2026-10-11T12:00:00Z");
  assert.equal(inWindow("2026-10-01T00:00:00Z", 14, now), true);
  assert.equal(inWindow("2026-09-20T00:00:00Z", 14, now), false);
  assert.equal(inWindow("garbage", 14, now), false);

  const s = parseAttachmentSettings({ onlyFrom: "example.org, boss@corp.com", neverFrom: "ads.example.org" });
  assert.equal(senderAllowed("anna@example.org", s), true);
  assert.equal(senderAllowed("x@sub.example.org", s), true, "subdomains count");
  assert.equal(senderAllowed("boss@corp.com", s), true);
  assert.equal(senderAllowed("other@corp.com", s), false, "an address, not its domain");
  assert.equal(senderAllowed("x@ads.example.org", s), false, "never beats only");
  assert.equal(senderAllowed("x@elsewhere.net", s), false);
  assert.equal(senderAllowed(null, s), false);
  assert.equal(senderAllowed("x@elsewhere.net", parseAttachmentSettings({})), true);
  assert.equal(senderAllowed("news@list.com", parseAttachmentSettings({ neverFrom: "list.com" })), false);
  assert.equal(senderAllowed("notexample.org@x.com", parseAttachmentSettings({ neverFrom: "example.org" })), true);

  assert.equal(folderAllowed("Posteingang", parseAttachmentSettings({})), true);
  assert.equal(folderAllowed("Posteingang", parseAttachmentSettings({ onlyFolders: "posteingang" })), true);
  assert.equal(folderAllowed("Notifications", parseAttachmentSettings({ onlyFolders: "Posteingang" })), false);

  assert.equal(mailSourceOf("gmail:abc"), "gmail");
  assert.equal(mailSourceOf("wa:123"), null);
  assert.equal(mailSourceOf("AAQkAGI="), "outlook");

  assert.equal(documentName("Re: Rechnung 4711", "scan.pdf"), "Rechnung 4711 - scan.pdf");
  assert.ok(documentName("x".repeat(300), "scan.pdf").endsWith(" - scan.pdf"));
  assert.ok(documentName("x".repeat(300), "scan.pdf").length <= 120);
  assert.equal(documentName("Hi", "y".repeat(118) + ".pdf"), "y".repeat(118) + ".pdf", "no room: the file name alone");
});

test("mime: attachments are read out of a raw mail", async () => {
  const { mimeAttachments, mimeOfName } = await import("@/lib/mail/mime.mjs");
  const eml = [
    "From: a@b.c",
    'Content-Type: multipart/mixed; boundary="B1"',
    "",
    "preamble",
    "--B1",
    "Content-Type: multipart/alternative; boundary=B2",
    "",
    "--B2",
    "Content-Type: text/plain",
    "",
    "hello",
    "--B2",
    "Content-Type: text/html",
    "",
    "<b>hello</b>",
    "--B2--",
    "--B1",
    'Content-Type: application/pdf; name="=?UTF-8?B?UsOkY2hudW5nLnBkZg==?="',
    "Content-Disposition: attachment; filename*0*=UTF-8''Rechnung%20; filename*1*=%C3%A4.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4 hello").toString("base64"),
    "--B1",
    "Content-Type: image/png",
    "Content-Disposition: inline",
    "Content-ID: <logo@x>",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from([1, 2, 3, 4]).toString("base64"),
    "--B1",
    'Content-Type: text/plain; name="note.txt"',
    "Content-Disposition: attachment; filename=note.txt",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "caf=C3=A9 =\r\nlatte",
    "--B1--",
    "",
  ].join("\r\n");
  const list = mimeAttachments(Buffer.from(eml, "latin1"));
  assert.equal(list.length, 3, "the bodies are not attachments");
  assert.equal(list[0].name, "Rechnung ä.pdf");
  assert.equal(list[0].mime, "application/pdf");
  assert.equal(list[0].data.toString(), "%PDF-1.4 hello");
  assert.equal(list[0].inline, false);
  assert.equal(list[1].inline, true);
  assert.equal(list[1].size, 4);
  assert.match(list[1].name, /^attachment-2\.png$/);
  assert.equal(list[2].data.toString("utf8"), "café latte");
  assert.equal(mimeOfName("x.XLSX"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

// ---------------------------------------------------------------------------
// The sync step against a stand-in driver
// ---------------------------------------------------------------------------

type Fixture = { name: string; mime?: string; content: Buffer | string; inline?: boolean };

/** A stand-in for the Outlook and Gmail drivers' attachment tools (same contract), counting what it is asked. */
function standIn(mails: Record<string, Fixture[]>) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const opener = async <T>(_source: string, body: (call: (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>) =>
    body(async (tool, args) => {
      calls.push({ tool, args });
      const list = mails[String(args.ref)];
      if (!list) throw new Error(`no such message ${String(args.ref)}`);
      const opened = tool.startsWith("outlook");
      const buf = (f: Fixture) => (Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
      if (tool.endsWith("_attachments")) {
        return { opened, wasUnread: !!args.wasUnread, restoredUnread: opened && !!args.wasUnread && !!args.restoreUnread, attachments: list.map((f, i) => ({ id: String(i + 1), name: f.name, mime: f.mime ?? "", size: buf(f).length, inline: !!f.inline })) };
      }
      const dir = String(args.dir);
      fs.mkdirSync(dir, { recursive: true });
      const ids = (args.ids as string[]).map(String);
      const files = list.flatMap((f, i) => {
        if (!ids.includes(String(i + 1))) return [];
        const p = `${dir}/${i + 1}-${f.name}`;
        fs.writeFileSync(p, buf(f));
        return [{ id: String(i + 1), name: f.name, mime: f.mime ?? "", size: buf(f).length, path: p }];
      });
      return { opened, restoredUnread: opened && !!args.wasUnread && !!args.restoreUnread, files, skipped: [] };
    });
  return { calls, opener };
}

const KB = 1024;

async function setup() {
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  for (const id of ["documents", "gmail", "outlook-mail"]) db.insert(schema.plugins).values({ id, installed: true, changedAt: new Date().toISOString() }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed: true } }).run();
  (globalThis as { __zeffInstalled?: Map<string, unknown> }).__zeffInstalled?.clear();
  // Each test starts from an empty mailbox.
  db.delete(schema.mailAttachments).run();
  db.delete(schema.emails).run();
  db.delete(schema.documents).run();
  const { saveMails } = await import("@/lib/mail/store");
  const store = await import("@/lib/mail/attachments-store");
  const sync = await import("@/lib/mail/attachments-sync");
  const mail = (o: { n: string; source: "gmail" | "outlook"; unread?: boolean; from?: string; folder?: string; ago?: number }) => {
    const receivedAt = new Date(Date.now() - (o.ago ?? 1) * 864e5).toISOString();
    saveMails([
      o.source === "gmail"
        ? { id: `msg-f:${o.n}`, convId: `gmail:${o.n}`, folder: o.folder ?? "Gmail", from: "Anna", fromEmail: o.from ?? "anna@example.org", subject: `Subject ${o.n}`, preview: `preview ${o.n}`, receivedAt, unread: !!o.unread, hasAttachments: true }
        : { convId: `AAQk${o.n}`, folder: o.folder ?? "Posteingang", from: "Bob", fromEmail: o.from ?? "bob@example.org", subject: `Subject ${o.n}`, preview: `preview ${o.n}`, receivedAt, unread: !!o.unread, hasAttachments: true, attachRef: `item-${o.n}` },
    ]);
    return o.source === "gmail" ? `msg-f:${o.n}` : `item-${o.n}`;
  };
  return { db, schema, store, sync, mail };
}

test("mail attachments: off by default — nothing is asked of a driver", async () => {
  const { sync, mail } = await setup();
  const ref = mail({ n: "100", source: "gmail" });
  const d = standIn({ [ref]: [{ name: "a.txt", content: "hello" }] });
  sync.setAttachmentSessionOpener(d.opener);
  const r = await sync.fetchMailAttachments();
  assert.equal(r.ran, false);
  assert.equal(d.calls.length, 0);
  sync.setAttachmentSessionOpener(null);
});

test("mail attachments: fetched once, the rules applied, documents carry their origin", async () => {
  const { sync, store, db, schema, mail } = await setup();
  store.saveAttachmentSettings({ enabled: true, sources: { outlook: true, gmail: true } });
  const ref = mail({ n: "200", source: "gmail", unread: true });
  const d = standIn({
    [ref]: [
      { name: "Bericht.txt", content: "Quarterly report text" },
      { name: "tool.exe", content: Buffer.alloc(60 * KB, 1) },
      { name: "logo.png", content: Buffer.alloc(4 * KB, 2), inline: true },
      { name: "huge.csv", content: Buffer.alloc(26 * 1024 * KB, 3) },
      { name: "empty.txt", content: "" },
    ],
  });
  sync.setAttachmentSessionOpener(d.opener);
  try {
    const r = await sync.fetchMailAttachments();
    assert.equal(r.ran, true);
    assert.equal(r.documents, 1);
    assert.match(r.message, /1 attachments → documents/);
    // The unread Gmail mail was handled: Gmail's driver doesn't open mails.
    assert.equal(d.calls.filter((c) => c.tool === "gmail_attachments").length, 1);
    const dl = d.calls.find((c) => c.tool === "gmail_download");
    assert.deepEqual(dl?.args.ids, ["1"], "only the one that passes the rules is downloaded (no exe, no tiny picture, no 26 MB, no empty file)");
    assert.equal(dl?.args.maxBytes, 25 * 1024 * KB);
    assert.equal(dl?.args.account, "0");
    // The document is there, named with the mail's subject, and knows where it came from.
    const docs = db.select().from(schema.documents).all();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].name, "Subject 200 - Bericht.txt");
    const origins = store.documentOrigins([docs[0].id]);
    assert.equal(origins[docs[0].id].subject, "Subject 200");
    assert.equal(origins[docs[0].id].from, "Anna");
    assert.equal(origins[docs[0].id].source, "gmail");
    // The bookkeeping: every attachment seen, each with its fate.
    const rows = store.attachmentRows("gmail", db.select().from(schema.emails).all().find((m) => m.subject === "Subject 200")!.key);
    assert.deepEqual(rows.map((x) => `${x.name}:${x.status}:${x.error}`).sort(), ["Bericht.txt:done:", "empty.txt:skipped:empty", "huge.csv:skipped:large", "logo.png:skipped:small-picture", "tool.exe:skipped:blocked"]);
    // A second run does not fetch anything again.
    const before = d.calls.length;
    const again = await sync.fetchMailAttachments();
    assert.equal(d.calls.length, before, "the mail is known: no driver call at all");
    assert.equal(again.documents, 0);
    assert.equal(again.message, "");
    // The temporary files are gone.
    const tmpLeft = fs.readdirSync(await import("node:os").then((o) => o.tmpdir())).filter((f) => f.startsWith("zeff-attach-"));
    assert.deepEqual(tmpLeft, []);
    // A skipped one is taken once the rules allow it: no new fetch of the others.
    store.saveAttachmentSettings({ maxMB: 30 });
    const third = await sync.fetchMailAttachments();
    assert.equal(third.documents, 1, "the 26 MB file now passes");
    assert.deepEqual(d.calls.filter((c) => c.tool === "gmail_download").at(-1)?.args.ids, ["4"]);
    store.saveAttachmentSettings({ maxMB: 25 });
  } finally {
    sync.setAttachmentSessionOpener(null);
  }
});

test("mail attachments: unread mails an Outlook mail would have to open are left alone, unless allowed", async () => {
  const { sync, store, mail } = await setup();
  store.saveAttachmentSettings({ enabled: true, unread: "skip" });
  const ref = mail({ n: "300", source: "outlook", unread: true });
  const readRef = mail({ n: "301", source: "outlook", unread: false });
  const d = standIn({ [ref]: [{ name: "u.txt", content: "unread one" }], [readRef]: [{ name: "r.txt", content: "read one" }] });
  sync.setAttachmentSessionOpener(d.opener);
  try {
    const r = await sync.fetchMailAttachments();
    assert.equal(r.unreadLeft, 1);
    assert.equal(r.documents, 1);
    assert.ok(d.calls.every((c) => c.args.ref === readRef), "the unread mail was never opened");
    assert.match(r.message, /1 unread mails left alone/);
    assert.equal(d.calls[0].args.restoreUnread, false);
    // Allowed: it is opened — and asked to be marked unread again.
    store.saveAttachmentSettings({ unread: "include" });
    const r2 = await sync.fetchMailAttachments();
    assert.equal(r2.documents, 1);
    assert.equal(r2.openedUnread, 1);
    assert.equal(r2.restored, 2, "restored after listing and after the download");
    const open = d.calls.find((c) => c.args.ref === ref);
    assert.equal(open?.args.wasUnread, true);
    assert.equal(open?.args.restoreUnread, true);
    assert.match(r2.message, /1 unread mails opened, marked unread again/);
  } finally {
    sync.setAttachmentSessionOpener(null);
    store.saveAttachmentSettings({ unread: "skip" });
  }
});

test("mail attachments: folder, sender and source filters, and the window", async () => {
  const { sync, store, mail } = await setup();
  store.saveAttachmentSettings({ enabled: true, onlyFolders: ["Posteingang"], neverFrom: ["spam.test"], onlyFrom: [], days: 14, sources: { outlook: true, gmail: false } });
  const inbox = mail({ n: "400", source: "outlook" });
  const other = mail({ n: "401", source: "outlook", folder: "Notifications" });
  const spam = mail({ n: "402", source: "outlook", from: "x@spam.test" });
  const old = mail({ n: "403", source: "outlook", ago: 30 });
  const gm = mail({ n: "404", source: "gmail" });
  const fx = { name: "f.txt", content: "text" };
  const d = standIn({ [inbox]: [fx], [other]: [fx], [spam]: [fx], [old]: [fx], [gm]: [fx] });
  sync.setAttachmentSessionOpener(d.opener);
  try {
    await sync.fetchMailAttachments();
    const refs = new Set(d.calls.map((c) => c.args.ref));
    assert.deepEqual([...refs], [inbox]);
    // The window and the source follow the settings.
    store.saveAttachmentSettings({ onlyFolders: [], neverFrom: [], days: 60, sources: { outlook: false, gmail: true } });
    d.calls.length = 0;
    await sync.fetchMailAttachments();
    assert.deepEqual([...new Set(d.calls.map((c) => c.args.ref))], [gm]);
  } finally {
    sync.setAttachmentSessionOpener(null);
    store.saveAttachmentSettings({ sources: { outlook: true, gmail: true }, days: 14 });
  }
});

test("mail attachments: only on request when set so, and a run is capped", async () => {
  const { sync, store, mail, db, schema } = await setup();
  db.delete(schema.emails).run();
  store.saveAttachmentSettings({ enabled: true, when: "manual", sources: { outlook: false, gmail: true } });
  const fx = { name: "f.txt", content: "capped text " };
  const fixtures: Record<string, Fixture[]> = {};
  for (let i = 0; i < 20; i++) fixtures[mail({ n: `5${String(i).padStart(2, "0")}`, source: "gmail" })] = [{ ...fx, content: `capped text ${i}` }];
  const d = standIn(fixtures);
  sync.setAttachmentSessionOpener(d.opener);
  try {
    const auto = await sync.fetchMailAttachments();
    assert.equal(auto.ran, false, "“only when I click” — a sync does nothing");
    assert.equal(d.calls.length, 0);
    const manual = await sync.fetchMailAttachments({ manual: true });
    assert.equal(manual.documents, 20, "the button has roomier limits");
    store.saveAttachmentSettings({ when: "sync" });
    // 20 new mails, an automatic run takes 15 and says so.
    db.delete(schema.mailAttachments).run();
    db.delete(schema.documents).run();
    d.calls.length = 0;
    const capped = await sync.fetchMailAttachments();
    assert.equal(capped.mails, 15);
    assert.equal(capped.more, 5);
    assert.match(capped.message, /5 more mails next time/);
    const rest = await sync.fetchMailAttachments();
    assert.equal(rest.mails, 5, "the rest next time");
  } finally {
    sync.setAttachmentSessionOpener(null);
  }
});

test("mail attachments: a driver failure is a note, never a throw — and is retried only a few times", async () => {
  const { sync, store, mail, db, schema } = await setup();
  db.delete(schema.emails).run();
  db.delete(schema.mailAttachments).run();
  store.saveAttachmentSettings({ enabled: true, when: "sync", sources: { outlook: false, gmail: true } });
  mail({ n: "600", source: "gmail" });
  let calls = 0;
  sync.setAttachmentSessionOpener(async (_s, body) =>
    body(async () => {
      calls++;
      throw new Error("Gmail did not answer");
    }),
  );
  try {
    const first = await sync.fetchMailAttachments();
    assert.equal(first.failed, 1);
    assert.match(first.message, /1 attachments failed/);
    await sync.fetchMailAttachments();
    await sync.fetchMailAttachments();
    const after = calls;
    assert.equal(after, 3, "three tries");
    const fourth = await sync.fetchMailAttachments();
    assert.equal(calls, after, "then left alone");
    assert.equal(fourth.message, "");
    assert.equal(store.attachmentTotals().failed, 1);
    // The whole session failing (Chrome down) is reported, not thrown.
    mail({ n: "601", source: "gmail" });
    sync.setAttachmentSessionOpener(async () => {
      throw new Error("The automation Chrome isn't running");
    });
    const down = await sync.fetchMailAttachments();
    assert.match(down.message, /attachments: Gmail: The automation Chrome isn't running/);
  } finally {
    sync.setAttachmentSessionOpener(null);
  }
});

test("mail attachments: the mail list tells which mails have them", async () => {
  const { store, db, schema } = await setup();
  const { saveMails } = await import("@/lib/mail/store");
  saveMails([
    { convId: "AAQkZ1", from: "x", fromEmail: "x@y.z", subject: "with", preview: "p1", receivedAt: new Date().toISOString(), unread: false, hasAttachments: true, attachRef: "item-z1" },
    { convId: "AAQkZ2", from: "x", fromEmail: "x@y.z", subject: "without", preview: "p2", receivedAt: new Date().toISOString(), unread: false, hasAttachments: false },
    { id: "msg-f:777", convId: "gmail:777", folder: "Gmail", from: "x", fromEmail: "x@y.z", subject: "gm", preview: "p3", receivedAt: new Date().toISOString(), unread: false, hasAttachments: true },
  ]);
  const rows = db.select().from(schema.emails).all();
  const get = (s: string) => rows.find((r) => r.subject === s)!;
  assert.equal(get("with").hasAttachments, true);
  assert.equal(get("with").attachRef, "item-z1");
  assert.equal(get("without").hasAttachments, false);
  assert.equal(get("without").attachRef, null);
  assert.equal(get("gm").attachRef, "msg-f:777", "Gmail's message id is the reference");
  // Read again later: the flag follows the list.
  saveMails([{ convId: "AAQkZ2", from: "x", fromEmail: "x@y.z", subject: "without", preview: "p2", receivedAt: get("without").receivedAt, unread: false, hasAttachments: true, attachRef: "item-z2" }]);
  assert.equal(db.select().from(schema.emails).all().find((r) => r.subject === "without")?.hasAttachments, true);
  assert.equal(store.unknownAttachmentMails(30) >= 0, true);
});

test("mail attachments: the one-time notice shows until answered", async () => {
  const { store, db, schema } = await setup();
  db.delete(schema.prefs).run();
  assert.equal(store.attachmentOfferOpen(), true, "installed, off, never answered");
  store.answerAttachmentOffer("later");
  assert.equal(store.attachmentOfferOpen(), false);
  db.delete(schema.prefs).run();
  store.saveAttachmentSettings({ enabled: true });
  assert.equal(store.attachmentOfferOpen(), false, "already on");
  assert.equal(store.attachmentSettings().enabled, true);
});
