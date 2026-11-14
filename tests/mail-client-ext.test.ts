import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { CHAT_VIEW, INBOX_VIEW, MAIL_VIEW } from "../src/plugins/mail-client/view-template.meta";
import { toPortMail, type MailApp } from "../src/plugins/mail-client/port.meta";
import { chatAppData, inboxAppData, mailAppData } from "../src/plugins/mail-client/view-data";
import type { ViewAppMeta } from "../src/plugins/workspace/view-apps";
import type { T } from "../src/lib/i18n/shared";

/**
 * Mail & Chat's port (zeff-plugins/plugins/mail-client-ext): its compute script — the built-in's view-data.ts bundled — works out what
 * the built-in does from the same rows, and the built-in's templates turned into the port's draw without an error, every part made of
 * the view language (no <part> left), the buttons doing the kernel's actions as the built-in's code did.
 */

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const NOW = new Date("2026-10-22T15:00:00");
const opts = (...names: string[]) => names.map((n) => ({ id: n.toLowerCase(), name: n, color: "gray" }));
const row = (id: number, title: string, cells: Record<string, unknown>): Row => ({ id, title, icon: "", cells, createdAt: "2026-10-01", updatedAt: "2026-10-01" });
const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));

const COMPUTE = path.resolve("../zeff-plugins/plugins/mail-client-ext/compute.js");
const have = fs.existsSync(COMPUTE);
type Api = Record<MailApp, (i: unknown) => Record<string, unknown>>;
// (its answers as the frame posts them: copied out of its own realm)
const api = (): Api => {
  const raw = vm.runInNewContext(`${fs.readFileSync(COMPUTE, "utf8")}\n;ZeffCompute`) as Api;
  return Object.fromEntries(Object.entries(raw).map(([k, fn]) => [k, (i: unknown) => JSON.parse(JSON.stringify(fn(i)))])) as Api;
};

const MAIL_PROPS: Property[] = [
  { id: "mailfrom", name: "From", type: "text" },
  { id: "mailaccount", name: "Account", type: "select", options: opts("Outlook", "Gmail", "E-Mail") },
  { id: "mailfolder", name: "Folder", type: "select", options: opts("Inbox", "Archive") },
  { id: "mailreceived", name: "Received", type: "date" },
  { id: "mailunread", name: "Unread", type: "checkbox" },
  { id: "mailconv", name: "Conversation", type: "text" },
  { id: "srcurl", name: "Link", type: "url" },
];
const mails = [
  row(1, "Invoice October", { mailfrom: "Anna Berg <anna@x.de>", mailaccount: "outlook", mailfolder: "inbox", mailreceived: "2026-10-20T09:00", mailconv: "c1", srcurl: "https://outlook.office.com/m/1" }),
  row(2, "AW: Meeting", { mailfrom: "Bob <bob@y.com>", mailaccount: "gmail", mailfolder: "inbox", mailreceived: "2026-10-22T14:03", mailunread: true, mailconv: "gmail:c2" }),
  row(3, "Newsletter", { mailfrom: "news@z.org", mailaccount: "e-mail", mailfolder: "inbox", mailreceived: "2026-10-21T08:00", mailunread: true, mailconv: "imap:c3" }),
];
const previews = { 1: [{ text: "Please find" }, { text: "attached." }], 2: [{ text: "See you" }] };
const MSG_PROPS: Property[] = [
  { id: "msgsender", name: "Sender", type: "text" },
  { id: "msgchat", name: "Chat", type: "text" },
  { id: "msgchannel", name: "Channel", type: "select", options: opts("Teams", "WhatsApp", "Signal") },
  { id: "msgsent", name: "Sent", type: "date" },
  { id: "msgmine", name: "Mine", type: "checkbox" },
  { id: "msgconv", name: "Conversation", type: "text" },
  { id: "rowactions", name: "Actions", type: "text" },
];
const msgs = [
  row(10, "Hi there", { msgsender: "Eva", msgchat: "Eva", msgchannel: "whatsapp", msgsent: "2026-10-21T10:00", msgconv: "wa:eva", rowactions: "[reply]" }),
  row(11, "Hello!", { msgsender: "Me", msgchat: "Eva", msgchannel: "whatsapp", msgsent: "2026-10-21T10:05", msgmine: true, msgconv: "wa:eva" }),
  row(12, "Standup?", { msgsender: "Tom", msgchat: "Team X", msgchannel: "teams", msgsent: "2026-10-22T09:00", msgconv: "19:abc" }),
];
const INBOX_PROPS: Property[] = [
  { id: "commfrom", name: "From", type: "text" },
  { id: "commwhen", name: "Date", type: "date" },
  { id: "commchannel", name: "Channel", type: "select", options: opts("Outlook", "Gmail", "E-Mail", "Teams", "WhatsApp", "Signal") },
  { id: "commwhere", name: "Where", type: "text" },
  { id: "communread", name: "Unread", type: "checkbox" },
  { id: "commmine", name: "Mine", type: "checkbox" },
  { id: "commconv", name: "Conversation", type: "text" },
  { id: "commsnooze", name: "Snoozed until", type: "text" },
  { id: "filterwhy", name: "Why", type: "text" },
];
const items = [
  row(20, "Invoice", { commfrom: "Anna Berg <anna@x.de>", commwhen: "2026-10-21T09:00", commchannel: "e-mail", commwhere: "Inbox", commconv: "imap:c1", communread: true }),
  row(21, "AW: Invoice", { commfrom: "Me <me@x.de>", commwhen: "2026-10-22T10:00", commchannel: "e-mail", commwhere: "Inbox", commconv: "imap:c1", commmine: true, filterwhy: "From a customer" }),
  row(22, "Lunch?", { commfrom: "Eva", commwhen: "2026-10-22T11:00", commchannel: "whatsapp", commwhere: "Eva", commconv: "wa:eva" }),
];

