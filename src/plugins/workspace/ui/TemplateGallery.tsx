"use client";

import { useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { TemplateCategory, TemplateMeta } from "../templates";

/** The order the groups are shown in, with the tint of their icons. */
const GROUPS: { key: TemplateCategory; tint: string }[] = [
  { key: "overview", tint: "bg-indigo-50 dark:bg-indigo-950/60" },
  { key: "work", tint: "bg-emerald-50 dark:bg-emerald-950/60" },
  { key: "notes", tint: "bg-amber-50 dark:bg-amber-950/50" },
  { key: "automation", tint: "bg-violet-50 dark:bg-violet-950/60" },
  { key: "packages", tint: "bg-sky-50 dark:bg-sky-950/60" },
];

/**
 * Ready-made pages and databases as a gallery: a search, the groups as tabs, each template a card — its icon, its name, what it gives you
 * and whether it is a page or a database. A click makes it.
 */
export function TemplateGallery({ templates, onPick, busy }: { templates: TemplateMeta[]; onPick: (key: string) => void; busy?: string | null }) {
  const t = useT();
  const labels: Record<TemplateCategory, string> = { overview: t("Overviews"), work: t("Work and projects"), notes: t("Notes and meetings"), automation: t("Agents and automations"), packages: t("Packages") };
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<TemplateCategory | "all">("all");
  const present = GROUPS.filter((g) => templates.some((x) => x.category === g.key));
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    return templates.filter((x) => (group === "all" || x.category === group) && (!w || `${x.name} ${x.description}`.toLowerCase().includes(w)));
  }, [templates, q, group]);
  const tint = (c: TemplateCategory) => GROUPS.find((g) => g.key === c)?.tint ?? "bg-zinc-100 dark:bg-zinc-800";
  const chip = (key: TemplateCategory | "all", label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={group === key}
      onClick={() => setGroup(key)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${group === key ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1.5" role="group" aria-label={t("Groups")}>
          {chip("all", t("All"))}
          {present.map((g) => chip(g.key, labels[g.key]))}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search templates …")} aria-label={t("Search templates")} className="input w-56 py-1 text-sm" />
      </div>
      {shown.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">{t("No template matches.")}</p>}
      <ul className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(15.5rem,1fr))]">
        {shown.map((x) => (
          <li key={x.key}>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => onPick(x.key)}
              className="group flex h-full w-full flex-col gap-2 rounded-2xl border border-zinc-200/80 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-px hover:border-indigo-300 hover:shadow-md disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
            >
              <span className="flex items-center gap-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-xl ${tint(x.category)}`} aria-hidden>
                  {busy === x.key ? <span className="inline-block animate-spin text-base">↻</span> : x.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{x.name}</span>
                  <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{x.kind === "database" ? t("Database") : t("Page")}</span>
                </span>
              </span>
              <span className="line-clamp-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{x.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
