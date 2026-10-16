import { getSqlite } from "@/db";
import { derivedOf } from "./derived";
import { homeDatabase } from "./mail-databases";
import { listTodos } from "@/lib/boards/store";
import { listJiraBoards } from "@/lib/jira/store";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { briefingDatabase, jiraBoardDatabase } from "@/plugins/jira-lage/to-workspace";
import { googleKeepHref } from "@/plugins/keep/google-workspace";
import { keepCount } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

/**
 * The Workspace's data sources — what fills its databases from elsewhere: Jira (each board you switch on is a board
 * database, My briefing a page), Google Keep (its notes a gallery database), your todos (to be taken in by a board or
 * any database). Each with what it brings, the databases it keeps, and its sync (step key, for Sync now and the interval).
 */

export type SourceView = {
  key: "jira" | "keep" | "todos" | "mail" | "messages";
  name: string;
  /** Its sync step (the Sync menu's key); none: it's read as it is. */
  step: string | null;
  /** Set up to be read (Jira's connection, Google's account …). */
  ready: boolean;
  /** What to do when it isn't, and where. */
  setup: { text: string; href: string } | null;
  /** How many records it has now. */
  count: number;
  /** Jira: its boards, switched on or off here, with their database once kept. */
  boards?: { id: number; name: string; project: string | null; enabled: boolean; href: string | null }[];
  /** The databases (and pages) it keeps. */
  databases: { title: string; href: string }[];
  /** Mail, messages: the database the inboxes go under ("Mail", "Chats") — its type for the templates. */
  home?: { id: number; dataType: "mail" | "message"; inboxes: { title: string; href: string }[] } | null;
};

export function sourcesOverview(): SourceView[] {
  const out: SourceView[] = [];
  if (isInstalled("jira-lage") || isInstalled("jira")) out.push(jiraSource());
  if (isInstalled("keep")) out.push(keepSource());
  if (isInstalled("todos")) out.push(todoSource());
  if (isInstalled("outlook-mail") || isInstalled("gmail")) out.push(mailSource());
  if (isInstalled("teams") || isInstalled("whatsapp") || isInstalled("signal")) out.push(messageSource());
  return out;
}

function jiraSource(): SourceView {
  const cfg = getJiraSyncConfig();
  const href = (id: string) => {
    const db = jiraBoardDatabase(id);
    return db ? `/workspace/${db}` : null;
  };
  // The ones switched on first.
  const boards = listJiraBoards()
    .map((b) => ({ id: b.id, name: b.name, project: b.projectKey, enabled: b.enabled, href: b.enabled ? href(`jira-${b.id}`) : null }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled));
  const briefing = briefingDatabase();
  const mine = briefing ? `/workspace/${briefing}` : null;
  return {
    key: "jira",
    name: "Jira",
    step: "jira",
    ready: cfg.configured,
    setup: cfg.configured ? null : { text: "Jira isn't set up.", href: "/jira" },
    count: boards.filter((b) => b.enabled).length,
    boards,
    databases: [...(mine ? [{ title: "Meine Lage", href: mine }] : []), ...boards.flatMap((b) => (b.href ? [{ title: b.name, href: b.href }] : []))],
  };
}

function keepSource(): SourceView {
  const href = googleKeepHref();
  return {
    key: "keep",
    name: "Google Keep",
    step: "keep",
    ready: true,
    setup: { text: "The Google account Keep is read with", href: "/keep/settings" },
    count: keepCount(),
    databases: href ? [{ title: "Google Keep", href }] : [],
  };
}

function todoSource(): SourceView {
  return { key: "todos", name: "Todos", step: null, ready: true, setup: null, count: listTodos({ status: "open" }).length, databases: [] };
}

function mailSource(): SourceView {
  const n = (getSqlite().prepare("select count(*) as n from emails where folder not in ('WhatsApp', 'Signal')").get() as { n: number }).n;
  return { key: "mail", name: "Mail", step: "mail", ready: true, setup: { text: "Which folders are read", href: "/settings/mail" }, count: n, databases: [], home: home("mail") };
}

function messageSource(): SourceView {
  const chats = (getSqlite().prepare("select count(*) as n from emails where folder in ('WhatsApp', 'Signal')").get() as { n: number }).n;
  const teams = (getSqlite().prepare("select count(*) as n from teams_messages").get() as { n: number }).n;
  return { key: "messages", name: "Teams · WhatsApp · Signal", step: null, ready: true, setup: null, count: chats + teams, databases: [], home: home("message") };
}

/** "Mail" / "Chats" with the inboxes under it (their derived databases). */
function home(kind: "mail" | "message"): SourceView["home"] {
  const id = homeDatabase(kind);
  if (!id) return null;
  return { id, dataType: kind, inboxes: derivedOf(id).map((d) => ({ title: `${d.icon ? `${d.icon} ` : ""}${d.title}${d.unread ? ` · ${d.unread}` : ""}`, href: `/workspace/${d.id}` })) };
}
