import { t } from "@/lib/i18n/server";
import { ALL_FEEDS, categoriesOf, LANGUAGES, starterFeeds } from "./catalog";
import { addCategoryFormAction, addPresetFormAction, addStarterFormAction } from "./server-actions";

const MAX_ROWS = 80;

/**
 * The stock catalog: outlets and topic packs by category, filtered by language and a search, each one click to add —
 * or a whole category at once. Server component; the filters are the page's query (?lang=, ?q=).
 */
export function CatalogBrowser({ have, lang, q }: { have: Set<string>; lang: string; q: string }) {
  const query = q.trim().toLowerCase();
  const matches = ALL_FEEDS.filter((f) => (!lang || f.lang === lang) && (!query || `${f.name} ${f.category} ${f.url}`.toLowerCase().includes(query)));
  const cats = categoriesOf(matches);
  const starterMissing = starterFeeds().filter((f) => !have.has(f.url)).length;
  const langs = [...new Set(ALL_FEEDS.map((f) => f.lang))].sort();
  const link = (l: string) => `/settings/news?${new URLSearchParams({ ...(l ? { lang: l } : {}), ...(q ? { q } : {}) })}#catalog`;

  return (
    <section id="catalog" className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Catalog")}</h2>
        <span className="text-xs text-zinc-500">{t("{n} feeds in {c} categories", { n: ALL_FEEDS.length, c: categoriesOf().length })}</span>
      </div>
      <p className="text-xs text-zinc-500">{t("Outlets checked against the live internet, and topic packs (a news search per topic). Add what you like — the more there is, the more there is to choose from and learn from.")}</p>

      {starterMissing > 0 && (
        <form action={addStarterFormAction} className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-sm">{t("Add the starter pack")}</button>
          <span className="text-xs text-zinc-500">{t("About fifty well-known sources across topics and languages ({n} not yet added).", { n: starterMissing })}</span>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <form method="get" action="/settings/news" className="flex items-center gap-2">
          {lang && <input type="hidden" name="lang" value={lang} />}
          <input name="q" defaultValue={q} placeholder={t("Search the catalog …")} className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          <button className="btn btn-sm">{t("Search")}</button>
        </form>
        <span className="flex flex-wrap gap-1">
          <a href={link("")} className={`btn btn-sm ${!lang ? "btn-primary" : ""}`}>
            {t("All languages")}
          </a>
          {langs.map((l) => (
            <a key={l} href={link(l)} className={`btn btn-sm ${lang === l ? "btn-primary" : ""}`}>
              {LANGUAGES[l] ?? l.toUpperCase()}
            </a>
          ))}
        </span>
      </div>

      <div className="space-y-2">
        {cats.length === 0 && <p className="text-sm text-zinc-500">{t("Nothing in the catalog matches.")}</p>}
        {cats.map(({ category }) => {
          const feeds = matches.filter((f) => f.category === category);
          const todo = feeds.filter((f) => !have.has(f.url)).length;
          return (
            <details key={category} open={!!query} className="rounded border border-zinc-200 dark:border-zinc-800">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm font-medium">
                <span className="flex-1">
                  {category} <span className="font-normal text-zinc-500">({feeds.length}{todo < feeds.length ? ` · ${feeds.length - todo} ${t("added")}` : ""})</span>
                </span>
              </summary>
              <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
                {todo > 0 && (
                  <form action={addCategoryFormAction}>
                    <input type="hidden" name="category" value={category} />
                    <input type="hidden" name="lang" value={lang} />
                    <button className="btn btn-sm">{t("Add all {n}", { n: todo })}</button>
                  </form>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {feeds.slice(0, MAX_ROWS).map((f) =>
                    have.has(f.url) ? (
                      <span key={f.url} className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                        ✓ {f.name}
                      </span>
                    ) : (
                      <form key={f.url} action={addPresetFormAction}>
                        <input type="hidden" name="url" value={f.url} />
                        <button className="btn btn-sm" title={`${f.lang.toUpperCase()} · ${f.url}`}>
                          + {f.name}
                        </button>
                      </form>
                    ),
                  )}
                </div>
                {feeds.length > MAX_ROWS && <p className="text-xs text-zinc-500">{t("{n} more — search to narrow it down, or add them all.", { n: feeds.length - MAX_ROWS })}</p>}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
