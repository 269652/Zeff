"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { AskNews } from "../AskNews";
import { DiscoverButton } from "../DiscoverButton";
import { FunnelButton } from "../FunnelButton";
import { ListenButton } from "../Listen";
import { NewsFeed } from "../NewsFeed";
import { NewsFetching, NewsRefreshButtons } from "../RefreshButton";
import { NewsStories } from "../Stories";
import { newsScreenAction, type NewsScreen } from "../view-actions";

/**
 * News' app view, client side: what its template reads as app.* (view-actions.ts — for the view, source and category in the view's state)
 * and News' own parts it is built of where the language's tags aren't enough.
 */

function useNewsData(_props: AppViewProps, state: Record<string, string>) {
  const key = [state.view ?? "", state.source ?? "", state.category ?? ""].join("|");
  const [got, setGot] = useState<{ key: string; data: NewsScreen } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    // (A click sets the view and resets the source and category one after another: asked once, for where it ends.)
    const timer = setTimeout(() => {
      const [view, source, category] = key.split("|");
      void newsScreenAction({ view, source, category }).then((data) => live && setGot({ key, data }));
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, tick]);
  // (What was loaded for another view stays out until its own arrives: the feed is never one of the view before.)
  return { data: got?.key === key ? (got.data as unknown as Record<string, unknown>) : {}, reload: useCallback(() => setTick((x) => x + 1), []) };
}

/** The screen's data as News' parts read it (null: not loaded yet). */
const screen = (p: PartProps): NewsScreen | null => (p.app.views ? (p.app as NewsScreen) : null);

function Feed(p: PartProps) {
  const s = screen(p);
  if (!s) return null;
  return <NewsFeed key={`${s.view}:${s.source}:${s.category}`} initial={s.items} ago={s.ago} view={s.view} sourceId={s.source || null} category={s.category} showImages={s.images} done={s.done} />;
}

function Stories(p: PartProps) {
  const s = screen(p);
  if (!s?.stories.length) return null;
  return <NewsStories groups={s.stories} ago={s.storyAgo} showImages={s.images} />;
}

function Refresh(p: PartProps) {
  const s = screen(p);
  return s ? <NewsRefreshButtons digest={s.digestOn} /> : null;
}

function Listen(p: PartProps) {
  const t = useT();
  const s = screen(p);
  if (!s?.overview) return null;
  return <ListenButton text={s.overview.spoken} lang={s.lang} label={t("Listen to the briefing")} />;
}

function Fetching(p: PartProps) {
  return <NewsFetching starter={p.attrs.starter === "true"} />;
}

const NEWS: ViewAppModule = {
  parts: {
    "news.feed": Feed,
    "news.stories": Stories,
    "news.refresh": Refresh,
    "news.discover": () => <DiscoverButton />,
    "news.funnel": () => <FunnelButton />,
    "news.ask": () => <AskNews />,
    "news.listen": Listen,
    "news.fetching": Fetching,
  },
  useAppData: useNewsData,
};
export default NEWS;
