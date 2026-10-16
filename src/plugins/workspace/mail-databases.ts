import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { newId, newView, type DbSchema, type PipelineStep } from "./model";
import { createPage, getDatabase, updatePage } from "./store";

/**
 * Your mails and messages in the Workspace — once: a database "Mail" (Outlook, Gmail, the last 30 days) and one "Chats"
 * (Teams, WhatsApp, Signal, the last 14 days), each a pipeline over its source, shown first by its app (the mail client, the
 * chat — a table without it). Made when a mail or message plugin is installed; gone ones aren't made again.
 */

const MAIL = "workspace.mailDb";
const CHATS = "workspace.chatsDb";

function make(title: string, icon: string, step: PipelineStep, app: { id: string; label: string }): number {
  const view = { ...newView(app.label, "table"), type: "app" as const, app: app.id };
  const schema: DbSchema = { titleName: t("Subject"), properties: [], views: [view, newView(t("Table"), "table")], pipeline: { steps: [step] } };
  const id = createPage({ kind: "database", title, icon, schema });
  updatePage(id, { fullWidth: true });
  return id;
}

/** The database "Mail" ("mail") or "Chats" ("message") — null: not made, or gone. */
export function homeDatabase(kind: "mail" | "message"): number | null {
  const id = getPref<number | null>(kind === "mail" ? MAIL : CHATS, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The two made (where their sources are installed and they weren't made before) — and their rows read. */
export async function ensureMailDatabases(): Promise<void> {
  if (!isInstalled("workspace")) return;
  const made: number[] = [];
  if (getPref<number | null>(MAIL, null) === null && (isInstalled("outlook-mail") || isInstalled("gmail"))) {
    const id = make(t("Mail"), "✉️", { id: newId("s"), kind: "source", from: "mail", mail: { recentDays: 30 } }, { id: "mail", label: t("Mail") });
    setPref(MAIL, id);
    made.push(id);
  }
  if (getPref<number | null>(CHATS, null) === null && (isInstalled("teams") || isInstalled("whatsapp") || isInstalled("signal"))) {
    const id = make(t("Chats"), "💬", { id: newId("s"), kind: "source", from: "messages", messages: { recentDays: 14 } }, { id: "chat", label: t("Chat") });
    setPref(CHATS, id);
    made.push(id);
  }
  const { runPipeline } = await import("./pipeline");
  for (const id of made) if (getDatabase(id)) await runPipeline(id, { ai: false });
}
