"use client";

/** A person's initials (a card's avatar). */
export const initials = (name: string) =>
  name
    .replace(/\(.*\)/, "")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const NOBODY = "—";

/**
 * The board's people as chips — each with how many cards they have; click to show only theirs
 * (several at once), again to let go. "—": the cards nobody is on.
 */
export function PersonChips({ people, selected, onToggle, onClear }: { people: { name: string; count: number }[]; selected: Set<string>; onToggle: (name: string) => void; onClear: () => void }) {
  if (!people.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by person">
      {people.map((p) => {
        const on = selected.has(p.name);
        return (
          <button
            key={p.name}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(p.name)}
            className={`flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs transition ${
              on
                ? "border-indigo-500 bg-indigo-600 text-white dark:border-indigo-400"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            }`}
            title={p.name === NOBODY ? "Cards without a person" : p.name}
          >
            <span className={`flex size-5 items-center justify-center rounded-full text-[9px] font-semibold ${on ? "bg-white/25" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}>{p.name === NOBODY ? "—" : initials(p.name)}</span>
            <span className="max-w-32 truncate">{p.name === NOBODY ? "Nobody" : p.name.replace(/\s*\(.*\)$/, "")}</span>
            <span className={on ? "text-white/80" : "text-zinc-400"}>{p.count}</span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <button type="button" onClick={onClear} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          all
        </button>
      )}
    </div>
  );
}

/** The people of a set of cards, most cards first (and "—" for the unassigned, when there are some). */
export function peopleOf(assignees: (string | null)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of assignees) counts.set(a || NOBODY, (counts.get(a || NOBODY) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => (a.name === NOBODY ? 1 : b.name === NOBODY ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
}
