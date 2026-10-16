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
  key: "jira" | "keep" | "todos";
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
};

export function sourcesOverview(): SourceView[] {
  const out: SourceView[] = [];
  if (isInstalled("jira-lage") || isInstalled("jira")) out.push(jiraSource());
  if (isInstalled("keep")) out.push(keepSource());
  if (isInstalled("todos")) out.push(todoSource());
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