const CASES: { app: MailApp; meta: ViewAppMeta; rows: Row[]; props: Property[]; reply: string[]; builtin: (v: never) => Record<string, unknown> }[] = [
  { app: "mail", meta: MAIL_VIEW, rows: mails, props: MAIL_PROPS, reply: ["Outlook", "Gmail", "E-Mail"], builtin: mailAppData as never },
  { app: "chat", meta: CHAT_VIEW, rows: msgs, props: MSG_PROPS, reply: ["WhatsApp"], builtin: chatAppData as never },
  { app: "inbox", meta: INBOX_VIEW, rows: items, props: INBOX_PROPS, reply: ["E-Mail", "WhatsApp"], builtin: inboxAppData as never },
];

const input = (c: (typeof CASES)[number], state: Record<string, string>) => ({ rows: c.rows, props: c.props, state, extras: { previews, capabilities: { reply: c.reply } }, now: NOW.getTime() });

/** The port's template drawn as the browser draws it: its data what the compute script and the kernel's actions answered. */
function drawPort(c: (typeof CASES)[number], state: Record<string, string>, more: Record<string, unknown> = {}) {
  const app = api()[c.app](input(c, state));
  const data = { app, grants: { gmailSend: true }, inboxtemplates: { templates: [{ id: "unread", title: "Unread", icon: "📬", description: "x" }] }, ...more };
  const template = toPortMail(c.meta.defaultTemplate(t), c.app, t);
  return { app, r: renderView(template, { rows: c.rows, props: c.props, titleName: "Subject", state, app: {}, data, db: { id: 7, title: "Mail" }, now: NOW, locale: "de-DE" } as never, { parts: [], actions: [] }) };
}

test("the compute script works out what the built-in does, from the same rows (the port's few fields more aside)", { skip: !have && "zeff-plugins isn't beside Zeff" }, () => {
  for (const c of CASES)
    for (const state of [{}, { selected: String(c.rows[1].id) }, { unread: "true" }] as Record<string, string>[]) {
      const port = api()[c.app](input(c, state));
      const mine = JSON.parse(JSON.stringify(c.builtin({ rows: c.rows, props: c.props, state, previews, reply: c.reply, now: NOW.getTime() } as never)));
      // (the fields only the port reads, out)
      const strip = (d: Record<string, unknown>) => {
        const { imapAny: _i, snooze: _s, ...rest } = d;
        const cur = rest.current as Record<string, unknown> | null;
        if (cur) {
          const { fallbackList: _f, markIds: _m, ids, ...k } = cur;
          rest.current = { ...k, ...(ids && (cur as { ids?: unknown }).ids !== undefined && c.app === "inbox" ? { ids } : {}) };
          const r = (rest.current as { reply?: Record<string, unknown> }).reply;
          if (r) {
            delete r.opType;
            delete r.op;
          }
        }
        for (const x of Object.values((rest.texts as Record<string, Record<string, unknown>>) ?? {})) delete x.countLabel;
        return rest;
      };
      assert.deepEqual(strip(JSON.parse(JSON.stringify(port))), strip(mine), `${c.app} ${JSON.stringify(state)}`);
    }
});

