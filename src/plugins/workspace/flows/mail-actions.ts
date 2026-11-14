import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's mail and message actions for flows and lambdas (docs/zeff-kernel.md, "The line": the mail accounts and the chats are
 * drivers — Outlook, Gmail, IMAP / POP3, Teams, WhatsApp, Signal). What the Mail & Chat views did through code of their own, a port
 * does through these: a conversation read, a reply drafted by the AI, a row's action (a reply sent, a draft kept), mails archived and
 * marked read on their server, what is unread. Reading is free; what leaves Zeff needs the flow's `send`, the AI its `ai`. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const ids = (v: unknown, max: number): number[] => (Array.isArray(v) ? v : String(v ?? "").split(",")).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, max);
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export const MAIL_ACTIONS: FlowAction[] = [
  {
    name: "mail.thread",
    group: "mail",
    label: "A conversation",
    summary: "The messages of a conversation (a mail thread, a chat) by its id (a row's conv), oldest first: the last 25, or all with older.",
    input: [f("conv", "text", { required: true }), f("older", "boolean")],
    output: "{ conv, messages: [{ key, name, email, at, unread, subject, preview, mine }] } — what /api/mail/thread gives",
    run: async (i) => {
      const conv = text(i.conv).trim();
      if (!conv) return { conv, messages: [] };
      const { conversationOf } = await import("@/lib/mail/store");
      const { isMine } = await import("@/lib/mail/shared");
      const { formatSmart } = await import("@/lib/format");
      const messages = conversationOf(conv, i.older === true || i.older === "true" ? 2000 : 25).map((m) => ({
        key: m.key,
        name: m.fromName ?? m.fromEmail ?? "?",
        email: m.fromEmail,
        at: formatSmart(m.receivedAt),
        unread: m.unread,
        subject: m.subject,
        preview: m.preview,
        mine: isMine(m),
      }));
      return { conv, messages };
    },
  },
  {
    name: "mail.unread",
    group: "mail",
    label: "What is unread",
    summary: "The newest unread mails (not chats, not archived or sent ones) and how many there are in all.",
    input: [f("limit", "number", { default: 6 })],
    output: "{ total, mails: [{ key, from, email, subject, preview, at, folder }] }",
    run: async (i) => {
      const { getSqlite } = await import("@/db");
      const { CHAT_FOLDERS } = await import("@/lib/mail/shared");
      const where = `unread = 1 and resolved_at is null and folder not like '%Archive%' and folder not like '%Archiv%' and folder not like '%Sent%' and folder not like '%Gesendet%' and folder not in (${CHAT_FOLDERS.map((x) => `'${x}'`).join(", ")})`;
      const db = getSqlite();
      const total = (db.prepare(`select count(*) as n from emails where ${where}`).get() as { n: number }).n;
      const limit = Math.min(50, Math.max(1, Number(i.limit) || 6));
      const rows = db.prepare(`select key, from_name, from_email, subject, preview, received_at, folder from emails where ${where} order by received_at desc limit ?`).all(limit) as { key: string; from_name: string | null; from_email: string | null; subject: string; preview: string; received_at: string; folder: string }[];
      return { total, mails: rows.map((m) => ({ key: m.key, from: m.from_name, email: m.from_email, subject: m.subject, preview: m.preview, at: m.received_at, folder: m.folder })) };
    },
  },
  {
    name: "row.reply.draft",
    group: "mail",
    label: "Draft a reply (AI)",
    summary: "A reply to a row (a mail, a message) drafted by the AI from its conversation: its text, to whom, the subject, the channel. Nothing is sent.",
    input: [f("row", "row", { required: true })],
    output: "{ text, to, subject, channel }",
    needs: ["ai"],
    run: async (i, ctx) => {
      ctx.may("ai");
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("llm")) throw new Error("The LLM plugin is needed for this (Menu → Plugins).");
      return (await import("../row-actions")).draftRowReply(Number(i.row));
    },
  },
  {
    name: "row.op",
    group: "mail",
    label: "A row's action",
    summary: 'What a row can have done, as its views do it: a reply sent or kept as a draft (op { type: "mail-reply" | "chat-reply" …, body … }, mode "send" | "draft"). Sending goes out of Zeff.',
    input: [f("row", "row", { required: true }), f("op", "json", { required: true }), f("mode", "text", { options: ["send", "draft"] })],
    output: "{ href, what }",
    writes: true,
    needs: ["send"],
    run: async (i, ctx) => {
      const mode = i.mode === "send" || i.mode === "draft" ? i.mode : undefined;
      if (mode !== "draft") ctx.may("send");
      const op = i.op && typeof i.op === "object" && !Array.isArray(i.op) ? (i.op as Record<string, unknown>) : {};
      const r = await (await import("@/lib/ops")).runRowOp(Number(i.row), op, mode);
      return { href: r.href ?? null, what: r.what ?? null };
    },
  },
  {
    name: "mail.archive",
    group: "mail",
    label: "Archive conversations",
    summary: "The conversations of these rows out of the inbox — an IMAP / POP3 account's on its server too.",
    input: [f("rows", "list", { required: true })],
    output: "{ archived, failed }",
    writes: true,
    needs: ["send"],
    run: async (i, ctx) => {
      ctx.may("send");
      const { archiveMails, mailKeysOfRows } = await import("@/plugins/imap-mail/archive");
      return archiveMails(mailKeysOfRows(ids(i.rows, 500)));
    },
  },
  {
    name: "mail.archive-read",
    group: "mail",
    label: "Archive what is read",
    summary: "Every read conversation of the IMAP / POP3 accounts' inboxes archived, on their servers too.",
    input: [],
    output: "{ archived, failed, what }",
    writes: true,
    needs: ["send"],
    run: async (_i, ctx) => {
      ctx.may("send");
      const r = await (await import("@/plugins/imap-mail/archive")).archiveReadInbox();
      const { t } = await import("@/lib/i18n/server");
      return { ...r, what: t("{n} archived.", { n: r.archived }) };
    },
  },
  {
    name: "mail.mark-read",
    group: "mail",
    label: "Mark read",
    summary: "These rows' mails marked read — in Zeff, and an IMAP / POP3 account's on its server (its setting: mark read when opened).",
    input: [f("rows", "list", { required: true })],
    output: "{ marked }",
    writes: true,
    needs: ["send"],
    run: async (i, ctx) => {
      ctx.may("send");
      const { isInstalled } = await import("@/plugins/state");
      const rows = ids(i.rows, 200);
      if (!rows.length || !isInstalled("imap-mail")) return { marked: 0 };
      return (await import("@/plugins/imap-mail/read-on-open")).markOpenedRead(rows);
    },
  },
  {
    name: "rows.set",
    group: "data",
    label: "Set a field on rows",
    summary: "One field (by its id or name) set to a value on these rows (several at once: a thread's mails) — null empties it.",
    input: [f("rows", "list", { required: true }), f("prop", "text", { required: true }), f("value", "json")],
    output: "{ changed }",
    writes: true,
    needs: ["write"],
    run: async (i, ctx) => {
      const store = await import("../store");
      let changed = 0;
      for (const id of ids(i.rows, 500)) {
        const page = store.getPage(id);
        if (!page?.dbId) continue;
        ctx.canWrite(page.dbId);
        const want = text(i.prop).trim().toLowerCase();
        const prop = store.getDatabase(page.dbId)?.schema.properties.find((p) => p.id === text(i.prop) || p.name.toLowerCase() === want);
        if (!prop) throw new Error(`rows.set: the database has no field “${text(i.prop)}”.`);
        store.setCell(id, prop.id, i.value === undefined || i.value === "" ? null : i.value);
        changed++;
      }
      return { changed };
    },
  },
  {
    name: "mail.gmail-change",
    group: "mail",
    label: "Gmail: archive or mark unread",
    summary: "A Gmail row's conversation archived (out of the inbox, still in All Mail) or marked unread — through Gmail, with its write access.",
    input: [f("row", "row", { required: true }), f("what", "text", { options: ["archive", "unread"], default: "archive" })],
    output: "{ what }",
    writes: true,
    needs: ["send"],
    run: async (i, ctx) => {
      ctx.may("send");
      const { gmailRowChange } = await import("@/plugins/gmail/run");
      return { what: await gmailRowChange(Number(i.row), i.what === "unread" ? "unread" : "archive") };
    },
  },
  {
    name: "zeff.grants",
    group: "data",
    label: "What Zeff may write to Google",
    summary: 'The write access Zeff holds now: "gmail-send" (Gmail sends, archives, keeps drafts from here), "gcal-write" (events entered in Google Calendar).',
    input: [],
    output: "{ grants: string[], gmailSend: boolean, gcalWrite: boolean }",
    run: async () => {
      const grants = (await import("@/lib/google/grants")).googleGrants();
      return { grants, gmailSend: grants.includes("gmail-send"), gcalWrite: grants.includes("gcal-write") };
    },
  },
  {
    name: "mail.inbox-templates",
    group: "mail",
    label: "Inbox templates",
    summary: "The inboxes the mail client can make (Unread, From people, Important …) for mails or messages, in your language.",
    input: [f("type", "text", { options: ["mail", "message"] })],
    output: "{ templates: [{ id, title, icon, description }] }",
    run: async (i) => {
      // (the templates are the kernel's data: there for the built-in and for its port alike)
      const { inboxTemplates } = await import("@/plugins/mail-client/templates");
      const { t } = await import("@/lib/i18n/server");
      return { templates: inboxTemplates(i.type === "mail" || i.type === "message" ? i.type : undefined).map((x) => ({ id: x.id, title: t(x.title), icon: x.icon, description: t(x.description) })) };
    },
  },
  {
    name: "mail.new-inbox",
    group: "mail",
    label: "A new inbox",
    summary: 'An inbox under a database: one of the templates (mail.inbox-templates) — or, template "own", your own (its rules and AI filter set next). Its rows are read at once. Where it is: href.',
    input: [f("parent", "db", { required: true }), f("template", "text", { required: true })],
    output: "{ id, href }",
    writes: true,
    needs: ["write"],
    run: async (i, ctx) => {
      const parent = Number(i.parent);
      ctx.canWrite(parent);
      const own = text(i.template) === "own";
      const id = own ? (await import("../derived")).createDerivedDatabase(parent) : await (await import("@/plugins/mail-client/templates")).createInbox(parent, text(i.template));
      (await import("../pipeline")).startPipeline(id, { ai: false });
      return { id, href: `/workspace/${id}${own ? "?steps=1" : ""}` };
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:mail", MAIL_ACTIONS);
