import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

/**
 * Mail and messages as data sources of the Workspace: a pipeline reads mails (Outlook, Gmail — by account, folder, unread)
 * or messages (Teams, WhatsApp, Signal — by channel, chat) into a database of that type: fixed, typed fields a view can rely
 * on (from, folder, received, unread / sender, chat, channel, sent, mine), the text as the row's page. A view of an app
 * (the mail client, the chat) is a view like any — shown when its plugin is installed, a table without it.
 */
test("mail source: Outlook and Gmail mails (not the chats) into a mail database, typed", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "gmail", "whatsapp", "teams", "mail-client"]) setInstalled(id, true);
  const { saveMails } = await import("@/lib/mail/store");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { docText } = await import("@/plugins/workspace/doc");
  saveMails([
    { convId: "AAQk1", folder: "Posteingang", from: "Anna Berg", fromEmail: "anna@example.com", subject: "Angebot PROJ", preview: "Hier das Angebot.", receivedAt: ago(2), unread: true },
    { id: "g1", convId: "gmail:1f2e", folder: "Gmail", from: "Ben", fromEmail: "ben@example.com", subject: "Urlaub", preview: "Wann fliegen wir?", receivedAt: ago(5), unread: false },
    { id: "w1", convId: "wa:4917", folder: "WhatsApp", from: "Carla", fromEmail: null, subject: "Carla", preview: "Bis gleich!", receivedAt: ago(1), unread: true },
  ]);
  const dbId = w.createPage({ kind: "database", title: "Post", schema: { titleName: "Subject", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "mail", mail: { accounts: ["outlook", "gmail"], recentDays: 30 } }] } } });
  const r = await runPipeline(dbId, { ai: false });
  assert.equal(r.ok, true, r.error);
  const d = w.getDatabase(dbId)!;
  assert.equal(d.schema.dataType, "mail", "a mail database");
  const rows = w.rawRows(dbId);
  assert.deepEqual(rows.map((x) => x.title).sort(), ["Angebot PROJ", "Urlaub"], "the mails, not the chats");
  const prop = (id: string) => d.schema.properties.find((p) => p.id === id)!;
  assert.equal(prop("mailfrom").type, "text");
  assert.equal(prop("mailreceived").type, "date");
  assert.equal(prop("mailunread").type, "checkbox");
  const anna = rows.find((x) => x.title === "Angebot PROJ")!;
  assert.equal(anna.cells.mailfrom, "Anna Berg <anna@example.com>");
  assert.equal(anna.cells.mailunread, true);
  assert.equal(prop("mailaccount").options!.find((o) => o.id === anna.cells.mailaccount)?.name, "Outlook");
  assert.equal(anna.cells.srcref, `mail:${anna.cells.srcref ? String(anna.cells.srcref).slice(5) : ""}`);
  assert.match(docText(w.getPage(anna.id)!.content), /Hier das Angebot\./, "the text as its page");

  w.updateSchema(dbId, { ...d.schema, pipeline: { steps: [{ id: "s", kind: "source", from: "mail", mail: { unreadOnly: true } }] } });
  await runPipeline(dbId, { ai: false });
  assert.deepEqual(w.rawRows(dbId).map((x) => x.title), ["Angebot PROJ"], "unread only");

  // A mail client's view: there while its plugin is.
  const { appViewsFor } = await import("@/plugins/workspace/app-views");
  assert.deepEqual(appViewsFor("mail").map((a) => a.id), ["mail"]);
  setInstalled("mail-client", false);
  assert.deepEqual(appViewsFor("mail"), [], "no plugin: no app view (the database shows as a table)");
  setInstalled("mail-client", true);
  const s = m.normalizeSchema({ titleName: "S", properties: [], views: [{ ...m.newView("Mail", "table"), type: "app", app: "mail" }], dataType: "mail" });
  assert.equal(s.views[0].type, "app");
  assert.equal(s.views[0].app, "mail");
});

test("messages source: Teams, WhatsApp, Signal into a message database — sender, chat, channel, mine", async () => {
  const { saveMails } = await import("@/lib/mail/store");
  const { saveTeamsMessages } = await import("@/lib/teams/store");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  saveMails([{ id: "w2", convId: "wa:4917", folder: "WhatsApp", from: "Ich", fromEmail: null, subject: "Carla", preview: "Komme gleich.", receivedAt: ago(0.5), unread: false }]);
  saveTeamsMessages([{ key: "19:abc|m1", kind: "chat", mentionType: null, conversationId: "19:abc", replyChainId: null, messageId: "m1", place: "Chat mit Rico", senderName: "Rico Clemen", senderId: "u1", sentAt: Date.now() - 3600e3, subject: null, html: "<p>Deploy heute?</p>", text: "Deploy heute?", link: "https://teams.microsoft.com/l/message/19:abc/m1", isRead: null }]);
  const dbId = w.createPage({ kind: "database", title: "Chats", schema: { titleName: "Text", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "messages", messages: { channels: ["teams", "whatsapp"], recentDays: 7 } }] } } });
  const r = await runPipeline(dbId, { ai: false });
  assert.equal(r.ok, true, r.error);
  const d = w.getDatabase(dbId)!;
  assert.equal(d.schema.dataType, "message");
  const rows = w.rawRows(dbId);
  const by = (text: string) => rows.find((x) => x.title.startsWith(text))!;
  assert.ok(by("Bis gleich") && by("Komme gleich") && by("Deploy heute"), "WhatsApp and Teams messages");
  const opt = (pid: string, v: unknown) => d.schema.properties.find((p) => p.id === pid)!.options!.find((o) => o.id === v)?.name;
  assert.equal(opt("msgchannel", by("Deploy").cells.msgchannel), "Teams");
  assert.equal(by("Deploy").cells.msgchat, "Chat mit Rico");
  assert.equal(by("Deploy").cells.msgsender, "Rico Clemen");
  assert.equal(by("Komme").cells.msgmine, true, "my own message");
  assert.equal(by("Bis").cells.msgmine, undefined);
  assert.equal(by("Komme").cells.msgchat, "Carla");
  assert.match(String(by("Deploy").cells.srcref), /^teams:/);
});

test("capabilities: what a database's sources let you do — reply in the channels whose plugin sends; mail read-only", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const m = await import("@/plugins/workspace/model");
  const { capabilitiesOf } = await import("@/plugins/workspace/capabilities");
  const msgs = m.normalizeSchema({ titleName: "T", properties: [], views: [], dataType: "message", pipeline: { steps: [{ id: "s", kind: "source", from: "messages", messages: { channels: ["teams", "whatsapp"] } }] } });
  setInstalled("teams", true);
  setInstalled("whatsapp", false);
  assert.deepEqual(capabilitiesOf(msgs).reply, ["Teams"], "Teams sends; WhatsApp's plugin is off; Signal isn't read");
  const mail = m.normalizeSchema({ titleName: "T", properties: [], views: [], dataType: "mail", pipeline: { steps: [{ id: "s", kind: "source", from: "mail" }] } });
  setInstalled("outlook-mail", true);
  assert.deepEqual(capabilitiesOf(mail).reply.sort(), ["Gmail", "Outlook"], "mail: a draft in Outlook, in Gmail (their plugins installed)");
  assert.deepEqual(capabilitiesOf(mail).drafts.sort(), ["Gmail", "Outlook"], "a draft you send yourself");
  setInstalled("outlook-mail", false);
  setInstalled("gmail", false);
  assert.equal(capabilitiesOf(mail).readOnly, true, "no mail plugin: read-only");
  setInstalled("whatsapp", true);
});
