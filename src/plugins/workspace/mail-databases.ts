import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { appViewFields, appViewsFor } from "./app-views";
import { newId, newView, type DbSchema, type PipelineStep } from "./model";
import { createPage, getDatabase, updatePage } from "./store";

/**
 * Your mails and messages in the Workspace — once: a database "Mail" (Outlook, Gmail, an IMAP mailbox, the last 30 days) and one "Chats"
 * (Teams, WhatsApp, Signal, the last 14 days), each a pipeline over its source, shown first by its app (the mail client, the
 * chat — a table without it). Made when a mail or message plugin is installed; gone ones aren't made again.
 */

const MAIL = "workspace.mailDb";
const CHATS = "workspace.chatsDb";
const INBOX = "workspace.inboxDb";
const SENT = "workspace.sentDb";

/** Its app: the mail client's (the built-in's, or a plugin's that brings one for the type — its port), else the built-in's id (a table while it is off). */
function make(title: string, icon: string, step: PipelineStep, kind: "mail" | "message", fallback: { id: string; label: string; icon: string }): number {
  const app = appViewsFor(kind)[0] ?? { ...fallback, plugin: "mail-client" };
  const view = { ...newView(t(app.label), "table"), ...appViewFields(app) };
  const schema: DbSchema = { titleName: t("Subject"), properties: [], views: [view, newView(t("Table"), "table")], pipeline: { steps: [step] } };
  const id = createPage({ kind: "database", title, icon, schema });
  updatePage(id, { fullWidth: true });
  return id;
}

/** The database "Mail" ("mail"), "Chats" ("message") or the combined "Inbox" ("inbox") — null: not made, or gone. */
export function homeDatabase(kind: "mail" | "message" | "inbox"): number | null {
  const id = getPref<number | null>(kind === "mail" ? MAIL : kind === "message" ? CHATS : INBOX, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The databases made (where their sources are installed and they weren't made before): Mail, Chats, the combined Inbox — and their rows read. */
export async function ensureMailDatabases(): Promise<void> {
  if (!isInstalled("workspace")) return;
  const made: number[] = [];
  if (getPref<number | null>(MAIL, null) === null && (isInstalled("outlook-mail") || isInstalled("gmail") || isInstalled("imap-mail"))) {
    const id = make(t("Mail"), "✉️", { id: newId("s"), kind: "source", from: "mail", mail: { recentDays: 30 } }, "mail", { id: "mail", label: "Mail", icon: "✉" });
    setPref(MAIL, id);
    made.push(id);
  }
  if (getPref<number | null>(CHATS, null) === null && (isInstalled("teams") || isInstalled("whatsapp") || isInstalled("signal"))) {
    const id = make(t("Chats"), "💬", { id: newId("s"), kind: "source", from: "messages", messages: { recentDays: 14 } }, "message", { id: "chat", label: "Chat", icon: "💬" });
    setPref(CHATS, id);
    made.push(id);
  }
  // Gmail's sent mails sit in a folder of their own that "Mail" leaves out: a "Sent" database under it, once (a deleted one isn't made again).
  const mailId = homeDatabase("mail");
  if (mailId && isInstalled("gmail") && appViewsFor("mail").length > 0 && getPref<number | null>(SENT, null) === null) {
    const { createInbox } = await import("@/plugins/mail-client/templates");
    const id = await createInbox(mailId, "sent");
    setPref(SENT, id);
    made.push(id);
  }
  // Both kinds of sources there: the combined inbox too (one list across channels) — made first in the tree's order of use.
  const mailOn = isInstalled("outlook-mail") || isInstalled("gmail") || isInstalled("imap-mail");
  const chatOn = isInstalled("teams") || isInstalled("whatsapp") || isInstalled("signal");
  if (getPref<number | null>(INBOX, null) === null && mailOn && chatOn) {
    const { createSourceDatabase } = await import("./derived");
    const id = createSourceDatabase("inbox");
    setPref(INBOX, id);
    made.push(id);
  }
  const { runPipeline } = await import("./pipeline");
  for (const id of made) if (getDatabase(id)) await runPipeline(id, { ai: false });
}
