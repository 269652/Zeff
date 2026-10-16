import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

/**
 * A combined inbox, made by naming several sources: a pipeline with a mail source and a messages source gets the one set of
 * fields all of them share (From, Date, Channel, Where, Unread, Mine, Conversation) and the type "inbox" — shown by the inbox
 * view of the Mail & Chat plugin, one list across channels. Rules, derived databases, counters and replies work on it as on
 * any database.
 */
test("mixed sources: one set of fields, the type inbox — rules by channel, a derived database, counters", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "gmail", "teams", "whatsapp", "mail-client"]) setInstalled(id, true);
  const { saveMails } = await import("@/lib/mail/store");
  const { saveTeamsMessages } = await import("@/lib/teams/store");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase, createDerivedDatabase } = await import("@/plugins/workspace/derived");
  saveMails([
    { convId: "IN1", folder: "Posteingang", from: "Anna Berg", fromEmail: "anna@example.com", subject: "Angebot", preview: "Hier das Angebot.", receivedAt: ago(3), unread: true },
    { id: "w9", convId: "wa:49170", folder: "WhatsApp", from: "Carla", fromEmail: null, subject: "Carla", preview: "Bist du da?", receivedAt: ago(1), unread: true },
  ]);
  saveTeamsMessages([{ key: "19:in|m1", kind: "chat", mentionType: null, conversationId: "19:in", replyChainId: null, messageId: "m1", place: "Chat mit Rico", senderName: "Rico Clemen", senderId: "u1", sentAt: Date.now() - 2 * 3600e3, subject: null, html: "<p>Deploy heute?</p>", text: "Deploy heute?", link: "https://teams.microsoft.com/l/x", isRead: null }]);

  const id = createSourceDatabase("inbox");
  const d0 = w.getDatabase(id)!;
  assert.deepEqual(d0.schema.pipeline!.steps.filter((s) => s.kind === "source").map((s) => s.from), ["mail", "messages"], "its sources, as named");
  await runPipeline(id, { ai: false });
  const d = w.getDatabase(id)!;
  assert.equal(d.schema.dataType, "inbox");
  assert.ok(d.schema.views.some((v) => v.type === "app" && v.app === "inbox"), "the inbox view");
  const rows = w.rawRows(id);
  assert.deepEqual(rows.map((r) => r.title).sort(), ["Angebot", "Bist du da?", "Deploy heute?"], "all channels in one list");
  const opt = (pid: string, v: unknown) => d.schema.properties.find((p) => p.id === pid)!.options!.find((o) => o.id === v)?.name;
  const mail = rows.find((r) => r.title === "Angebot")!;
  const teams = rows.find((r) => r.title === "Deploy heute?")!;
  assert.equal(opt("commchannel", mail.cells.commchannel), "Outlook");
  assert.equal(opt("commchannel", teams.cells.commchannel), "Teams");
  assert.equal(mail.cells.commfrom, "Anna Berg <anna@example.com>");
  assert.equal(teams.cells.commfrom, "Rico Clemen");
  assert.equal(mail.cells.commwhere, "Posteingang", "a mail's folder");
  assert.equal(teams.cells.commwhere, "Chat mit Rico", "a chat's name");
  assert.equal(mail.cells.communread, true);
  assert.ok(typeof teams.cells.commwhen === "string" && typeof mail.cells.commconv === "string");

  // Rules by the shared names; a derived database keeps the type and the fields.
  const rules = (list: unknown[]) => {
    const cur = w.getDatabase(id)!;
    w.updateSchema(id, { ...cur.schema, pipeline: { steps: [...cur.schema.pipeline!.steps.filter((s) => s.kind === "source"), { id: "f", kind: "filter", rules: list } as never] } });
  };
  rules([{ field: "Channel", op: "is", value: "Teams" }]);
  await runPipeline(id, { ai: false });
  assert.deepEqual(w.rawRows(id).map((r) => r.title), ["Deploy heute?"], "a rule by channel");
  rules([]);
  await runPipeline(id, { ai: false });
  const child = createDerivedDatabase(id, "Ungelesen");
  assert.equal(w.getDatabase(child)!.schema.dataType, "inbox", "a derived one is an inbox too");
  const cd = w.getDatabase(child)!;
  w.updateSchema(child, { ...cd.schema, pipeline: { ...cd.schema.pipeline!, steps: [cd.schema.pipeline!.steps[0], { id: "u", kind: "filter", rules: [{ field: "Unread", op: "is", value: "yes" }] } as never] } });
  await runPipeline(child, { ai: false });
  assert.deepEqual(w.rawRows(child).map((r) => r.title).sort(), ["Angebot", "Bist du da?"], "unread ones, across channels");
  assert.equal(w.getDatabase(child)!.schema.dataType, "inbox");
  assert.equal(w.unreadCounts()[child], 2, "the sidebar's counter");
  assert.equal(w.unreadCounts()[id], 2);
});

