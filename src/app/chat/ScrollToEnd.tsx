"use client";

import { useEffect } from "react";

/**
 * A chat opens at its end, as a messenger does — and stays there while answers come in, as long as you were at the end
 * (scrolled up to read, it leaves you where you are). `target`: the id of the element that scrolls (the conversation).
 */
export function ScrollToEnd({ target }: { target: string }) {
  useEffect(() => {
    const box = document.getElementById(target);
    if (!box) return;
    const toEnd = () => box.scrollTo({ top: box.scrollHeight });
    const atEnd = () => box.clientHeight + box.scrollTop >= box.scrollHeight - 120;
    toEnd();
    let follow = true;
    const onScroll = () => (follow = atEnd());
    const grow = new ResizeObserver(() => follow && toEnd());
    for (const child of box.children) grow.observe(child);
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      grow.disconnect();
      box.removeEventListener("scroll", onScroll);
    };
  }, [target]);
  return null;
}
