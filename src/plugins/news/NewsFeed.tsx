"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** About how tall a card is (to put the next one in the shortest column). */
const height = (i: NewsItem, image: boolean) => 150 + (image && i.image ? 190 : 0) + Math.min(80, i.summary.length / 3) + i.title.length / 2;

/**
 * The news as a masonry (cards in columns, each in the shortest) that loads more as you scroll, with a
 * button back to the top. Cards update in place when you vote, save or hide; the first page comes from the server.
 */
export function NewsFeed({ initial, ago: initialAgo, view, sourceId, showImages, done: initialDone }: { initial: NewsItem[]; ago: Record<number, string>; view: NewsView; sourceId: number | null; showImages: boolean; done: boolean }) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [ago, setAgo] = useState(initialAgo);
  const [done, setDone] = useState(initialDone);
  const [loading, setLoading] = useState(false);
  const [cols, setCols] = useState(2);
  const [top, setTop] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const offset = useRef(initial.length);
  const scroller = useRef<HTMLElement | null>(null);

  // Columns by the width: 1 narrow, 2 medium, 3 wide.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setCols(el.clientWidth < 640 ? 1 : el.clientWidth < 1100 ? 2 : 3);
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
      const r = await newsMoreAction(view, sourceId, offset.current);
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
  }, [view, sourceId, done]);

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

  const patch = (id: number, p: Partial<NewsItem>) =>
    setItems((cur) => cur.flatMap((i) => (i.id !== id ? [i] : view !== "hidden" && p.state === "hidden" ? [] : view === "saved" && p.state && p.state !== "saved" ? [] : [{ ...i, ...p }])));

  return (
    <div ref={box} className="space-y-4">
      <div className="flex items-start gap-3">
        {columns.map((col, k) => (
          <div key={k} className="min-w-0 flex-1 space-y-3">
            {col.map((it) => (
              <NewsCard key={it.id} item={it} ago={ago[it.id] ?? ""} showImage={showImages} onChange={(p) => patch(it.id, p)} />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="py-4 text-center text-xs text-zinc-500">
        {loading ? t("Loading more …") : done ? (items.length ? t("That's all for now.") : "") : <button type="button" className="btn btn-sm" onClick={() => void more()}>{t("Load more")}</button>}
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