test("an inbox: its views, what can be answered per channel — a mail a draft, a chat sent", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "teams", "mail-client"]) setInstalled(id, true);
  setInstalled("gmail", false);
  setInstalled("whatsapp", false);
  setInstalled("signal", false);
  const w = await import("@/plugins/workspace/store");
  const { appViewsFor } = await import("@/plugins/workspace/app-views");
  const { capabilitiesOf } = await import("@/plugins/workspace/capabilities");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  assert.deepEqual(appViewsFor("inbox").map((a) => a.id), ["inbox"]);
  const id = createSourceDatabase("inbox");
  const caps = capabilitiesOf(w.getDatabase(id)!.schema);
  assert.deepEqual(caps.reply.sort(), ["Outlook", "Teams"], "a mail by draft, Teams sent");
  assert.deepEqual(caps.drafts, ["Outlook"]);
  assert.equal(w.getDatabase(id)!.page.title, "Inbox");
});

test("a reply to an inbox row: the target by its channel — a mail's address and subject, a chat's name", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "teams", "mail-client", "llm", "claude-cli"]) setInstalled(id, true);
  const path = await import("node:path");
  const { ROOT } = await import("./helpers");
  process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Gerne." });
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const { draftRowReply } = await import("@/plugins/workspace/row-actions");
  const id = createSourceDatabase("inbox");
  await runPipeline(id, { ai: false });
  const rows = w.rawRows(id);
  const mail = rows.find((r) => r.title === "Angebot")!;
  const teams = rows.find((r) => r.title === "Deploy heute?")!;
  const a = await draftRowReply(mail.id);
  assert.deepEqual([a.channel, a.to, a.subject], ["Outlook", "anna@example.com", "AW: Angebot"]);
  const b = await draftRowReply(teams.id);
  assert.deepEqual([b.channel, b.to], ["Teams", "Chat mit Rico"]);
});

test("ensureMailDatabases: the combined inbox is made with Mail and Chats — once, when both kinds of sources are there", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "teams", "mail-client"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { ensureMailDatabases, homeDatabase } = await import("@/plugins/workspace/mail-databases");
  await ensureMailDatabases();
  const inbox = homeDatabase("inbox");
  assert.ok(inbox, "an Inbox");
  assert.equal(w.getDatabase(inbox!)!.page.title, "Inbox");
  assert.equal(w.getDatabase(inbox!)!.schema.dataType, "inbox");
  assert.ok(w.rawRows(inbox!).length > 0, "its rows read at once");
  const before = w.tree().length;
  await ensureMailDatabases();
  assert.equal(w.tree().length, before, "once");
});

test("any database becomes an inbox: naming the channels as sources — its Inbox view follows, rows of its own stay", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "teams", "mail-client"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { makeInbox } = await import("@/plugins/workspace/derived");
  const id = w.createPage({ kind: "database", title: "Eigene" });
  w.addRow(id, { title: "Von Hand" });
  makeInbox(id);
  makeInbox(id); // once: no source twice
  const d = w.getDatabase(id)!;
  assert.deepEqual(d.schema.pipeline!.steps.filter((s) => s.kind === "source").map((s) => s.from), ["mail", "messages"]);
  await runPipeline(id, { ai: false });
  const after = w.getDatabase(id)!;
  assert.equal(after.schema.dataType, "inbox");
  assert.ok(after.schema.views.some((v) => v.type === "app" && v.app === "inbox"));
  assert.ok(w.rawRows(id).some((r) => r.title === "Von Hand"), "its own row stays");
});

test("data sources: the catalog lists every database that names a channel as a source — the inbox, derived ones, own ones", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "teams", "mail-client"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { makeInbox } = await import("@/plugins/workspace/derived");
  const { sourcesOverview } = await import("@/plugins/workspace/sources");
  const own = w.createPage({ kind: "database", title: "Meine Kanäle" });
  makeInbox(own);
  const sources = sourcesOverview();
  const titles = (k: string) => sources.find((s) => s.key === k)!.databases.map((d) => d.title);
  assert.ok(titles("mail").includes("Meine Kanäle") && titles("messages").includes("Meine Kanäle"), "its channels, from the database itself");
  assert.ok(titles("mail").includes("Inbox"));
  assert.ok(!titles("mail").includes("Chats"), "a chat database names no mail");
});

test("snooze: the inbox has the Snoozed-until field, and a snoozed row is not counted in the sidebar until its time", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "teams", "mail-client"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const id = createSourceDatabase("inbox");
  await runPipeline(id, { ai: false });
  assert.ok(w.getDatabase(id)!.schema.properties.some((p) => p.id === "commsnooze"), "the field");
  const unread = w.rawRows(id).filter((r) => r.cells.communread);
  assert.ok(unread.length >= 2);
  const before = w.unreadCounts()[id];
  w.setCell(unread[0].id, "commsnooze", new Date(Date.now() + 3600e3).toISOString());
  assert.equal(w.unreadCounts()[id], before - 1, "away while snoozed");
  w.setCell(unread[0].id, "commsnooze", new Date(Date.now() - 3600e3).toISOString());
  assert.equal(w.unreadCounts()[id], before, "back when the time has come");
  await runPipeline(id, { ai: false });
  assert.ok(w.rawRows(id).find((r) => r.id === unread[0].id)!.cells.commsnooze, "a run keeps it");
});
