/**
 * The one search's pure part (client and server): its sources, the filters the overlay offers, what a typed text means
 * (">" for the commands, "in:news" for a database), and how hits are ranked and their groups ordered — the same for every source.
 */
import { scoreItem, type PaletteItem } from "@/lib/palette";

/** Where a hit comes from. "nav" (the menu's pages and settings) is found in the browser, the rest by /api/search. */
export const SEARCH_SOURCES = ["nav", "pages", "rows", "templates", "people", "todos", "tickets", "mails", "messages", "documents", "metrics", "commands"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

/** The overlay's filter: everything, the Workspace (its sidebar opens the search on it), or one source. */
export type SearchFilter = "all" | "workspace" | SearchSource;
export const WORKSPACE_SOURCES: SearchSource[] = ["pages", "rows", "templates", "metrics"];

/** The sources a filter searches. */
export const sourcesOf = (f: SearchFilter): SearchSource[] => (f === "all" ? [...SEARCH_SOURCES] : f === "workspace" ? WORKSPACE_SOURCES : [f]);

/** A hit: an entry to open (or a "zeff:…" command to run), with the source it came from and its score. */
export type SearchHit = PaletteItem & { source: SearchSource; score: number; icon?: string };
/** Hits of one kind (one database's rows are a group of their own), the best first; `total`: how many there were. */
export type SearchGroup = { key: string; source: SearchSource; label: string; total: number; hits: SearchHit[] };

/** The English names of the groups (translated where shown). */
export const SOURCE_LABELS: Record<SearchSource, string> = {
  nav: "Go to",
  pages: "Pages",
  rows: "Rows",
  templates: "Templates",
  people: "People",
  todos: "Todos",
  tickets: "Tickets",
  mails: "Mails",
  messages: "Messages",
  documents: "Documents",
  metrics: "Metrics",
  commands: "Commands",
};

/** What a typed text asks: ">" first → only the commands; "in:news" → the rows (and pages) of what is called that. */
export function parseQuery(raw: string): { words: string; commands: boolean; within: string | null } {
  let q = raw.trimStart();
  const commands = q.startsWith(">");
  if (commands) q = q.slice(1);
  const scope = /(?:^|\s)in:(\S+)/i.exec(q);
  if (scope) q = q.replace(scope[0], " ");
  return { words: q.trim().replace(/\s+/g, " ").slice(0, 100), commands, within: scope ? scope[1].toLowerCase() : null };
}

/**
 * A hit's score by what it is called, the same for every source (the label starts with the words > a word of it does > it has
 * them > its hint has them). A hit its source found by its content alone (a page's text, a mail's body) still counts: `floor`.
 */
export const rank = (item: PaletteItem, words: string, floor = 5): number => Math.max(scoreItem(item, words), floor);

/** Groups shown in an order: what the words fit best first; on a tie the source's place (the menu first, the commands last). */
export function orderGroups(groups: SearchGroup[]): SearchGroup[] {
  const top = (g: SearchGroup) => g.hits[0]?.score ?? 0;
  return groups
    .filter((g) => g.hits.length)
    .map((g) => ({ ...g, hits: [...g.hits].sort((a, b) => b.score - a.score) }))
    .sort((a, b) => top(b) - top(a) || SEARCH_SOURCES.indexOf(a.source) - SEARCH_SOURCES.indexOf(b.source));
}

/** The menu's pages and settings as a group, for the words (all of them, the first `limit`, with none typed). */
export function navGroup(pages: PaletteItem[], words: string, limit = 8): SearchGroup {
  const scored = pages.map((p, i) => ({ p, i, s: words ? scoreItem(p, words) : 1 })).filter((x) => x.s > 0);
  if (words) scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const hits = scored.slice(0, limit).map((x): SearchHit => ({ ...x.p, source: "nav", score: x.s }));
  return { key: "nav", source: "nav", label: SOURCE_LABELS.nav, total: scored.length, hits };
}

/** Open the search (the header's button, the Workspace's sidebar …): with a filter, with text typed already. */
export type OpenSearch = { filter?: SearchFilter; q?: string };
export const SEARCH_EVENT = "zeff:search";
export function openSearch(detail: OpenSearch = {}) {
  window.dispatchEvent(new CustomEvent<OpenSearch>(SEARCH_EVENT, { detail }));
}
