import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { BubbleField } from "@/plugins/news/BubbleField";
import { exploreHome, exploreTopic, surpriseTerm } from "@/plugins/news/explore";
import { NewsFeed } from "@/plugins/news/NewsFeed";
import { NEWS_PAGE } from "@/plugins/news/shared";
import { getPrefs, listItems } from "@/plugins/news/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Explore — News") };
}

const MAX_PATH = 6;

/**
 * Explore: hop from thing to thing through the news. The home is a field of bubbles — what is rising, what is yours, what
 * is out there you haven't looked at; pick one and it becomes the middle, with what hangs together with it round it and
 * the news about it below. Every hop is a link (the trail you took is kept above, to step back), a headline's names lead
 * on from the feed as well, and "Surprise me" picks something from out there.
 */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ topic?: string; path?: string }> }) {
  await connection();
  if (!isInstalled("news")) return <PluginNotInstalled id="news" />;
  const sp = await searchParams;
  const topic = (sp.topic ?? "").trim().slice(0, 80);
  const trail = (sp.path ?? "").split("|").map((x) => x.trim()).filter(Boolean).slice(-MAX_PATH);
  const prefs = getPrefs();
  const hop = (term: string) => `/news/explore?${new URLSearchParams({ topic: term, path: [...trail, ...(topic ? [topic] : [])].slice(-MAX_PATH).join("|") })}`;

  if (!topic) {
    const home = exploreHome();
    const all = [...home.trending, ...home.yours, ...home.wild];
    const surprise = surpriseTerm(home);
    return (
      <div className="page">
        <div className="page-aside">
          <Link href="/news" className="text-sm text-zinc-500 hover:underline">
            ← {t("News")}
          </Link>
          <h1 className="text-lg font-semibold">🧭 {t("Explore")}</h1>
          <p className="text-sm text-zinc-500">{t("Hop from thing to thing through the news. Pick a bubble: it becomes the middle, and what hangs together with it appears around it.")}</p>
          <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
            <li><span className="mr-1.5 inline-block size-2.5 rounded-full bg-rose-400" />{t("rising now")}</li>
            <li><span className="mr-1.5 inline-block size-2.5 rounded-full bg-emerald-400" />{t("yours")}</li>
            <li><span className="mr-1.5 inline-block size-2.5 rounded-full bg-amber-400" />{t("out there")}</li>
          </ul>
          {surprise && (
            <Link href={hop(surprise)} className="btn btn-primary btn-sm w-full text-center">
              🎲 {t("Surprise me")}
            </Link>
          )}
        </div>
        <div className="space-y-3">
          {all.length === 0 ? (
            <div className="card p-6 text-sm text-zinc-500">{t("Not enough news fetched yet to draw a map — come back after the first fetch (News → Refresh).")}</div>
          ) : (
            <BubbleField center={{ label: t("Explore"), sub: t("{n} things", { n: all.length }) }} bubbles={all} href={hop} rings={3} />
          )}
        </div>
      </div>
    );
  }

  const field = exploreTopic(topic);
  const items = listItems({ view: "latest", term: topic, maxAgeDays: prefs.maxAgeDays, limit: NEWS_PAGE });
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/news/explore" className="text-sm text-zinc-500 hover:underline">
          ← {t("Explore")}
        </Link>
        <h1 className="text-lg font-semibold">{topic}</h1>
        <p className="text-sm text-zinc-500">{t("{n} stories name it in the last days.", { n: field.count })}</p>
        {trail.length > 0 && (
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-zinc-500 uppercase">{t("Your path")}</p>
            <ol className="space-y-0.5">
              {trail.map((p, i) => (
                <li key={`${p}${i}`}>
                  <Link href={`/news/explore?${new URLSearchParams({ topic: p, path: trail.slice(0, i).join("|") })}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {i + 1}. {p}
                  </Link>
                </li>
              ))}
              <li className="font-medium">{trail.length + 1}. {topic}</li>
            </ol>
          </div>
        )}
        {field.outlets.length > 0 && (
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-zinc-500 uppercase">{t("Covered most by")}</p>
            <ul className="text-zinc-600 dark:text-zinc-300">
              {field.outlets.map((o) => (
                <li key={o.name}>
                  {o.name} <span className="text-zinc-400">{o.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link href={`/news?${new URLSearchParams({ view: "latest" })}`} className="text-xs text-zinc-500 hover:underline">
          {t("Back to the feed")}
        </Link>
      </div>
      <div className="space-y-4">
        {field.related.length > 0 ? (
          <BubbleField center={{ label: topic, sub: t("{n} stories", { n: field.count }) }} bubbles={field.related} href={hop} />
        ) : (
          <div className="card p-4 text-sm text-zinc-500">{t("Nothing hangs together with this one in the recent news — here is what there is:")}</div>
        )}
        {items.length > 0 ? (
          <NewsFeed key={`explore:${topic}:${items[0]?.id}`} initial={items} ago={Object.fromEntries(items.map((i) => [i.id, formatAgo(i.publishedAt)]))} view="latest" sourceId={null} category="" term={topic} showImages={prefs.images} done={items.length < NEWS_PAGE} />
        ) : (
          <p className="text-sm text-zinc-500">{t("No stories about this in the kept news.")}</p>
        )}
      </div>
    </div>
  );
}
