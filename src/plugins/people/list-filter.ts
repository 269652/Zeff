/** The People list's search, filter and sort — pure, client-safe. */

export type PersonRow = {
  id: number;
  name: string;
  aliases: string[];
  emails: string[];
  note: string;
  starred: boolean;
  createdAt: string;
  /** Days until their next date (null: none coming up). */
  nextDays: number | null;
  /** When they were last in a message (ISO; null: never). */
  lastAt: string | null;
};

export const PEOPLE_SORTS = ["name", "next", "recent", "added"] as const;
export type PeopleSort = (typeof PEOPLE_SORTS)[number];

const fold = (s: string) => s.toLowerCase();

/** Whether every word of the query is in the person's name, aliases, mail addresses or notes. */
export function personMatches(p: PersonRow, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([p.name, ...p.aliases, ...p.emails, p.note].join("\n"));
  return words.every((w) => hay.includes(w));
}

/** Filtered and sorted; the starred stay on top within every sort. */
export function filterPeople(rows: PersonRow[], o: { query: string; starredOnly: boolean; sort: PeopleSort }): PersonRow[] {
  const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const key: Record<PeopleSort, (a: PersonRow, b: PersonRow) => number> = {
    name: byName,
    next: (a, b) => (a.nextDays ?? Infinity) - (b.nextDays ?? Infinity) || byName(a, b),
    recent: (a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || byName(a, b),
    added: (a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b),
  };
  return rows
    .filter((p) => (!o.starredOnly || p.starred) && personMatches(p, o.query))
    .sort((a, b) => Number(b.starred) - Number(a.starred) || key[o.sort](a, b));
}
