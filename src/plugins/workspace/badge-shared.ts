/**
 * A page's badge in the Workspace tree: what waits on it, by tone — important (past its day, a figure gone wrong), unread (new mail,
 * open todos about a person) and activity (changed by a sync or an agent since you last opened it) — with what makes it up in words
 * ("2 open todos", "1 overdue promise"). One shape for every source (widgets on the page, a database's rows, a person's row); they add
 * up. Shared by the server (badges.ts) and the tree (Sidebar.tsx).
 */

export type BadgeTone = "important" | "unread" | "activity";

/** One source's part: how many, its tone, what it counts in words. */
export type BadgePart = { count: number; tone: BadgeTone; label: string };

/** A page's badge: the counts by tone and what they are made of. */
export type Badge = { important: number; unread: number; activity: number; parts: string[] };

/** The tree's badges: a page's own (its widgets, a mail database's unread, its activity), what its rows add up to (a database), and the rows that have one (for the entries under a database). */
export type PageBadges = { own: Record<number, Badge>; inner: Record<number, Badge>; rows: Record<number, Badge> };

export const noBadges = (): PageBadges => ({ own: {}, inner: {}, rows: {} });

/** Parts as a badge (none: null). */
export function badgeOf(parts: BadgePart[]): Badge | null {
  const b: Badge = { important: 0, unread: 0, activity: 0, parts: [] };
  for (const p of parts) {
    if (!(p.count > 0)) continue;
    b[p.tone] += p.count;
    b.parts.push(p.label);
  }
  return b.parts.length ? b : null;
}

/** Badges added up (none: null) — a parent's of its children; `parts` keep at most a few lines. */
export function sumBadges(list: (Badge | null | undefined)[], maxParts = 6): Badge | null {
  const b: Badge = { important: 0, unread: 0, activity: 0, parts: [] };
  for (const x of list) {
    if (!x) continue;
    b.important += x.important;
    b.unread += x.unread;
    b.activity += x.activity;
    for (const p of x.parts) if (b.parts.length < maxParts && !b.parts.includes(p)) b.parts.push(p);
  }
  return b.important || b.unread || b.activity ? b : null;
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
