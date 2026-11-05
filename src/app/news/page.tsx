import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { AskNews } from "@/plugins/news/AskNews";
import { ListenButton } from "@/plugins/news/Listen";
import { NewsFeed } from "@/plugins/news/NewsFeed";
import { NewsFetching, NewsRefreshButtons } from "@/plugins/news/RefreshButton";
import { getDigest } from "@/plugins/news/digest";
import { DiscoverButton } from "@/plugins/news/DiscoverButton";
import { getTaste } from "@/plugins/news/taste";
import { FunnelButton } from "@/plugins/news/FunnelButton";
import { NewsStories } from "@/plugins/news/Stories";
import { storyGroups } from "@/plugins/news/story-groups";
import { NEWS_PAGE } from "@/plugins/news/shared";
import { cameInToday, counts, funnelNow, funnelStats, getItem, getPrefs, listItems, listSources, type NewsView } from "@/plugins/news/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("News") };
}

const VIEWS: NewsView[] = ["foryou", "discover", "latest", "saved", "filtered", "hidden"];

/** News: what your sources and interests brought, in the order that fits you; teach it with 👍 👎. */
export default async function NewsPage({ searchParams }: { searchParams: Promise<{ view?: string; source?: string; category?: string }> }) {
  await connection();
  if (!isInstalled("news")) return <PluginNotInstalled id="news" />;
  const sp = await searchParams;
  const view = (VIEWS as string[]).includes(sp.view ?? "") ? (sp.view as NewsView) : "foryou";
  const sourceId = Number(sp.source) || undefined;
  const category = sp.category ?? "";
  const prefs = getPrefs();
  const sources = listSources();
  const items = listItems({ view, sourceId, category: category || undefined, maxAgeDays: prefs.maxAgeDays, limit: NEWS_PAGE });
  const c = counts();
  const digest = view === "foryou" && !sourceId ? getDigest() : null;
  const byId = new Map([...(digest?.picks ?? []).map((p) => p.id), ...(digest?.themes ?? []).flatMap((th) => th.ids)].flatMap((id) => { const it = getItem(id); return it ? [[id, it] as const] : []; }));
  const spoken = digest ? [digest.overview, ...digest.themes.map((th) => `${th.title}. ${th.summary}`), ...digest.picks.flatMap((p) => { const it = byId.get(p.id); return it ? [`${it.title}. ${p.why}`] : []; })].join("\n\n") : "";
  const labels: Record<NewsView, string> = { foryou: t("For you"), discover: `✨ ${t("Discover")}`, latest: prefs.funnel ? t("Everything (unfiltered)") : t("Latest"), saved: t("Saved"), filtered: t("Filtered out"), hidden: t("Hidden") };
  const count: Record<NewsView, number | null> = { foryou: c.unread, discover: c.discover, latest: null, saved: c.saved, filtered: c.filtered, hidden: c.hidden };
  const views = VIEWS.filter((v) => v !== "filtered" || prefs.funnel || c.filtered > 0);
  // The stories on top of For you: what is important and the stories running through what is for you.
  const stories = view === "foryou" && !sourceId && !category ? storyGroups(listItems({ view: "foryou", limit: 150, maxAgeDays: Math.min(prefs.maxAgeDays, 3) })) : [];
  const storyAgo = Object.fromEntries(stories.flatMap((g) => g.items).map((i) => [i.id, formatAgo(i.publishedAt)]));
  const stats = funnelStats();
  const inToday = cameInToday() ?? stats.fetched;
  const now = funnelNow();
  const llm = isInstalled("llm");
  const taste = view === "discover" ? getTaste() : null;
  const href = (v: NewsView, s?: number, c?: string) => `/news?view=${v}${s ? `&source=${s}` : ""}${c ? `&category=${encodeURIComponent(c)}` : ""}`;
  // The enabled sources by category (a few hundred sources are too many to list one by one).
  const byCategory = new Map<string, number>();
  for (const s of sources.filter((x) => x.enabled)) byCategory.set(s.category || "Your own", (byCategory.get(s.category || "Your own") ?? 0) + 1);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("News")}</h1>
        <nav className="space-y-1 text-sm">
          {views.map((v) => (
            <Link key={v} href={href(v)} className={`flex justify-between rounded px-2 py-1 ${v === view && !sourceId && !category ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
              <span>{labels[v]}</span>
              {count[v] ? <span className="tabular-nums">{count[v]}</span> : null}
            </Link>
          ))}
        </nav>
        <NewsRefreshButtons digest={prefs.digest} />
        {byCategory.size > 0 && (
          <div className="space-y-1 text-sm">
            <p className="text-xs font-semibold text-zinc-500 uppercase">{t("Categories")}</p>
            {[...byCategory].map(([cat, n]) => (
              <Link
                key={cat}
                href={href(view === "foryou" ? "latest" : view, undefined, cat === "Your own" ? "" : cat)}
                className={`flex justify-between rounded px-2 py-1 ${cat === category ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
              >
                <span className="truncate">{cat}</span>
                <span className="tabular-nums">{n}</span>
              </Link>
            ))}
            {(category || sourceId) && (
              <Link href={href(view)} className="block px-2 py-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {t("Show everything")}
              </Link>
            )}
          </div>
        )}
        <DiscoverButton />
        <Link href="/settings/news" className="btn btn-sm w-full text-center">
          {t("News settings")}
        </Link>
      </div>

      <div className="space-y-3">
        {view === "foryou" && !sourceId && !category && (
          <section className="card flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300" aria-label={t("Funnel")}>
            {prefs.funnel ? (
              <>
                <span className="font-semibold text-zinc-500 uppercase">{t("Today")}</span>
                <span title={t("Headlines fetched from your sources today")}>📥 {t("{n} in", { n: inToday })}</span>
                <span className="text-zinc-400">·</span>
                <span title={t("The best by score that the agent read")}>🔎 {t("{n} read by the agent", { n: stats.judged })}</span>
                <span className="text-zinc-400">·</span>
                <span title={t("Removed by the clearing, read or not: only the newest and the best are kept, besides what you saved or liked")}>🧹 {t("{n} cleared away", { n: stats.cleared })}</span>
                <span className="basis-full" aria-hidden="true" />
                <span className="font-semibold text-zinc-500 uppercase">{t("Now")}</span>
                <span title={t("Only the newest and the best are kept, besides what you saved or liked")}>🧹 {t("{n} kept", { n: now.kept })}</span>
                <span className="text-zinc-400">=</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400" title={t("Let through to For you")}>✓ {t("{n} for you", { n: now.forYou })}</span>
                {now.important > 0 && <span className="font-semibold text-amber-600 dark:text-amber-400">{t("({n} important)", { n: now.important })}</span>}
                <span className="text-zinc-400">+</span>
                <span>{t("{n} waiting for the agent", { n: now.waiting })}</span>
                <span className="text-zinc-400">+</span>
                <Link href={href("filtered")} className="text-zinc-500 hover:underline">⊘ {t("{n} filtered out", { n: now.filtered })}</Link>
                <span className="text-zinc-400">+</span>
                <span title={t("What you have seen already, or what the agent didn't read before you saw it")}>{t("{n} seen", { n: now.rest })}</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-zinc-500 uppercase">{t("Today")}</span>
                <span title={t("Headlines fetched from your sources today")}>📥 {t("{n} in", { n: inToday })}</span>
                <span className="text-zinc-400">→</span>
                <span>{t("scored for you")}</span>
                <span className="text-zinc-400">·</span>
                <span title={t("Only the newest and the best are kept, besides what you saved or liked")}>🧹 {t("{n} kept", { n: now.kept })}</span>
              </>
            )}
            <span className="flex-1" />
            {prefs.funnel ? (
              <>
                <FunnelButton />
              </>
            ) : (
              <Link href="/settings/news#funnel" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" title={llm ? t("An agent reads the news first and lets only what interests you through") : t("Needs the LLM plugin (Menu → Plugins).")}>
                {t("Filter with an agent …")}
              </Link>
            )}
          </section>
        )}
        {stories.length > 0 && <NewsStories groups={stories} ago={storyAgo} showImages={prefs.images} />}
        {taste && (
          <section className="card space-y-1.5 border-violet-200 bg-violet-50 p-4 text-sm dark:border-violet-900 dark:bg-violet-950/40">
            <h2 className="text-xs font-semibold text-violet-700 uppercase dark:text-violet-300">✨ {t("Your taste")}</h2>
            {taste.text ? <p className="leading-relaxed">{taste.text}</p> : <p className="text-zinc-500">{t("Nothing written yet — like or save a few articles, then press Discover.")}</p>}
            <p className="text-xs text-zinc-500">
              {t("Written by Zeff from what you like and save.")}{" "}
              <Link href="/settings/news#taste" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {t("Read and edit it")}
              </Link>
              {taste.pending.length > 0 && ` · ${t("{n} signals waiting to be taken in", { n: taste.pending.length })}`}
            </p>
          </section>
        )}
        {isInstalled("llm") && <AskNews />}
        {digest && (
          <section className="card space-y-2 border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
            <h2 className="text-xs font-semibold text-indigo-700 uppercase dark:text-indigo-300">
              {t("Overview")} · {formatAgo(digest.at)} <span className="ml-2 normal-case"><ListenButton text={spoken} lang={prefs.language === "en" ? "en" : "de"} label={t("Listen to the briefing")} /></span>
            </h2>
            <p>{digest.overview}</p>
            {digest.themes.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {digest.themes.map((th) => (
                  <div key={th.title} className="rounded-lg bg-white/70 p-3 dark:bg-zinc-900/60">
                    <p className="font-medium">{th.title}</p>
                    <p className="text-zinc-700 dark:text-zinc-300">{th.summary}</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {th.ids.map((id, k) => {
                        const it = byId.get(id);
                        return it ? (
                          <a key={id} href={it.url} target="_blank" rel="noreferrer noopener" title={`${it.sourceName}: ${it.title}`} className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-800 hover:underline dark:bg-indigo-950 dark:text-indigo-200">
                            [{k + 1}] {it.sourceName}
                          </a>
                        ) : null;
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <ul className="list-disc space-y-0.5 pl-5">
              {digest.picks.map((p) => {
                const it = byId.get(p.id);
                return it ? (
                  <li key={p.id}>
                    <a href={it.url} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">
                      {it.title}
                    </a>
                    <span className="text-zinc-600 dark:text-zinc-300"> — {p.why}</span>
                  </li>
                ) : null;
              })}
            </ul>
          </section>
        )}

        {items.length === 0 && view !== "discover" ? (
          <div className="card space-y-2 p-6 text-sm text-zinc-500">
            {sources.length === 0 && prefs.interests.length === 0 ? (
              <NewsFetching starter>
                <span className="mt-2 block">
                  {t("Nothing here yet. Pick some sources and say what interests you under")}{" "}
                  <Link href="/settings/news" className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {t("News settings")}
                  </Link>
                  .
                </span>
              </NewsFetching>
            ) : view === "foryou" && prefs.funnel ? (
              <div className="space-y-2">
                <p>{c.waiting > 0 ? t("The agent hasn't let anything through yet — {n} headlines are waiting for it.", { n: c.waiting }) : t("Nothing new for you right now — the agent looks again after the next fetch.")}</p>
                <div className="flex flex-wrap gap-2">
                  <FunnelButton />
                  <Link href={href("latest")} className="btn btn-sm">
                    {t("See everything unfiltered")}
                  </Link>
                </div>
              </div>
            ) : view === "foryou" || view === "latest" ? (
              <NewsFetching starter={false}>
                <span className="mt-2 block">{t("No news in the last {n} days — click Refresh.", { n: prefs.maxAgeDays })}</span>
              </NewsFetching>
            ) : (
              <p>{t("Nothing here.")}</p>
            )}
          </div>
        ) : (
          <NewsFeed key={`${view}:${sourceId ?? 0}:${category}`} initial={items} ago={Object.fromEntries(items.map((i) => [i.id, formatAgo(i.publishedAt)]))} view={view} sourceId={sourceId ?? null} category={category} showImages={prefs.images} done={items.length < NEWS_PAGE} />
        )}
      </div>
    </div>
  );
}
