"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";
import { NewsCard } from "./NewsCard";
import { newsMoreAction } from "./server-actions";
import type { NewsItem } from "./shared";
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

/** About how tall a card is (to put the next one in the shortest column). */
const height = (i: NewsItem, image: boolean) => 150 + (image && i.image ? 190 : 0) + Math.min(80, i.summary.length / 3) + i.title.length / 2;

/**
 * The news as a masonry (cards in columns, each in the shortest) that loads more as you scroll, with a
 * button back to the top. Cards update in place when you vote, save or hide; the first page comes from the server.
 */
export function NewsFeed({ initial, ago: initialAgo, view, sourceId, category, term = "", showImages, done: initialDone }: { initial: NewsItem[]; ago: Record<number, string>; view: NewsView; sourceId: number | null; category: string; term?: string; showImages: boolean; done: boolean }) {
  const t = useT();
  const [items, setItems] = useState(initial);
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

  const more = useCallback(async () => {
    if (busy.current || done) return;
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
    } catch {
      setDone(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [view, sourceId, category, term, done]);

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
      {fresh > 0 && (
        <button type="button" className="btn btn-primary btn-sm sticky top-2 z-30 mx-auto block shadow" onClick={() => window.location.reload()}>
          ↑ {t("{n} new — show", { n: fresh })}
        </button>
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
              <NewsCard key={it.id} item={it} ago={ago[it.id] ?? ""} showImage={showImages} onChange={(p) => patch(it.id, p)} onDrop={drop} />
            ))}
          </div>
          {wide && <FocusSide items={sides[1]} showImage={showImages} />}
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {columns.map((col, k) => (
            <div key={k} className="min-w-0 flex-1 space-y-3">
              {col.map((it) => (
                <NewsCard key={it.id} item={it} ago={ago[it.id] ?? ""} showImage={showImages} onChange={(p) => patch(it.id, p)} onDrop={drop} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={sentinel} className="py-4 text-center text-xs text-zinc-500">
        {loading ? t("Loading more …") : done ? (searchingFeeds ? t("You've seen it all — looking for new sources for you …") : items.length ? t("That's all for now.") : "") : <button type="button" className="btn btn-sm" onClick={() => void more()}>{t("Load more")}</button>}
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
