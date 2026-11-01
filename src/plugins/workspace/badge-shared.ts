/**
 * A page's badge in the Workspace tree: what waits on it, by tone — important (past its day, a figure gone wrong), unread (new mail,
 * open todos about a person) and activity (changed by a sync or an agent since you last opened it) — with what makes it up in words
 * ("2 open todos", "1 overdue promise"). One shape for every source (widgets on the page, a database's rows, a person's row); they add
 * up. Shared by the server (badges.ts) and the tree (Sidebar.tsx).
 */

/** messages: unread messages from someone (a person's row) — a pill of its own beside what waits. */
export type BadgeTone = "important" | "unread" | "activity" | "messages";

/** One source's part: how many, its tone, what it counts in words. */
export type BadgePart = { count: number; tone: BadgeTone; label: string; /** Todos: counted in their own pill (☐ n — red when some are late). */ todo?: boolean };

/** A page's badge: the counts by tone and what they are made of. */
export type Badge = { important: number; unread: number; activity: number; messages: number; /** Open todos, and how many of them are late. */ todos: number; todosLate: number; parts: string[] };

/** The tree's badges: a page's own (its widgets, a mail database's unread, its activity), what its rows add up to (a database), and the rows that have one (for the entries under a database). */
export type PageBadges = { own: Record<number, Badge>; inner: Record<number, Badge>; rows: Record<number, Badge> };

export const noBadges = (): PageBadges => ({ own: {}, inner: {}, rows: {} });

/** Parts as a badge (none: null). */
export function badgeOf(parts: BadgePart[]): Badge | null {
  const b: Badge = { important: 0, unread: 0, activity: 0, messages: 0, todos: 0, todosLate: 0, parts: [] };
  for (const p of parts) {
    if (!(p.count > 0)) continue;
    if (p.todo) {
      b.todos += p.count;
      if (p.tone === "important") b.todosLate += p.count;
      b.parts.push(p.label);
      continue;
    }
    b[p.tone] += p.count;
    b.parts.push(p.label);
  }
  return b.parts.length ? b : null;
}

/** The open todos a badge carries, and how many are late (their own pill). */
export function shownTodos(b: Badge | null | undefined): { n: number; late: number } {
  return { n: b?.todos ?? 0, late: b?.todosLate ?? 0 };
}

/** The unread messages a badge carries (their own pill). */
export function shownMessages(b: Badge | null | undefined): number {
  return b?.messages ?? 0;
}

/** Badges added up (none: null) — a parent's of its children; `parts` keep at most a few lines. */
export function sumBadges(list: (Badge | null | undefined)[], maxParts = 6): Badge | null {
  const b: Badge = { important: 0, unread: 0, activity: 0, messages: 0, todos: 0, todosLate: 0, parts: [] };
  for (const x of list) {
    if (!x) continue;
    b.todos += x.todos ?? 0;
    b.todosLate += x.todosLate ?? 0;
    b.important += x.important;
    b.unread += x.unread;
    b.activity += x.activity;
    b.messages += x.messages ?? 0;
    for (const p of x.parts) if (b.parts.length < maxParts && !b.parts.includes(p)) b.parts.push(p);
  }
  return b.important || b.unread || b.activity || b.messages || b.todos ? b : null;
}

/** What the pill shows: important wins over unread over activity (activity: a dot, no number). */
export function shownBadge(b: Badge | null | undefined): { tone: BadgeTone; count: number; late?: number } | null {
  if (!b) return null;
  // All that waits as the number; important (late, gone wrong) only marks it (a red dot) — never a number of its own.
  if (b.important > 0) return { tone: "important", count: b.important + b.unread, late: b.important };
  if (b.unread > 0) return { tone: "unread", count: b.unread };
  if (b.activity > 0) return { tone: "activity", count: 0 };
  return null;
}

/** A count as the pill shows it (a big one cut). */
export const countLabel = (n: number): string => (n > 999 ? "999+" : String(n));
