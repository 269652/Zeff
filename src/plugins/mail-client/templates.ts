import { t } from "@/lib/i18n/server";
import { newId, type DataType, type PipelineStep } from "@/plugins/workspace/model";

/**
 * The Mail & Chat plugin's inboxes in a few clicks: a template makes a database under Mail (or Chats) — its source the
 * parent, its rules (Outlook's kind) or its AI filter set — shown by the mail client (the chat). Changed after like any.
 */
export type InboxTemplate = { id: string; dataType: DataType; title: string; icon: string; description: string; steps: () => PipelineStep[]; /** Reads the mails itself (not the parent's rows): these folders — the ones a mirrored inbox leaves out. */ folders?: string[] };

const rule = (field: string, op: "contains" | "not_contains" | "is" | "is_not", value: string) => ({ field, op, value });
const filter = (match: "all" | "any", rules: ReturnType<typeof rule>[]): PipelineStep => ({ id: newId("s"), kind: "filter", match, rules });
/** Senders that are machines: Jira, GitLab, bots, no-reply addresses. */
const MACHINES = ["(Jira)", "noreply", "no-reply", "notification", "Bot", "@semantic", "mailer-daemon"];

export const INBOX_TEMPLATES: InboxTemplate[] = [
  { id: "inbox", dataType: "mail", title: "Inbox", icon: "📥", description: "Outlook's Posteingang, Gmail's inbox and the IMAP mailbox's", steps: () => [filter("any", [rule("Folder", "is", "Posteingang"), rule("Folder", "is", "Inbox"), rule("Account", "is", "Gmail"), rule("Account", "is", "E-Mail")])] },
  { id: "gmail", dataType: "mail", title: "Gmail", icon: "📮", description: "Only the Gmail account's mails", steps: () => [filter("all", [rule("Account", "is", "Gmail")])] },
  { id: "sent", dataType: "mail", title: "Sent", icon: "📤", description: "What you sent (Gmail's sent folder)", steps: () => [], folders: ["Gmail · Sent"] },
  { id: "archive", dataType: "mail", title: "Archive", icon: "🗄", description: "What left the Gmail inbox (archived or filed under a label) — still kept", steps: () => [], folders: ["Gmail · Archive"] },
  { id: "unread", dataType: "mail", title: "Unread", icon: "🔵", description: "Only the mails not read yet", steps: () => [filter("all", [rule("Unread", "is", "yes")])] },
  { id: "notifications", dataType: "mail", title: "Notifications", icon: "🔔", description: "Jira, GitLab, bots, no-reply senders", steps: () => [filter("any", [...MACHINES.map((x) => rule("From", "contains", x)), rule("Folder", "is", "Notifications")])] },
  { id: "people", dataType: "mail", title: "From people", icon: "👤", description: "Everything but the notifications", steps: () => [filter("all", [...MACHINES.map((x) => rule("From", "not_contains", x)), rule("Folder", "is_not", "Notifications")])] },
  {
    id: "important",
    dataType: "mail",
    title: "Important",
    icon: "⭐",
    description: "From people, then the AI keeps what asks something of you",
    steps: () => [
      filter("all", MACHINES.map((x) => rule("From", "not_contains", x))),
      { id: newId("s"), kind: "ai", output: "filter", prompt: "Nur Mails, in denen mich jemand direkt etwas fragt, um eine Entscheidung, Freigabe oder Antwort bittet oder eine Frist setzt — und das noch offen ist." },
      { id: newId("s"), kind: "ai", output: "actions", prompt: "Eine fertige Antwort (als Entwurf), wo jemand etwas von mir will; ein Termin, wo etwas abgestimmt werden muss." },
    ],
  },
  { id: "teams", dataType: "message", title: "Teams", icon: "🟣", description: "Only Teams", steps: () => [filter("all", [rule("Channel", "is", "Teams")])] },
  { id: "whatsapp", dataType: "message", title: "WhatsApp", icon: "🟢", description: "Only WhatsApp", steps: () => [filter("all", [rule("Channel", "is", "WhatsApp")])] },
  { id: "signal", dataType: "message", title: "Signal", icon: "🔵", description: "Only Signal", steps: () => [filter("all", [rule("Channel", "is", "Signal")])] },
  {
    id: "important-chats",
    dataType: "message",
    title: "Important",
    icon: "⭐",
    description: "The AI keeps what asks something of you",
    steps: () => [filter("all", [rule("Mine", "is", "no")]), { id: newId("s"), kind: "ai", output: "filter", prompt: "Nur Nachrichten, in denen mich jemand direkt etwas fragt oder um etwas bittet, das noch offen ist." }],
  },
];

/** The templates for a database of this type (mails, messages). */
export const inboxTemplates = (dataType: DataType | undefined): InboxTemplate[] => INBOX_TEMPLATES.filter((x) => x.dataType === dataType);

/** An inbox from a template, under `parentId` — its id. */
export async function createInbox(parentId: number, templateId: string): Promise<number> {
  const tpl = INBOX_TEMPLATES.find((x) => x.id === templateId);
  if (!tpl) throw new Error(t("No such template."));
  const { createDerivedDatabase } = await import("@/plugins/workspace/derived");
  const { getDatabase, updatePage, updateSchema } = await import("@/plugins/workspace/store");
  const id = createDerivedDatabase(parentId, t(tpl.title));
  const d = getDatabase(id)!;
  const parentSource = d.schema.pipeline!.steps.find((s) => s.kind === "source")!;
  // Sent and Archive read the mails themselves: the parent (the inbox) leaves those folders out.
  const source: PipelineStep = tpl.folders ? { id: parentSource.id, kind: "source", from: "mail", mail: { folders: tpl.folders } } : parentSource;
  const steps = tpl.steps();
  // With an AI step: it judges the new mails after every mail sync (autoAi).
  updateSchema(id, { ...d.schema, pipeline: { steps: [source, ...steps], ...(steps.some((s) => s.kind === "ai") ? { autoAi: true } : {}) } });
  updatePage(id, { icon: tpl.icon });
  return id;
}
