import { isInstalled } from "@/plugins/state";
import type { DataType } from "./model";

/**
 * Views of apps: a database of a type (mails, messages) shown by an app — the mail client, the chat — a view like any of
 * the database's ("app" with its id). Each comes with its plugin: not installed, the view isn't offered and a database's
 * app view shows as a table.
 */
export type AppView = { id: string; plugin: string; dataType: DataType; label: string; icon: string };

export const APP_VIEWS: AppView[] = [
  { id: "mail", plugin: "mail-client", dataType: "mail", label: "Mail", icon: "✉" },
  { id: "chat", plugin: "mail-client", dataType: "message", label: "Chat", icon: "💬" },
  { id: "inbox", plugin: "mail-client", dataType: "inbox", label: "Inbox", icon: "📬" },
  { id: "people", plugin: "people", dataType: "people", label: "Overview", icon: "👥" },
  { id: "calendar", plugin: "calendar", dataType: "calendar", label: "Calendar", icon: "📅" },
  { id: "documents", plugin: "documents", dataType: "documents", label: "Documents", icon: "🗂" },
];

/** The app views a database of this type can have now (their plugins installed). */
export const appViewsFor = (dataType: DataType | undefined): AppView[] => (dataType ? APP_VIEWS.filter((a) => a.dataType === dataType && isInstalled(a.plugin)) : []);
