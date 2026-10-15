"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useT } from "@/components/I18nProvider";
import { filterPeople, type PeopleSort, type PersonRow } from "./list-filter";
import { updatePersonFormAction } from "./server-actions";

/** A person as the list shows them: the searchable fields and the lines the server worded. */
export type PersonCardRow = PersonRow & { aliasLine: string; aliasTitle: string; dateLine: string };

/**
 * The People list with its search (name, aliases, mail addresses, notes), "starred only" toggle and
 * sort. The whole list is loaded, so it filters in the browser; the count is announced politely.
 */
export function PeopleList({ rows }: { rows: PersonCardRow[] }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [sort, setSort] = useState<PeopleSort>("name");
  const shown = filterPeople(rows, { query, starredOnly, sort }) as PersonCardRow[];
  const filtered = query.trim() !== "" || starredOnly;
  const clear = () => {
    setQuery("");
    setStarredOnly(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search name, alias, mail, notes…")} aria-label={t("Search people")} className="input min-w-0 flex-1 basis-56" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} />
          {t("Starred only")}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-zinc-500">{t("Sort")}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as PeopleSort)} className="input w-auto">
            <option value="name">{t("Name")}</option>
            <option value="next">{t("Next date")}</option>
            <option value="recent">{t("Last heard from")}</option>
            <option value="added">{t("Recently added")}</option>
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-zinc-500">
        {filtered ? t("{shown} of {n} people", { shown: shown.length, n: rows.length }) : ""}
      </p>
      {shown.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id} className="card flex items-start gap-2 p-3">
              <form action={updatePersonFormAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="to" value="/personen" />
                <input type="hidden" name="starred" value={p.starred ? "0" : "1"} />
                <button
                  aria-pressed={p.starred}
                  className={`text-lg leading-none ${p.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`}
                  title={p.starred ? t("Don't keep at the top") : t("Keep at the top")}
                  aria-label={t("Keep {name} at the top", { name: p.name })}
                >
                  ★
                </button>
              </form>
              <Link href={`/personen/${p.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium hover:underline">{p.name}</span>
                {p.aliasLine && (
                  <span className="block truncate text-xs text-zinc-500" title={p.aliasTitle}>
                    {p.aliasLine}
                  </span>
                )}
                <span className="block truncate text-xs text-zinc-500">{p.dateLine}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>
          {t("Nobody matches.")}{" "}
          <button type="button" onClick={clear} className="underline hover:no-underline">
            {t("Clear filters")}
          </button>
        </EmptyState>
      )}
    </div>
  );
}
