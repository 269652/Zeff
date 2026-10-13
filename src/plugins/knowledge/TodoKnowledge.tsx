"use client";

import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { cleanSnippet, ENV_LABELS, entitiesFor, pagePlace, pageSource, pagesFor, snippetParts, type KnowledgeEntity, type KnowledgePage, type PageSource, type TodoLink } from "./shared";

type Loaded = { pages: KnowledgePage[]; entities: KnowledgeEntity[]; links?: TodoLink[] } | { error: string } | null;

const SOURCES: PageSource[] = ["confluence", "keep", "zeff"];
const sourceLabel = (s: PageSource, t: T) => (s === "confluence" ? "Confluence" : s === "keep" ? "Keep" : t("From Zeff"));
const DOT: Record<PageSource, string> = { confluence: "bg-sky-500", keep: "bg-amber-500", zeff: "bg-indigo-500" };

/** The found passage, quiet: its words a little bolder, no markers. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(cleanSnippet(text)).map((x, i) =>
        x.mark ? (
          <span key={i} className="font-medium text-zinc-700 dark:text-zinc-200">
            {x.text}
          </span>
        ) : (
          <span key={i}>{x.text}</span>
        ),
      )}
    </>
  );
}

/** One page: its title (a link where it has one), where it's from, and why it helps — or the passage found. */
function PageRow({ p }: { p: KnowledgePage }) {
  const title = <span className="truncate">{p.title}</span>;
  return (
    <li className="min-w-0 py-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="flex min-w-0 font-medium text-zinc-800 hover:text-indigo-600 hover:underline dark:text-zinc-100 dark:hover:text-indigo-400">
            {title}
          </a>
        ) : (
          <span className="flex min-w-0 font-medium text-zinc-800 dark:text-zinc-100">{title}</span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-zinc-400">{pagePlace(p)}</span>
      </div>
      <p className={`line-clamp-2 text-zinc-500 dark:text-zinc-400 ${p.why ? "" : "text-[11px]"}`}>{p.why || <Snippet text={p.snippet} />}</p>
    </li>
  );
}

/** The pages grouped by where they're from (Confluence, Keep, Zeff's own), then the entities as chips. */
export function TodoKnowledgeList({ k, todoId }: { k: Loaded; todoId?: number }) {
  const t = useT();
  if (!k) return <p className="text-xs text-zinc-500">{t("Searching the knowledge …")}</p>;
  if ("error" in k) return <p className="text-xs text-red-600 dark:text-red-400">{k.error}</p>;
  const pages = pagesFor(k.pages, todoId);
  const entities = entitiesFor(k.entities, pages);
  const links = k.links ?? [];
  if (!pages.length && !entities.length && !links.length) return <p className="text-xs text-zinc-500">{t("Nothing fitting in the knowledge.")}</p>;
  const groups = SOURCES.map((s) => ({ s, pages: pages.filter((p) => pageSource(p) === s) })).filter((g) => g.pages.length);
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs">
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t("Systems")}>
          {links.map((l) => (
            <li key={l.url}>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={`${l.url}${l.page ? ` — ${l.page}` : ""}`}
                className={`rounded-full border px-2 py-0.5 text-[11px] hover:underline ${l.env === "prod" ? "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300" : l.env === "test" ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
              >
                {[ENV_LABELS[l.env], l.label].filter(Boolean).join(" · ") || l.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {groups.map((g) => (
        <section key={g.s} className="min-w-0">
          {groups.length > 1 && (
            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
              <span className={`size-1.5 rounded-full ${DOT[g.s]}`} aria-hidden />
              {sourceLabel(g.s, t)}
            </h4>
          )}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {g.pages.map((p) => (
              <PageRow key={p.id} p={p} />
            ))}
          </ul>
        </section>
      ))}
      {entities.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {entities.map((e) => (
            <span
              key={e.id}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              title={[e.summary, ...e.related.map((r) => (r.dir === "out" ? `→ ${r.rel} ${r.name}` : `← ${r.name} ${r.rel}`))].join("\n")}
            >
              {e.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The toggle's hovercard: the knowledge the Wissens-Zuordnung picked. */
export function TodoKnowledgePreview({ k, todoId }: { k: Loaded; todoId?: number }) {
  const t = useT();
  return (
    <div className="space-y-1 overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-medium text-zinc-600 dark:text-zinc-300">{t("Knowledge")}</p>
      <TodoKnowledgeList k={k} todoId={todoId} />
    </div>
  );
}
