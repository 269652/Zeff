"use client";

import { usePagePathname } from "@/lib/use-page-pathname";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";

const pageBars = () => (typeof window === "undefined" ? 0 : ((window as { __wsPageBars?: number }).__wsPageBars ?? 0));

/**
 * The Workspace's tree on a phone: folded behind a "Pages" button while a page is open (the page comes first, not the whole
 * tree above it), open on the Workspace's start page; a page picked folds it again. On a wide screen it is the sidebar as ever.
 * A page's bar has a ☰ of its own ("ws:pages" toggles the tree): then this full-width button stands back, a row less.
 */
export function MobileAside({ children }: { children: ReactNode }) {
  const t = useT();
  const path = usePagePathname();
  const home = path === "/workspace";
  const [open, setOpen] = useState(home);
  const [bar, setBar] = useState(0);
  // Another page opened: the tree folds (the start page: it opens).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the address
  useEffect(() => setOpen(home), [path, home]);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const count = () => setBar(pageBars());
    count();
    window.addEventListener("ws:pages", toggle);
    window.addEventListener("ws:pagebar", count);
    return () => {
      window.removeEventListener("ws:pages", toggle);
      window.removeEventListener("ws:pagebar", count);
    };
  }, []);
  return (
    <>
      {!home && !bar && (
        <button type="button" className="btn btn-sm mb-2 w-full justify-between lg:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>☰ {t("Pages")}</span>
          <span aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
      )}
      {/* (Folded with nothing of it shown: the page below needs no gap for it — globals.css.) */}
      <div className={open ? "" : "max-lg:hidden"} data-aside-folded={!open && (home || !!bar) ? "" : undefined}>
        {children}
      </div>
    </>
  );
}
