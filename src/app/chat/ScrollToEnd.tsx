"use client";

import { useEffect } from "react";

/**
 * A chat opens at its end, as a messenger does — and stays there while answers come in, as long as you were at the end
 * (scrolled up to read, it leaves you where you are). `target`: the id of the element that scrolls (the conversation).
 * `page`: the conversation doesn't scroll itself — the page does (the lesson inside the Workspace): the nearest scrolling
 * ancestor (or the window) is followed instead.
 */
const scrollerOf = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  return null;
};

export function ScrollToEnd({ target, page = false }: { target: string; page?: boolean }) {
  useEffect(() => {
    const box = document.getElementById(target);
    if (!box) return;
    const sc = page ? scrollerOf(box) : box;
    const doc = document.scrollingElement as HTMLElement | null;
    const view = sc ?? doc;
    if (!view) return;
    const toEnd = () => (page && !sc ? window.scrollTo({ top: doc?.scrollHeight ?? 0 }) : view.scrollTo({ top: view.scrollHeight }));
    const atEnd = () => view.clientHeight + view.scrollTop >= view.scrollHeight - 160;
    toEnd();
    let follow = true;
    const onScroll = () => (follow = atEnd());
    const grow = new ResizeObserver(() => follow && toEnd());
    if (page) grow.observe(box);
    for (const child of box.children) grow.observe(child);
    const events: EventTarget = page && !sc ? window : view;
    events.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      grow.disconnect();
      events.removeEventListener("scroll", onScroll);
    };
  }, [target, page]);
  return null;
}
