import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { isInstalled } from "@/plugins/state";
import type { DataType, View } from "./model";

/**
 * Views of apps: a database of a type (mails, messages) shown by an app — the mail client, the chat — a view like any of
 * the database's ("app" with its id). Each comes with its plugin: not installed, the view isn't offered and a database's
 * app view shows as a table.
 */
export type AppView = { id: string; plugin: string; /** The databases of this type have it … */ dataType?: DataType; /** … or the databases this plugin owns (Learn's). */ owner?: string; label: string; icon: string; /** A plugin's (contributes.appViews): its view template — the view is a template view of it. */ template?: string };

/** The app views external plugins bring (ext-points.ts: contributes.appViews, while they are on). */
export const extAppViews = extensionPoint<AppView[]>("workspace.appViews");

export const APP_VIEWS: AppView[] = [
  { id: "mail", plugin: "mail-client", dataType: "mail", label: "Mail", icon: "✉" },
  { id: "chat", plugin: "mail-client", dataType: "message", label: "Chat", icon: "💬" },
  { id: "inbox", plugin: "mail-client", dataType: "inbox", label: "Inbox", icon: "📬" },
  { id: "people", plugin: "people", dataType: "people", label: "Overview", icon: "👥" },
  { id: "calendar", plugin: "calendar", dataType: "calendar", label: "Calendar", icon: "📅" },
  { id: "documents", plugin: "documents", dataType: "documents", label: "Documents", icon: "🗂" },
  { id: "cases", plugin: "cases", dataType: "cases", label: "Overview", icon: "📁" },
  { id: "debts", plugin: "finances", dataType: "debts", label: "Overview", icon: "💶" },
  { id: "agenda", plugin: "agenda", dataType: "agenda", label: "Agenda", icon: "📒" },
  { id: "news", plugin: "news", dataType: "news", label: "News", icon: "📰" },
  { id: "jira", plugin: "jira", dataType: "jira", label: "Jira", icon: "🎫" },
  { id: "gitlab", plugin: "gitlab", dataType: "gitlab", label: "GitLab", icon: "🦊" },
];

/** The app views a database of this type can have now (their plugins installed). */
export const appViewsFor = (dataType: DataType | undefined, owner?: string): AppView[] => [
  ...APP_VIEWS.filter((a) => ((!!dataType && a.dataType === dataType) || (!!owner && a.owner === owner)) && isInstalled(a.plugin)),
  ...(dataType ? extAppViews.all().flatMap((c) => c.impl).filter((a) => a.dataType === dataType) : []),
];

/** An app view as a database's view: the built-in's by its id, a plugin's as a template view of its template. */
export const appViewFields = (a: AppView): Pick<View, "type" | "app" | "template"> => (a.template !== undefined ? { type: "app", app: "template", template: a.template } : { type: "app", app: a.id });
