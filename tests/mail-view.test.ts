import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { CHAT_VIEW, INBOX_VIEW, MAIL_VIEW } from "../src/plugins/mail-client/view-template.meta";
import { chatAppData, inboxAppData, mailAppData } from "../src/plugins/mail-client/view-data";
import type { ViewAppMeta } from "../src/plugins/workspace/view-apps";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const NOW = new Date("2026-10-22T15:00:00");
const opts = (...names: string[]) => names.map((n) => ({ id: n.toLowerCase(), name: n, color: "gray" }));
const row = (id: number, title: string, cells: Record<string, unknown>): Row => ({ id, title, icon: "", cells, createdAt: "2026-10-01", updatedAt: "2026-10-01" });
const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const parts = (nodes: VNode[]) => find(nodes, "part").map((p) => p.a.name);

// --- Mail ---

const MAIL_PROPS: Property[] = [
  { id: "mailfrom", name: "From", type: "text" },
  { id: "mailaccount", name: "Account", type: "select", options: opts("Outlook", "Gmail") },
  { id: "mailfolder", name: "Folder", type: "select", options: opts("Inbox", "Archive") },
  { id: "mailreceived", name: "Received", type: "date" },
  { id: "mailunread", name: "Unread", type: "checkbox" },
  { id: "mailconv", name: "Conversation", type: "text" },
  { id: "srcurl", name: "Link", type: "url" },
];
const mails = [
  row(1, "Invoice October", { mailfrom: "Anna Berg <anna@x.de>", mailaccount: "outlook", mailfolder: "inbox", mailreceived: "2026-10-20T09:00", mailconv: "c1", srcurl: "https://outlook.office.com/m/1" }),
  row(2, "AW: Meeting", { mailfrom: "Bob <bob@y.com>", mailaccount: "gmail", mailfolder: "inbox", mailreceived: "2026-10-22T14:03", mailunread: true, mailconv: "gmail:c2" }),
  row(3, "Newsletter", { mailfrom: "news@z.org", mailaccount: "outlook", mailfolder: "archive", mailreceived: "2026-10-21T08:00", mailunread: true }),
];
const previews = { 1: [{ text: "Please find" }, { text: "attached." }], 2: [{ text: "See you" }] };

const drawWith = (meta: ViewAppMeta, rows: Row[], props: Property[], state: Record<string, string>, app: Record<string, unknown>) =>
  renderView(meta.defaultTemplate(t), { rows, props, titleName: "Subject", state, app, db: { id: 7, title: "Mail" }, now: NOW, locale: "de-DE" }, { parts: meta.parts, actions: meta.actions });

test("mail data: newest first, unread only on the toggle, the first picked by default, the picked one worked out", () => {
  const a = mailAppData({ rows: mails, props: MAIL_PROPS, state: {}, previews, reply: ["Outlook"] });
  assert.deepEqual((a.mails as Row[]).map((r) => r.id), [2, 3, 1]);
  assert.equal(a.first, "2");
  assert.equal(a.unread, 2);
  assert.deepEqual(a.texts, { 1: { from: "Anna Berg", preview: "Please find attached." }, 2: { from: "Bob", preview: "See you" }, 3: { from: "news@z.org", preview: "" } });
  const cur = a.current as Record<string, unknown>;
  assert.equal(cur.id, 2, "nothing picked: the newest");
  assert.equal(cur.gmail, true);
  assert.equal(cur.canReply, false, "Gmail can't be replied to here");
  assert.deepEqual(cur.reply, { kind: "mail", account: "Gmail", to: "bob@y.com", subject: "AW: Meeting" });
  assert.equal(cur.conv, "gmail:c2");

  const b = mailAppData({ rows: mails, props: MAIL_PROPS, state: { unread: "true", selected: "1" }, previews, reply: ["Outlook"] });
  assert.deepEqual((b.mails as Row[]).map((r) => r.id), [2, 3]);
  const one = b.current as Record<string, unknown>;
  assert.equal(one.id, 1, "the one picked, even when the list doesn't show it");
  assert.equal(one.canReply, true);
  assert.equal(one.link, "https://outlook.office.com/m/1");
  assert.deepEqual(one.reply, { kind: "mail", account: "Outlook", to: "anna@x.de", subject: "AW: Invoice October" });
  assert.deepEqual(one.fallback, { key: "row", name: "Anna Berg <anna@x.de>", at: "20.10.", preview: "Please find\nattached.", mine: false });
  assert.equal(mailAppData({ rows: [], props: MAIL_PROPS, state: {} }).current, null);
});

const drawMail = (state: Record<string, string>, rows = mails) => drawWith(MAIL_VIEW, rows, MAIL_PROPS, state, mailAppData({ rows, props: MAIL_PROPS, state, previews, reply: ["Outlook"] }));

