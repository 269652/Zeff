"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { Cited, type Source } from "./AskNews";
import { MagicStage, type Box } from "./MagicStage";
import { NewsCard } from "./NewsCard";
import { discoverStatusAction, newsMoreAction, newsRelatedAction, newsSoFarAction, startDiscoverAction } from "./server-actions";
import { followSplit, type NewsItem } from "./shared";
import type { NewsView } from "./store";

/** The element that scrolls the page (the window may not: the app scrolls inside its own container). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Focus mode is a preference of this browser (kept in localStorage, which may be blocked: then it just isn't kept). */
const FOCUS_KEY = "zeff-news-focus";
const FOCUS_EVENT = "zeff-news-focus";
const subscribeFocus = (cb: () => void) => {
  window.addEventListener(FOCUS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FOCUS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};
const readFocus = () => {
  try {
    return localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    return false;
  }
};
const setFocus = (on: boolean) => {
  try {
    localStorage.setItem(FOCUS_KEY, on ? "1" : "0");
  } catch {
    // not kept, then
  }
  window.dispatchEvent(new Event(FOCUS_EVENT));
};

/** A blurred stand-in for a card in the side columns of focus mode: its picture and headline, nothing to click. */
function Ghost({ item, showImage }: { item: NewsItem; showImage: boolean }) {
  return (
    <div className="card overflow-hidden">
      {showImage && item.image && (
        // eslint-disable-next-line @next/next/no-img-element -- a blurred stand-in of the same picture
        <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-full object-cover" />
      )}
      <div className="space-y-1 p-3">
        <p className="line-clamp-3 text-sm font-medium">{item.title}</p>
        <p className="text-xs text-zinc-500">{item.sourceName}</p>
      </div>
    </div>
  );
}

/** A card of the feed; one that came in by following a topic says which. */
type FItem = NewsItem & { fromTopic?: string };

/** About how tall a card is (to put the next one in the shortest column). */
const height = (i: FItem, image: boolean) => 150 + (image && i.image ? 190 : 0) + Math.min(80, i.summary.length / 3) + i.title.length / 2;

/**
 * The news as a masonry (cards in columns, each in the shortest) that loads more as you scroll, with a
 * button back to the top. Cards update in place when you vote, save or hide; the first page comes from the server.
 */
export function NewsFeed({ initial, ago: initialAgo, view, sourceId, category, term = "", showImages, done: initialDone }: { initial: NewsItem[]; ago: Record<number, string>; view: NewsView; sourceId: number | null; category: string; term?: string; showImages: boolean; done: boolean }) {
  const t = useT();
  const [items, setItems] = useState<FItem[]>(initial);
  // Following a topic from a card's chip: the topic's news come in right below that card and go on loading as you scroll, until you
  // pick another chip, stop, or the topic runs out — then the feed carries on where it was (what was below the card waits in `stash`).
  const stash = useRef<FItem[]>([]);
  const topicRef = useRef<{ term: string; offset: number; done: boolean } | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  // The dive panel: the trail of what was followed, what hangs together with the current topic (hop to it, in place), the stories
  // that run through it (follow a thread), and "the story so far".
  const anchor = useRef<number | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [dive, setDive] = useState<{ related: { term: string; count: number; weight: number }[]; stories: { label: string; count: number }[] } | null>(null);
  const [sofar, setSofar] = useState<{ busy: boolean; answer?: string; sources?: Source[]; error?: string } | null>(null);
  // "More like this": what the AI made of the article (why it is for you, the searches) while the finds come in below the card.
  const [stage, setStage] = useState<{ item: NewsItem; from: Box; done: boolean } | null>(null);
  const endStage = useCallback(() => setStage(null), []);
  const [like, setLike] = useState<{ title: string; busy: boolean; angle?: string; queries?: { q: string; why: string }[]; usedAi?: boolean; sourcesAdded?: number } | null>(null);
  const [ago, setAgo] = useState(initialAgo);
  const [done, setDone] = useState(initialDone);
  const [loading, setLoading] = useState(false);
  const [searchingFeeds, setSearchingFeeds] = useState(false);
  const [cols, setCols] = useState(2);
  const [top, setTop] = useState(false);
  const [wide, setWide] = useState(true);
  const focus = useSyncExternalStore(subscribeFocus, readFocus, () => false);
  const box = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const offset = useRef(initial.length);
  const pagesRead = useRef(0);
  // Discover's Refresh: the job runs in the background; what it finds is poured in at the top while it goes.
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const pour = useCallback(async () => {
    const r = await newsMoreAction("discover", null, "", 0);
    setAgo((cur) => ({ ...cur, ...r.ago }));
    let added = 0;
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.id));
      const fresh = r.items.filter((i) => !have.has(i.id));
      added = fresh.length;
      return fresh.length ? [...fresh, ...cur] : cur;
    });
    return added;
  }, []);
  const refreshDiscover = async () => {
    const started = await startDiscoverAction();
    if (!started.ok) return void toast(started.error ?? t("Didn't work."), { tone: "error" });
    setRefreshing(t("Starting …"));
    let seen = -1;
    for (let round = 0; round < 400; round++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      const st = await discoverStatusAction().catch(() => null);
      if (!st) continue;
      if (st.matched !== seen) {
        seen = st.matched;
        await pour().catch(() => undefined);
      }
      if (!st.running) {
        await pour().catch(() => undefined);
        setRefreshing(null);
        toast(st.message || t("Done."));
        return;
      }
      setRefreshing(st.phase || t("Discovering …"));
    }
    setRefreshing(null);
  };
  const scroller = useRef<HTMLElement | null>(null);

  // Columns by the width.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Three columns, fewer only where it gets too narrow (a column wants about 240 px).
    const fit = () => {
      setWide(el.clientWidth >= 900);
      setCols(Math.max(1, Math.min(3, Math.floor((el.clientWidth + 12) / 252))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The feed carries on where it was: what waited below the card comes back. */
  const restoreStash = useCallback(() => {
    const waiting = stash.current;
    stash.current = [];
    topicRef.current = null;
    setTopic(null);
    setTrail([]);
    setDive(null);
    setSofar(null);
    setLike(null);
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.id));
      return [...cur, ...waiting.filter((i) => !have.has(i.id))];
    });
  }, []);

  /** A page of a topic's news (newest, the unseen first), appended — and when it ends, the feed carries on. */
  const loadTopic = useCallback(async () => {
    const tp = topicRef.current;
    if (!tp) return;
    const r = await newsMoreAction("latest", null, "", tp.offset, tp.term);
    tp.offset += r.items.length;
    tp.done = r.done;
    setAgo((cur) => ({ ...cur, ...r.ago }));
    setItems((cur) => {
      const have = new Set([...cur, ...stash.current].map((i) => i.id));
      return [...cur, ...r.items.filter((i) => !have.has(i.id)).map((i) => ({ ...i, fromTopic: tp.term }))];
    });
    if (r.done) restoreStash();
  }, [restoreStash]);

  /** A chip was clicked on a card: the topic's news go in below that card (what was below waits), the feed stays where it is. */
  const follow = async (term: string, anchorId: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      // What was below the card in the main feed waits; a topic block that was there is dropped (another topic replaces it).
      const { base, rest } = followSplit(items, anchorId);
      stash.current = [...rest, ...stash.current];
      topicRef.current = { term, offset: 0, done: false };
      anchor.current = anchorId;
      setTopic(term);
      setTrail((cur) => (cur[cur.length - 1] === term ? cur : [...cur, term].slice(-6)));
      setSofar(null);
      void newsRelatedAction(term.replace(/^story:/, "")).then((r) => setDive({ related: r.related, stories: r.stories })).catch(() => setDive(null));
      setItems(base);
      await loadTopic();
    } catch {
      restoreStash();
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  /** "More like this" on a card: the article is read, the AI looks at what you like and know, the internet is searched — the finds open below the card. */
  const moreLike = async (it: NewsItem & { fromTopic?: string }) => {
    const itemId = it.id;
    const anchorId = it.id;
    const title = it.title;
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    // The card flies to the middle of the screen and sparkles until the finds are in (see MagicStage).
    const rect = document.getElementById(`news-card-${itemId}`)?.getBoundingClientRect();
    if (rect) setStage({ item: it, from: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, done: false });
    try {
      const { base, rest } = followSplit(items, anchorId);
      stash.current = [...rest, ...stash.current];
      topicRef.current = { term: `like:${itemId}`, offset: 0, done: false };
      anchor.current = anchorId;
      setTopic(`like:${itemId}`);
      setDive(null);
      setSofar(null);
      setLike({ title, busy: true });
      setItems(base);
      const res = await fetch("/api/news/similar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: itemId }) });
      const j = (await res.json()) as { ok: boolean; error?: string; angle?: string; queries?: { q: string; why: string }[]; usedAi?: boolean; sourcesAdded?: number; found?: number };
      if (!j.ok) {
        toast(j.error ?? t("Didn't work."), { tone: "error" });
        restoreStash();
        return;
      }
      setLike({ title, busy: false, angle: j.angle, queries: j.queries, usedAi: j.usedAi, sourcesAdded: j.sourcesAdded });
      await loadTopic();
    } catch {
      toast(t("Didn't work."), { tone: "error" });
      restoreStash();
    } finally {
      busy.current = false;
      setLoading(false);
      // The finds are in (or it failed): the card glides back.
      setStage((s) => (s ? { ...s, done: true } : s));
    }
  };

  const more = useCallback(async () => {
    if (busy.current) return;
    if (topicRef.current && !topicRef.current.done) {
      busy.current = true;
      setLoading(true);
      try {
        await loadTopic();
      } catch {
        restoreStash();
      } finally {
        busy.current = false;
        setLoading(false);
      }
      return;
    }
    if (done) return;
    busy.current = true;
    setLoading(true);
    try {
      const r = await newsMoreAction(view, sourceId, category, offset.current, term);
      offset.current += r.items.length;
      setItems((cur) => {
        const have = new Set(cur.map((i) => i.id));
        return [...cur, ...r.items.filter((i) => !have.has(i.id))];
      });
      setAgo((cur) => ({ ...cur, ...r.ago }));
      setDone(r.done);
      // While you scroll, Zeff searches on in the background (every third page; the server keeps its own pace) — "N new" says when there is more.
      if (view !== "discover" && ++pagesRead.current % 3 === 0) void fetch("/api/news/discover-bg", { method: "POST" }).catch(() => undefined);
    } catch {
      setDone(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [view, sourceId, category, term, done, loadTopic, restoreStash]);

  // Infinite scroll: the sentinel under the cards comes into view → the next page. Back to top: shown once scrolled down.
  useEffect(() => {
    const root = scrollParent(box.current);
    scroller.current = root;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void more(), { root, rootMargin: "800px 0px" });
    io.observe(el);
    const target: HTMLElement | Window = root ?? window;
    const onScroll = () => setTop((root ? root.scrollTop : window.scrollY) > 700);
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      target.removeEventListener("scroll", onScroll);
    };
  }, [more, items.length]);

  const columns = useMemo(() => {
    const out: NewsItem[][] = Array.from({ length: cols }, () => []);
    const h = new Array<number>(cols).fill(0);
    for (const it of items) {
      const k = h.indexOf(Math.min(...h));
      out[k].push(it);
      h[k] += height(it, showImages);
    }
    return out;
  }, [items, cols, showImages]);

  // Focus mode: Esc leaves it.
  useEffect(() => {
    if (!focus) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFocus(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [focus]);

  // The side columns of focus mode: the same news, shuffled (by a fixed order of their ids, so it doesn't jump on a render), half each side.
  const sides = useMemo(() => {
    const shuffled = [...items].sort((a, b) => ((a.id * 2654435761) >>> 0) % 997 - ((b.id * 2654435761) >>> 0) % 997);
    return [shuffled.filter((_, i) => i % 2 === 0).slice(0, 10), shuffled.filter((_, i) => i % 2 === 1).slice(0, 10)];
  }, [items]);

  // A card's feed was switched off: all its cards leave.
  const drop = (gone: (i: NewsItem) => boolean) => setItems((cur) => cur.filter((i) => !gone(i)));

  // New items arrive in the background (the sync runs by itself): an open page says how many, and shows them on a click.
  const loadedAt = useRef(new Date().toISOString());
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/news/new?since=${encodeURIComponent(loadedAt.current)}`);
        if (r.ok) setFresh(((await r.json()) as { count?: number }).count ?? 0);
      } catch {
        // offline: later
      }
    };
    const timer = setInterval(poll, 60_000);
    const first = setTimeout(poll, 5000);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, []);

  // The end of the feed: fresh news are running out — Zeff goes looking for new feeds (the sync fetches them, "N new" says when).
  const lowAsked = useRef(false);
  useEffect(() => {
    if (!done || lowAsked.current || term) return;
    lowAsked.current = true;
    void fetch("/api/news/low", { method: "POST" })
      .then((r) => r.json() as Promise<{ searching?: boolean }>)
      .then((j) => setSearchingFeeds(!!j.searching))
      .catch(() => undefined);
  }, [done, term]);

  const patch = (id: number, p: Partial<NewsItem>) =>
    setItems((cur) => cur.flatMap((i) => (i.id !== id ? [i] : view !== "hidden" && p.state === "hidden" ? [] : view === "saved" && p.state && p.state !== "saved" ? [] : [{ ...i, ...p }])));

  return (
    <div ref={box} className="space-y-4">
      {stage && <MagicStage item={stage.item} from={stage.from} done={stage.done} onGone={endStage} showImage={showImages} />}
      {fresh > 0 && view !== "discover" && (
        <button type="button" className="btn btn-primary btn-sm sticky top-2 z-30 mx-auto block shadow" onClick={() => window.location.reload()}>
          ↑ {t("{n} new — show", { n: fresh })}
        </button>
      )}
      {topic && (
        <div className="sticky top-2 z-30 mx-auto w-full max-w-3xl space-y-2 rounded-2xl border border-indigo-300 bg-indigo-50/95 px-4 py-2 text-xs text-indigo-900 shadow backdrop-blur dark:border-indigo-800 dark:bg-indigo-950/95 dark:text-indigo-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{topic.startsWith("like:") ? `✨ ${t("More like “{title}”", { title: (like?.title ?? "").slice(0, 50) })}` : topic.startsWith("story:") ? `🧵 ${topic.slice(6)}` : `🧭 ${t("Following “{topic}”", { topic })}`}</span>
            {trail.length > 1 && (
              <span className="flex flex-wrap items-center gap-1 text-indigo-700 dark:text-indigo-300">
                {trail.map((x, i) => (
                  <span key={`${x}${i}`} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden>›</span>}
                    {i === trail.length - 1 ? (
                      <span className="font-semibold">{x.replace(/^story:/, "🧵 ")}</span>
                    ) : (
                      <button type="button" className="hover:underline" onClick={() => void follow(x, anchor.current ?? items[0]?.id ?? 0)} title={t("Back to this step")}>
                        {x.replace(/^story:/, "🧵 ")}
                      </button>
                    )}
                  </span>
                ))}
              </span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              className="hover:underline"
              onClick={() => {
                if (topic.startsWith("like:")) return;
                setSofar({ busy: true });
                void newsSoFarAction(topic).then((r) => setSofar(r.ok ? { busy: false, answer: r.answer, sources: r.sources } : { busy: false, error: r.error }));
              }}
              title={t("The AI sums up what the fetched news say — chronologically, with sources")}
            >
              📖 {t("Story so far")}
            </button>
            <a href={`/news/explore?${new URLSearchParams({ topic: topic.replace(/^story:/, "") })}`} className="underline" title={t("Open it in Explore")}>
              {t("Explore")} ↗
            </a>
            <button type="button" className="font-semibold hover:underline" onClick={restoreStash} title={t("Back to the feed")}>
              ✕ {t("Stop")}
            </button>
          </div>
          {like && (
            <div className="space-y-1.5">
              {like.busy ? (
                <p className="text-indigo-700 dark:text-indigo-300">{t("Reading the article, thinking about what you like and know, searching the internet … (up to a minute)")}</p>
              ) : (
                <>
                  {like.angle && <p className="leading-relaxed">{like.angle}</p>}
                  {like.queries && like.queries.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1">
                      <span className="text-indigo-600 dark:text-indigo-300">{like.usedAi ? t("Searched") : t("Searched (the article's own terms)")}:</span>
                      {like.queries.map((x) => (
                        <button key={x.q} type="button" className="rounded-full border border-indigo-300 bg-white px-2 py-0.5 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900 dark:hover:bg-indigo-800" title={x.why} onClick={() => void follow(x.q, anchor.current ?? items[0]?.id ?? 0)}>
                          {x.q}
                        </button>
                      ))}
                    </p>
                  )}
                  {(like.sourcesAdded ?? 0) > 0 && <p className="text-indigo-600 dark:text-indigo-300">{t("{n} new sources found around this topic — their news come in with the next fetch.", { n: like.sourcesAdded })}</p>}
                </>
              )}
            </div>
          )}
          {dive && (dive.related.length > 0 || dive.stories.length > 0) && (
            <div className="space-y-1.5">
              {dive.stories.length > 0 && (
                <p className="flex flex-wrap items-center gap-1">
                  <span className="text-indigo-600 dark:text-indigo-300">{t("Threads")}:</span>
                  {dive.stories.map((st) => (
                    <button key={st.label} type="button" className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" onClick={() => void follow(`story:${st.label}`, anchor.current ?? items[0]?.id ?? 0)}>
                      🧵 {st.label} <span className="opacity-60">{st.count}</span>
                    </button>
                  ))}
                </p>
              )}
              {dive.related.length > 0 && (
                <p className="flex flex-wrap items-center gap-1">
                  <span className="text-indigo-600 dark:text-indigo-300">{t("Hops")}:</span>
                  {dive.related.map((b) => (
                    <button
                      key={b.term}
                      type="button"
                      className="rounded-full border border-indigo-300 bg-white px-2 py-0.5 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900 dark:hover:bg-indigo-800"
                      style={{ fontSize: `${0.68 + b.weight * 0.18}rem` }}
                      onClick={() => void follow(b.term, anchor.current ?? items[0]?.id ?? 0)}
                      title={t("{n} stories together", { n: b.count })}
                    >
                      {b.term}
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}
          {sofar && (
            <div className="rounded-lg bg-white/80 p-2 leading-relaxed dark:bg-zinc-900/70">
              {sofar.busy ? <span className="text-zinc-500">{t("Reading the news …")}</span> : sofar.error ? <span className="text-red-600 dark:text-red-400">{sofar.error}</span> : <Cited text={sofar.answer ?? ""} sources={sofar.sources ?? []} />}
            </div>
          )}
        </div>
      )}
      {view === "discover" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600" disabled={refreshing !== null} onClick={() => void refreshDiscover()} title={t("Searches the web and new sources for what you like, matches the unread news again and pours what it finds in at the top")}>
            ↻ {refreshing !== null ? t("Refreshing …") : t("Refresh")}
          </button>
          {refreshing !== null && <span className="text-xs text-zinc-500">{refreshing}</span>}
          {items.length === 0 && refreshing === null && <span className="text-xs text-zinc-500">{t("Nothing here yet — Refresh looks for what matches your taste.")}</span>}
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" className={`btn btn-sm ${focus ? "btn-primary" : ""}`} onClick={() => setFocus(!focus)} title={focus ? t("Back to the columns (Esc)") : t("One column to read, like a phone feed")} aria-pressed={focus}>
          {focus ? t("Leave focus") : t("Focus")}
        </button>
      </div>
      {focus ? (
        <div className={wide ? "grid grid-cols-[1fr_minmax(0,34rem)_1fr] items-start gap-10" : ""}>
          {wide && <FocusSide items={sides[0]} showImage={showImages} />}
          {/* The middle column holds all the news, a little bigger. */}
          <div className="space-y-4" style={{ zoom: 1.06 }}>
            {items.map((it) => (
              <NewsCard key={it.id} item={it} ago={ago[it.id] ?? ""} showImage={showImages} onChange={(p) => patch(it.id, p)} onDrop={drop} onFollow={(term) => void follow(term, it.id)} following={topic} onMoreLike={() => void moreLike(it)} />
            ))}
          </div>
          {wide && <FocusSide items={sides[1]} showImage={showImages} />}
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {columns.map((col, k) => (
            <div key={k} className="min-w-0 flex-1 space-y-3">
              {col.map((it) => (
                <NewsCard key={it.id} item={it} ago={ago[it.id] ?? ""} showImage={showImages} onChange={(p) => patch(it.id, p)} onDrop={drop} onFollow={(term) => void follow(term, it.id)} following={topic} onMoreLike={() => void moreLike(it)} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={sentinel} className="py-4 text-center text-xs text-zinc-500">
        {loading ? (topic ? t("Loading more about “{topic}” …", { topic }) : t("Loading more …")) : done && !topic ? (searchingFeeds ? t("You've seen it all — looking for new sources for you …") : items.length ? t("That's all for now.") : "") : <button type="button" className="btn btn-sm" onClick={() => void more()}>{t("Load more")}</button>}
      </div>
      {top && (
        <button
          type="button"
          className="btn btn-primary fixed right-6 bottom-6 z-40 rounded-full px-3 py-2 shadow-lg"
          aria-label={t("Back to top")}
          title={t("Back to top")}
          onClick={() => (scroller.current ?? window).scrollTo({ top: 0, behavior: "smooth" })}
        >
          ↑
        </button>
      )}
    </div>
  );
}

/** A side column of focus mode: blurred, smaller, out of the way — it stays in view (sticky) while the middle column scrolls. */
function FocusSide({ items, showImage }: { items: NewsItem[]; showImage: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none sticky top-2 max-h-[calc(100vh-6rem)] space-y-4 overflow-hidden opacity-60 select-none" style={{ filter: "blur(6px)", transform: "scale(0.94)" }}>
      {items.map((it) => (
        <Ghost key={it.id} item={it} showImage={showImage} />
      ))}
    </div>
  );
}
