"use client";

import { useEffect } from "react";

/**
 * The element the address points at (/boards#todo-75) marked — an outline, the folded section
 * it's in opened, scrolled to — also after a navigation within the app or a live refresh (which
 * CSS :target doesn't see). A data attribute, so React's re-renders leave it be.
 */
export function HashHighlight() {
  useEffect(() => {
    let shown = "";
    const check = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (el?.hasAttribute("data-highlight")) return;
      for (const old of document.querySelectorAll("[data-highlight]")) old.removeAttribute("data-highlight");
      if (!el) return;
      el.setAttribute("data-highlight", "");
      for (let d = el.parentElement?.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
      // Scrolled to once per address (not again after a refresh while you read elsewhere).
      if (shown !== `${window.location.pathname}${window.location.search}#${id}`) {
        shown = `${window.location.pathname}${window.location.search}#${id}`;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    check();
    const timer = window.setInterval(check, 400);
    window.addEventListener("hashchange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("hashchange", check);
    };
  }, []);
  return null;
}