test("the mail client's default template draws without an error — picked or not, unread only, empty", () => {
  for (const state of [{}, { selected: "1" }, { selected: "2", unread: "true" }, { selected: "99" }] as Record<string, string>[]) assert.deepEqual(drawMail(state).errors, [], JSON.stringify(state));
  assert.deepEqual(drawMail({}, []).errors, []);
});

test("mail: the list and the reading pane are the language's — the parts only where it takes more", () => {
  const r = drawMail({});
  assert.equal(r.state.selected, "2", "the newest is picked to start with");
  const list = find(r.nodes, "list")[0];
  assert.equal(list.a.select, "true");
  assert.deepEqual(list.c.map((it) => (typeof it === "string" ? "" : it.a.row)), ["2", "3", "1"]);
  const first = vnodeToString(list.c[0]);
  assert.match(first, /<b>AW: Meeting<\/b>/, "unread: in bold");
  assert.match(first, /14:03/, "today: its time");
  assert.match(vnodeToString(list.c[2]), /20\.10\./, "before: its day");
  assert.doesNotMatch(vnodeToString(list.c[2]), /<b>Invoice/);
  const sel = find(r.nodes, "selected")[0];
  assert.equal(sel.a.row, "2");
  const pane = vnodeToString(sel);
  assert.match(pane, /AW: Meeting/);
  assert.match(pane, /Bob <bob@y\.com> · 14:03 · Gmail · Inbox/);
  assert.match(pane, /Read-only — reply in Outlook \/ Gmail/);
  assert.deepEqual(find(sel.c, "button").map((b) => b.a.action), ["open"], "no link without one");
  assert.deepEqual(parts(sel.c), ["mail.know", "mail.thread", "mail.suggested"], "no reply where it can't be sent");
  assert.ok(parts(r.nodes).includes("mail.new-inbox"));
  assert.ok(find(r.nodes, "toggle")[0].a.label.includes("(2)"), "the unread counted");

  const outlook = find(drawMail({ selected: "1" }).nodes, "selected")[0];
  const link = find(outlook.c, "button").find((b) => b.a.action === "url");
  assert.equal(link?.a.href, "https://outlook.office.com/m/1");
  assert.match(link?.a.label ?? "", /Open in Outlook/);
  assert.ok(parts(outlook.c).includes("mail.reply"));
  assert.doesNotMatch(vnodeToString(outlook), /Read-only/);
});

// --- Chat ---

const MSG_PROPS: Property[] = [
  { id: "msgsender", name: "Sender", type: "text" },
  { id: "msgchat", name: "Chat", type: "text" },
  { id: "msgchannel", name: "Channel", type: "select", options: opts("Teams", "WhatsApp", "Signal") },
  { id: "msgsent", name: "Sent", type: "date" },
  { id: "msgmine", name: "Mine", type: "checkbox" },
  { id: "msgconv", name: "Conversation", type: "text" },
  { id: "srcurl", name: "Link", type: "url" },
  { id: "rowactions", name: "Actions", type: "text" },
];
const msgs = [
  row(10, "Hi there", { msgsender: "Eva", msgchat: "Eva", msgchannel: "whatsapp", msgsent: "2026-10-21T10:00", msgconv: "wa:eva", srcurl: "https://web.whatsapp.com/", rowactions: "[reply]" }),
  row(11, "Hello!", { msgsender: "Me", msgchat: "Eva", msgchannel: "whatsapp", msgsent: "2026-10-21T10:05", msgmine: true, msgconv: "wa:eva" }),
  row(12, "Standup?", { msgsender: "Tom", msgchat: "Team X", msgchannel: "teams", msgsent: "2026-10-22T09:00", msgconv: "19:abc" }),
];

test("chat data: a conversation per chat, the newest first, each by its last message; the one picked with its messages", () => {
  const a = chatAppData({ rows: msgs, props: MSG_PROPS, state: {}, reply: ["WhatsApp"] });
  assert.deepEqual((a.chats as Row[]).map((r) => r.id), [12, 11]);
  assert.equal(a.first, "12");
  const cur = a.current as Record<string, unknown>;
  assert.equal(cur.name, "Team X");
  assert.equal(cur.channel, "Teams");
  assert.equal(cur.canReply, false);
  const eva = chatAppData({ rows: msgs, props: MSG_PROPS, state: { selected: "10" }, reply: ["WhatsApp"] }).current as Record<string, unknown>;
  assert.equal(eva.id, 11, "an older message picked: its chat, by its last message");
  assert.deepEqual((eva.messages as Row[]).map((r) => r.id), [10, 11], "oldest first");
  assert.equal(eva.link, "https://web.whatsapp.com/");
  assert.equal(eva.icon, "🟢");
  assert.deepEqual(eva.actions, { rowId: 10, value: "[reply]" }, "the newest message with suggestions");
  assert.deepEqual(eva.reply, { kind: "chat", rowId: 11, channel: "WhatsApp", chat: "Eva" });
});

