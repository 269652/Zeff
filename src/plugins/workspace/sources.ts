import "@/plugins/contributions";
import { getSqlite } from "@/db";
import { workspaceSources } from "./source-point";
import { listTodos } from "@/lib/todos/store";
import { listJiraBoards } from "@/lib/jira/store";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { briefingDatabase, jiraBoardDatabase } from "@/plugins/jira-lage/to-workspace";
import { googleKeepHref } from "@/plugins/keep/google-workspace";
import { keepCount, keepSettings } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";
import { allTaskLists } from "./task-lists";

/**
 * The Workspace's data sources — what fills its databases from elsewhere: Jira (each board you switch on is a board
 * database, My briefing a page), Google Keep (its notes a gallery database), your todos (to be taken in by a board or
 * any database). Each with what it brings, the databases it keeps, and its sync (step key, for Sync now and the interval).
 */

export type SourceView = {
  /** The built-in ones, or "ext:<id>" — a source a plugin brings (People). */
  key: "jira" | "keep" | "todos" | "mail" | "messages" | `ext:${string}`;
  /** A plugin source: what the records are. */
  hint?: string;
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
  /** To-do lists in pages: each list by its path, its Todo-engine switch, and the database that follows it (if any). */
  lists?: { key: string; pageId: number; listId: string; path: string; title: string; engine: boolean; open: number; total: number; database: string | null }[];
  /** Google Keep: the Google account its sync reads (its number in the automation Chrome, or its address). */
  keepAccount?: string;
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
  for (const c of workspaceSources.list()) for (const s of c.impl) if (!s.relationOnly) out.push(extSource(s));
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
    setup: null,
    keepAccount: keepSettings().account,
    count: keepCount(),
    databases: href ? [{ title: "Google Keep", href }] : [],
  };
}

function todoSource(): SourceView {
  return { key: "todos", name: "Todos", step: null, ready: true, setup: null, count: listTodos({ status: "open" }).length, databases: [] };
}

function mailSource(): SourceView {
  const n = (getSqlite().prepare("select count(*) as n from emails where folder not in ('WhatsApp', 'Signal')").get() as { n: number }).n;
  return { key: "mail", name: "Mail", step: "mail", ready: true, setup: { text: "Which folders are read", href: "/settings/mail" }, count: n, databases: databasesUsing("mail"), home: null };
}

function messageSource(): SourceView {
  const chats = (getSqlite().prepare("select count(*) as n from emails where folder in ('WhatsApp', 'Signal')").get() as { n: number }).n;
  const teams = (getSqlite().prepare("select count(*) as n from teams_messages").get() as { n: number }).n;
  return { key: "messages", name: "Teams · WhatsApp · Signal", step: null, ready: true, setup: null, count: chats + teams, databases: databasesUsing("messages"), home: null };
}

/** A source a plugin brings (People's profiles …): its count, and the databases that name it. */
function extSource(s: import("./source-point").WorkspaceSource): SourceView {
  const rows = getSqlite().prepare(`select id, title, schema from ws_pages where kind = 'database' and archived_at is null and schema like ?`).all(`%"ext":"${s.id}"%`) as { id: number; title: string; schema: string }[];
  const databases = rows
    .filter((r) => {
      try {
        return ((JSON.parse(r.schema) as { pipeline?: { steps?: { kind: string; from?: string; ext?: string }[] } }).pipeline?.steps ?? []).some((x) => x.kind === "source" && x.from === "ext" && x.ext === s.id);
      } catch {
        return false;
      }
    })
    .map((r) => ({ title: r.title, href: `/workspace/${r.id}` }));
  const lists =
    s.id === "page-tasks"
      ? allTaskLists().map((l) => ({
          key: l.key,
          pageId: l.pageId,
          listId: l.listId,
          path: l.path,
          title: l.title,
          engine: l.engine,
          open: l.items.filter((i) => !i.checked && i.text).length,
          total: l.items.filter((i) => i.text).length,
          database: (rows.find((r) => r.schema.includes(`"label":"${l.key}"`)) ? `/workspace/${rows.find((r) => r.schema.includes(`"label":"${l.key}"`))!.id}` : null) as string | null,
        }))
      : undefined;
  return { key: `ext:${s.id}`, name: s.label, hint: s.hint, step: null, ready: true, setup: null, count: s.count?.() ?? 0, databases, ...(lists ? { lists } : {}) };
}

/** The databases that name this channel as a source (any — the inbox, derived ones, your own): the catalog's links. */
function databasesUsing(from: "mail" | "messages"): { title: string; href: string }[] {
  const rows = getSqlite().prepare(`select id, title, schema from ws_pages where kind = 'database' and archived_at is null and schema like ?`).all(`%"from":"${from}"%`) as { id: number; title: string; schema: string }[];
  return rows
    .filter((r) => {
      try {
        return ((JSON.parse(r.schema) as { pipeline?: { steps?: { kind: string; from?: string }[] } }).pipeline?.steps ?? []).some((x) => x.kind === "source" && x.from === from);
      } catch {
        return false;
      }
    })
    .map((r) => ({ title: r.title, href: `/workspace/${r.id}` }));
}
