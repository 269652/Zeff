import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

const dir = setupTempData();
process.env.ZEFF_CALENDAR_INBOX = path.join(dir, "calendar-inbox.json");

type Seen = { method: string; url: string; auth: string; body: string };

const ME = "me-id";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

/** A Microsoft of its own (Graph + the token endpoint): what it was asked, and what it answers. */
async function fakeMicrosoft(opts: { refuseAll?: boolean } = {}) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      seen.push({ method: req.method ?? "", url: `${u.pathname}${u.search}`, auth: String(req.headers.authorization ?? ""), body });
      const json = (code: number, v: unknown) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      const p = u.pathname;
      if (p === "/t/oauth2/v2.0/token") return json(200, { access_token: "fresh", refresh_token: "rotated", expires_in: 3600 });
      if (opts.refuseAll || req.headers.authorization === "Bearer stale") return json(401, { error: { code: "InvalidAuthenticationToken" } });
      if (p === "/me") return json(200, { id: ME, displayName: "Me Myself" });
      if (p === "/me/mailFolders") return json(200, { value: [{ id: "F-INBOX", displayName: "Posteingang" }, { id: "F-SENT", displayName: "Gesendete Elemente" }] });
      if (p === "/me/mailFolders/F-INBOX/childFolders") return json(200, { value: [{ id: "F-NOTIF", displayName: "Notifications" }] });
      if (p === "/me/mailFolders/F-INBOX/messages") {
        return json(200, {
          value: [
            { id: "M1", conversationId: "C1", subject: "Invoice", bodyPreview: "Please see\nattached", receivedDateTime: hoursAgo(2), isRead: false, hasAttachments: true, from: { emailAddress: { name: "Alice", address: "alice@x.de" } } },
            { id: "M2", conversationId: "C2", subject: "Hello", bodyPreview: "Hi", receivedDateTime: hoursAgo(5), isRead: true, hasAttachments: false, from: { emailAddress: { name: "", address: "bob@x.de" } } },
          ],
        });
      }
      if (p === "/me/mailFolders/F-NOTIF/messages") return json(200, { value: [] });
      if (p === "/me/messages/M1/attachments") return json(200, { value: [{ "@odata.type": "#microsoft.graph.fileAttachment", id: "A1", name: "invoice.pdf", contentType: "application/pdf", size: 5, isInline: false }, { "@odata.type": "#microsoft.graph.itemAttachment", id: "A2", name: "fwd", size: 9 }] });
      if (p === "/me/messages/M1/attachments/A1") return json(200, { id: "A1", name: "invoice.pdf", contentBytes: Buffer.from("hello").toString("base64") });
      if (p === "/me/calendarView") {
        return json(200, {
          value: [
            { id: "E1", iCalUId: "U1", subject: "Standup", start: { dateTime: "2026-10-13T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-13T09:15:00.0000000", timeZone: "UTC" }, isAllDay: false, isCancelled: false, showAs: "busy", organizer: { emailAddress: { name: "Boss", address: "boss@x.de" } } },
          ],
        });
      }
      if (p === "/me/chats") {
        return json(200, {
          value: [
            { id: "chat-1", chatType: "oneOnOne", topic: null, members: [{ userId: ME, displayName: "Me Myself" }, { userId: "u2", displayName: "Carol" }], lastMessagePreview: { createdDateTime: hoursAgo(1) } },
            { id: "chat-2", chatType: "group", topic: "Project X", members: [], lastMessagePreview: { createdDateTime: hoursAgo(3) } },
          ],
        });
      }
      if (p === "/me/chats/chat-1/messages") {
        return json(200, {
          value: [
            { id: "T1", messageType: "message", createdDateTime: hoursAgo(1), body: { contentType: "html", content: "<p>Can you look?</p>" }, from: { user: { id: "u2", displayName: "Carol" } }, mentions: [], webUrl: "https://teams.example/T1" },
            { id: "T2", messageType: "message", createdDateTime: hoursAgo(1.5), body: { contentType: "text", content: "ok <3" }, from: { user: { id: ME, displayName: "Me Myself" } }, mentions: [] },
            { id: "T3", messageType: "systemEventMessage", createdDateTime: hoursAgo(2), body: { content: "" }, from: null },
          ],
        });
      }
      if (p === "/me/chats/chat-2/messages") {
        return json(200, {
          value: [
            { id: "G1", messageType: "message", createdDateTime: hoursAgo(3), body: { contentType: "html", content: '<at id="0">Me Myself</at> deploy?' }, from: { user: { id: "u3", displayName: "Dave" } }, mentions: [{ id: 0, mentionText: "Me Myself", mentioned: { user: { id: ME } } }] },
            { id: "G2", messageType: "message", createdDateTime: hoursAgo(24 * 10), body: { contentType: "html", content: "old chatter" }, from: { user: { id: "u3", displayName: "Dave" } }, mentions: [] },
          ],
        });
      }
      return json(404, { error: { code: "NotFound" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ZEFF_GRAPH_URL = base;
  process.env.ZEFF_MS_LOGIN_URL = base;
  return { seen, base, close: () => server.close() };
}

async function signIn(accessToken = "good") {
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("microsoft", { authKind: "oauth", clientId: "app", refreshToken: "old", accessToken, expiresAt: Date.now() + 3600e3, extra: '{"tenant":"t"}' });
  for (const s of ["outlook-mail", "outlook-calendar", "teams"] as const) updateConnector(s, { driver: "api" });
}

test("Outlook Mail via Graph saves the mails like the Chrome driver does — without the automation Chrome", async () => {
  const ms = await fakeMicrosoft();
  try {
    await signIn();
    const { updateMailSettings } = await import("@/lib/mail/store");
    updateMailSettings({ folders: ["Posteingang", "Notifications", "Nirgendwo"] });
    const { syncMail } = await import("@/lib/mail/sync");
    // In the background with no automation Chrome: the API read still runs.
    const r = await syncMail({ background: true });
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /2 new/);
    assert.match(r.message, /not found in Outlook: Nirgendwo/);
    const { listMails } = await import("@/lib/mail/store");
    const mails = listMails({ limit: 10 });
    const invoice = mails.find((m) => m.subject === "Invoice")!;
    assert.equal(invoice.fromName, "Alice");
    assert.equal(invoice.fromEmail, "alice@x.de");
    assert.equal(invoice.unread, true);
    assert.equal(invoice.convId, "C1");
    assert.equal(invoice.folder, "Posteingang");
    assert.equal(invoice.preview, "Please see attached");
    assert.equal(mails.find((m) => m.subject === "Hello")!.fromName, "bob@x.de");
    const { getDb, schema } = await import("@/db");
    const row = getDb().select().from(schema.emails).all().find((e) => e.subject === "Invoice")!;
    assert.equal(row.attachRef, "M1");
    assert.equal(row.hasAttachments, true);
    const list = ms.seen.find((s) => s.url.startsWith("/me/mailFolders/F-INBOX/messages"))!;
    assert.match(decodeURIComponent(list.url), /receivedDateTime ge /);
    assert.ok(ms.seen.every((s) => s.method === "GET" || s.url.endsWith("/token")), "only reads");
    assert.ok(ms.seen.filter((s) => !s.url.endsWith("/token")).every((s) => s.auth === "Bearer good"));
  } finally {
    ms.close();
  }
});

test("Outlook attachments come through Graph (nothing opened)", async () => {
  const ms = await fakeMicrosoft();
  try {
    await signIn();
    const { outlookApiCall } = await import("@/lib/microsoft/mail-api");
    const listed = (await outlookApiCall("outlook_attachments", { ref: "M1" })) as { opened: boolean; attachments: { id: string; name: string; size: number; mime: string }[] };
    assert.equal(listed.opened, false);
    assert.deepEqual(listed.attachments.map((a) => a.name), ["invoice.pdf"], "only file attachments");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-att-"));
    const got = (await outlookApiCall("outlook_download", { ref: "M1", ids: ["A1"], dir: tmp })) as { files: { id: string; path: string }[] };
    assert.equal(got.files.length, 1);
    assert.equal(fs.readFileSync(got.files[0].path, "utf8"), "hello");
    fs.rmSync(tmp, { recursive: true, force: true });
  } finally {
    ms.close();
  }
});

test("Outlook Calendar via Graph writes the weeks' events", async () => {
  const ms = await fakeMicrosoft();
  try {
    await signIn();
    const { syncOutlookWeekStarts } = await import("@/lib/sync/pulls");
    const r = await syncOutlookWeekStarts(["2026-10-12"]);
    assert.deepEqual(r, { weeks: 1, events: 1 });
    const { readInbox } = await import("@/lib/calendar/inbox");
    const events = readInbox();
    assert.equal(events.length, 1);
    assert.equal(events[0].subject, "Standup");
    assert.equal(events[0].organizer?.emailAddress?.address, "boss@x.de");
    const call = ms.seen.find((s) => s.url.startsWith("/me/calendarView"))!;
    assert.match(call.url, /startDateTime=/);
  } finally {
    ms.close();
  }
});

test("Teams via Graph saves the mention, the 1:1 message and the chat's own ones", async () => {
  const ms = await fakeMicrosoft();
  try {
    await signIn();
    const { syncTeams } = await import("@/lib/teams/sync");
    const r = await syncTeams({ background: true });
    assert.equal(r.ok, true, r.message);
    const { listTeamsMessages } = await import("@/lib/teams/store");
    const all = listTeamsMessages({ limit: 20 });
    const mention = all.find((m) => m.kind === "mention")!;
    assert.equal(mention.senderName, "Dave");
    assert.equal(mention.place, "Project X");
    assert.match(mention.text, /Me Myself deploy\?/);
    const pm = all.find((m) => m.kind === "pm")!;
    assert.equal(pm.senderName, "Carol");
    assert.equal(pm.place, "Chat with Carol");
    assert.equal(pm.link, "https://teams.example/T1");
    const chats = listTeamsMessages({ kind: "chat", limit: 20 });
    assert.deepEqual(chats.map((m) => m.text), ["ok <3"], "yours, in the last days; no system messages, nothing old");
    assert.ok(!all.some((m) => /old chatter/.test(m.text)));
  } finally {
    ms.close();
  }
});

test("an expired token is refreshed once (and the new refresh token kept)", async () => {
  const ms = await fakeMicrosoft();
  try {
    await signIn("stale");
    const { whoAmI } = await import("@/lib/connectors/who");
    await whoAmI("microsoft");
    const { getConnector } = await import("@/lib/connectors/store");
    assert.equal(getConnector("microsoft").accessToken, "fresh");
    assert.equal(getConnector("microsoft").refreshToken, "rotated");
    const tokenCalls = ms.seen.filter((s) => s.url === "/t/oauth2/v2.0/token");
    assert.equal(tokenCalls.length, 1);
    assert.match(tokenCalls[0].body, /grant_type=refresh_token/);
  } finally {
    ms.close();
  }
});

test("a sign-in Microsoft refuses is told clearly and asks for no Chrome login", async () => {
  const ms = await fakeMicrosoft({ refuseAll: true });
  try {
    await signIn();
    const { listAttention } = await import("@/lib/attention");
    const { syncMail } = await import("@/lib/mail/sync");
    const mail = await syncMail();
    assert.equal(mail.ok, false);
    assert.match(mail.message, /Connections page/);
    const { syncTeams } = await import("@/lib/teams/sync");
    const teams = await syncTeams();
    assert.equal(teams.ok, false);
    assert.match(teams.message, /Connections page/);
    const keys = (await listAttention()).map((a) => a.key);
    assert.ok(!keys.includes("login:outlook") && !keys.includes("login:teams"), keys.join());
  } finally {
    ms.close();
  }
});