const drawChat = (state: Record<string, string>, rows = msgs) => drawWith(CHAT_VIEW, rows, MSG_PROPS, state, chatAppData({ rows, props: MSG_PROPS, state, reply: ["WhatsApp"] }));

test("the chat's default template draws without an error; its list and header the language's", () => {
  for (const state of [{}, { selected: "10" }, { selected: "99" }] as Record<string, string>[]) assert.deepEqual(drawChat(state).errors, [], JSON.stringify(state));
  assert.deepEqual(drawChat({}, []).errors, []);
  const r = drawChat({ selected: "11" });
  const list = find(r.nodes, "list")[0];
  assert.equal(list.a.select, "true");
  assert.match(vnodeToString(list.c[0]), /🟣.*Team X.*22\.10\., 09:00.*Standup\?/);
  assert.match(vnodeToString(list.c[1]), /🟢.*Eva.*Me: Hello!/);
  const pane = vnodeToString(find(r.nodes, "selected")[0]);
  assert.match(pane, /Eva/);
  assert.match(pane, /Open in WhatsApp/);
  assert.deepEqual(parts(r.nodes).filter((p) => p !== "mail.new-inbox"), ["mail.know", "chat.messages", "mail.suggested", "mail.reply"]);
  const teams = drawChat({});
  assert.match(vnodeToString(teams.nodes), /Read-only — replying through Teams isn't set up here\./);
  assert.ok(!parts(teams.nodes).includes("mail.reply"));
});

// --- Inbox ---

const INBOX_PROPS: Property[] = [
  { id: "commfrom", name: "From", type: "text" },
  { id: "commwhen", name: "Date", type: "date" },
  { id: "commchannel", name: "Channel", type: "select", options: opts("Outlook", "Gmail", "Teams", "WhatsApp", "Signal") },
  { id: "commwhere", name: "Where", type: "text" },
  { id: "communread", name: "Unread", type: "checkbox" },
  { id: "commmine", name: "Mine", type: "checkbox" },
  { id: "commconv", name: "Conversation", type: "text" },
  { id: "commsnooze", name: "Snoozed until", type: "text" },
  { id: "filterwhy", name: "Why", type: "text" },
];
const later = "2026-10-23T08:00:00.000Z";
const items = [
  row(20, "Invoice", { commfrom: "Anna Berg <anna@x.de>", commwhen: "2026-10-21T09:00", commchannel: "outlook", commwhere: "Inbox", commconv: "c1", communread: true }),
  row(21, "AW: Invoice", { commfrom: "Me <me@x.de>", commwhen: "2026-10-22T10:00", commchannel: "outlook", commwhere: "Inbox", commconv: "c1", commmine: true, filterwhy: "From a customer" }),
  row(22, "Lunch?", { commfrom: "Eva", commwhen: "2026-10-22T11:00", commchannel: "whatsapp", commwhere: "Eva", commconv: "wa:eva" }),
  row(23, "Old thing", { commfrom: "Tom", commwhen: "2026-10-20T11:00", commchannel: "teams", commwhere: "Team X", commconv: "19:x", commsnooze: later }),
];

test("inbox data: threads by conversation (unread when any of it is), the channels with their counts, the snoozed apart", () => {
  const a = inboxAppData({ rows: items, props: INBOX_PROPS, state: {}, reply: ["Outlook", "WhatsApp"], now: NOW.getTime() });
  assert.deepEqual((a.threads as Row[]).map((r) => r.id), [22, 21]);
  assert.deepEqual(a.unreadIds, [21], "c1's older mail is unread: the thread is");
  assert.deepEqual(
    Object.fromEntries(Object.entries(a.texts as Record<string, { from: string; count: number }>).map(([k, v]) => [k, { from: v.from, count: v.count }])),
    { 21: { from: "Me", count: 2 }, 22: { from: "Eva", count: 1 } },
  );
  assert.ok(Object.values(a.texts as Record<string, { preview: string }>).every((v) => typeof v.preview === "string"), "each thread has its preview line");
  assert.equal(a.total, 4);
  assert.equal(a.allUnread, " · 1");
  assert.equal(a.channelOptions, "Outlook:✉️ Outlook 2 · 1, Teams:🟣 Teams 1, WhatsApp:🟢 WhatsApp 1");
  assert.equal(a.snoozed, 1);
  assert.equal(a.snoozedToggle, true);
  const cur = a.current as Record<string, unknown>;
  assert.equal(cur.id, 22);
  assert.equal(cur.channel, "WhatsApp");
  assert.deepEqual(cur.reply, { kind: "chat", rowId: 22, channel: "WhatsApp", chat: "Eva" });

  const mail = inboxAppData({ rows: items, props: INBOX_PROPS, state: { selected: "21" }, reply: ["Outlook"], now: NOW.getTime() }).current as Record<string, unknown>;
  assert.deepEqual(mail.ids, [20, 21], "the whole thread snoozed at once");
  assert.equal(mail.why, "From a customer");
  assert.equal(mail.fetch, true);
  assert.deepEqual(mail.reply, { kind: "mail", account: "Outlook", to: "me@x.de", subject: "AW: Invoice" });

  const outlook = inboxAppData({ rows: items, props: INBOX_PROPS, state: { channel: "Outlook", unread: "true" }, now: NOW.getTime() });
  assert.deepEqual((outlook.threads as Row[]).map((r) => r.id), [20], "a channel, unread only: before the grouping");
  const asleep = inboxAppData({ rows: items, props: INBOX_PROPS, state: { snoozed: "true" }, now: NOW.getTime() });
  assert.deepEqual((asleep.threads as Row[]).map((r) => r.id), [23]);
  const teams = asleep.current as Record<string, unknown>;
  assert.equal(teams.fetch, false, "a Teams chat: its own text, nothing to fetch");
  assert.equal(teams.reply, null, "Teams can't be replied to here");
});

const drawInbox = (state: Record<string, string>, rows = items) => drawWith(INBOX_VIEW, rows, INBOX_PROPS, state, inboxAppData({ rows, props: INBOX_PROPS, state, reply: ["Outlook", "WhatsApp"], now: NOW.getTime() }));

test("the inbox's default template draws without an error — every channel, unread only, the snoozed, empty", () => {
  for (const state of [{}, { selected: "21" }, { channel: "Outlook" }, { channel: "Teams", unread: "true" }, { snoozed: "true", selected: "23" }] as Record<string, string>[]) assert.deepEqual(drawInbox(state).errors, [], JSON.stringify(state));
  assert.deepEqual(drawInbox({}, []).errors, []);
});

test("inbox: channels as tabs, threads as the language's list, the reading pane in <selected>", () => {
  const r = drawInbox({ selected: "21" });
  const tabs = find(r.nodes, "tabs")[0];
  // (A tab's count is what is unread there: none, no count.)
  assert.deepEqual(JSON.parse(tabs.a.options), [["", "logo-all All", "1"], ["Outlook", "logo-outlook Outlook", "1"], ["Teams", "logo-teams Teams"], ["WhatsApp", "logo-whatsapp WhatsApp"]]);
  assert.equal(tabs.a.current, "");
  assert.deepEqual(find(r.nodes, "toggle").map((x) => x.a.bind), ["unread", "snoozed"]);
  const list = find(r.nodes, "list")[0];
  assert.equal(list.a.select, "true");
  assert.deepEqual(list.c.map((it) => (typeof it === "string" ? "" : it.a.row)), ["22", "21"]);
  assert.match(vnodeToString(list.c[1]), /<b>AW: Invoice<\/b>.*<logo name=Outlook/, "the thread unread: in bold, its channel beside its preview");
  assert.match(vnodeToString(list.c[0]), /Lunch\?.*<logo name=WhatsApp/);
  const sel = find(r.nodes, "selected")[0];
  const pane = vnodeToString(sel);
  assert.match(find(sel.c, "header")[0].a.subtitle, /Me <me@x\.de> · 10:00 · Outlook/);
  assert.match(pane, /From a customer/);
  assert.deepEqual(parts(sel.c), ["inbox.snooze", "mail.know", "mail.thread", "mail.suggested", "mail.reply"]);
  const teams = drawInbox({ snoozed: "true", selected: "23" });
  assert.match(vnodeToString(teams.nodes), /Read-only — replying through Teams isn't set up here\./);
  assert.ok(!parts(teams.nodes).includes("mail.reply"));
});

test("the inbox is two panes: the list in the first, the one picked in the second", () => {
  const panes = find(drawInbox({}).nodes, "panes");
  assert.equal(panes.length, 1);
  const [list, reading] = panes[0].c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
  assert.equal(find(list.c, "list").length, 1);
  assert.equal(find(reading.c, "selected").length, 1);
});

test("mail and chat are a split: the list in its first column, the one picked in its second", () => {
  for (const r of [drawMail({}), drawChat({})]) {
    const split = find(r.nodes, "split");
    assert.equal(split.length, 1);
    const cols = split[0].c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
    assert.deepEqual(cols.map((c) => c.t), ["col", "col"]);
    assert.equal(find(cols[0].c, "list").length, 1);
    assert.equal(find(cols[1].c, "selected").length, 1);
  }
});