test("the port's fields: the reply's operation, the ids marked read only when picked, the snooze times", { skip: !have && "zeff-plugins isn't beside Zeff" }, () => {
  const m = api().mail(input(CASES[0], { selected: "2" })).current as { reply: { opType: string }; markIds: number[] };
  assert.equal(m.reply.opType, "gmail-compose");
  assert.deepEqual(m.markIds, [2], "picked and unread: marked read");
  assert.deepEqual((api().mail(input(CASES[0], {})).current as { markIds: number[] }).markIds, [], "the newest shown by itself: not");
  assert.equal((api().mail(input(CASES[0], { selected: "3" })).current as { reply: { opType: string } }).reply.opType, "imap-send");
  const chat = api().chat(input(CASES[1], { selected: "10" })).current as { reply: { op: { type: string } } };
  assert.equal(chat.reply.op.type, "whatsapp-message");
  const inbox = api().inbox(input(CASES[2], {}));
  assert.equal(inbox.imapAny, true);
  assert.ok(Object.values(inbox.snooze as Record<string, string>).every((x) => !Number.isNaN(Date.parse(x))));
});

test("the port's templates draw without an error and without a part; the buttons do the kernel's actions", { skip: !have && "zeff-plugins isn't beside Zeff" }, () => {
  for (const c of CASES)
    for (const state of [{}, { selected: String(c.rows[1].id) }, { selected: "99" }] as Record<string, string>[]) {
      const { r } = drawPort(c, state);
      assert.deepEqual(r.errors, [], `${c.app} ${JSON.stringify(state)}`);
      assert.deepEqual(find(r.nodes, "part"), [], `${c.app}: no part left`);
    }
  // Mail: an Outlook mail — a reply opened as a draft there; the thread fetched; the new inbox a menu.
  const mail = drawPort(CASES[0], { selected: "1", mailopen1: "1", mailbody1: "Thanks!" }, { thread: { conv: "c1", messages: [{ key: "k", name: "Anna", at: "20.10.", preview: "Please find attached.", mine: false }] } }).r;
  const dos = find(mail.nodes, "button").map((b) => b.a.do).filter(Boolean);
  assert.ok(dos.includes("row.op") && dos.includes("row.reply.draft") && dos.includes("mail.new-inbox"), dos.join(","));
  const op = find(mail.nodes, "button").find((b) => b.a.do === "row.op")!;
  assert.deepEqual(JSON.parse(op.a.with), { row: 1, op: { type: "mail-compose", to: "anna@x.de", subject: "AW: Invoice October", body: "Thanks!" } });
  assert.match(vnodeToString(mail.nodes), /Please find attached\./);
  assert.ok(find(mail.nodes, "data").some((d) => d.a.do === "mail.thread" && JSON.parse(d.a.with).conv === "c1"));
  // Gmail with its write access: sent or kept as a draft; archive / unread there.
  const gmail = drawPort(CASES[0], { selected: "2", mailopen2: "1", mailbody2: "Ok" }).r;
  const modes = find(gmail.nodes, "button").filter((b) => b.a.do === "row.op").map((b) => JSON.parse(b.a.with).mode ?? "open");
  assert.deepEqual(modes, ["send", "draft", "open"]);
  // The one picked, unread: marked read after a moment.
  assert.ok(find(gmail.nodes, "data").some((d) => d.a.do === "mail.mark-read" && d.a.debounce === "1500"));
  // Chat: bubbles, a bar sent with Enter.
  const chat = drawPort(CASES[1], { selected: "10", chattext11: "Yes" }).r;
  assert.match(vnodeToString(chat.nodes), /Hi there[\s\S]*Hello!/);
  const send = find(chat.nodes, "on").find((o) => o.a.event === "chat-send")!;
  assert.deepEqual(JSON.parse(send.a.with), { row: 11, op: { type: "whatsapp-message", to: "Eva", chat: "Eva", body: "Yes" } });
  assert.ok(find(chat.nodes, "input").some((i) => i.a.enter === "chat-send"));
  // Inbox: snooze a menu of rows.set, archive, archive what is read (IMAP there).
  const inbox = drawPort(CASES[2], { selected: "21" }).r;
  const sets = find(inbox.nodes, "button").filter((b) => b.a.do === "rows.set").map((b) => JSON.parse(b.a.with));
  assert.equal(sets.length, 4);
  assert.deepEqual(sets[0].rows, [20, 21]);
  assert.equal(sets[3].value, null);
  assert.ok(find(inbox.nodes, "button").some((b) => b.a.do === "mail.archive"));
  assert.ok(find(inbox.nodes, "button").some((b) => b.a.do === "mail.archive-read"));
});
