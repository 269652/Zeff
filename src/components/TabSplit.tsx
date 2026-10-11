"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { tabMenuAction } from "@/app/actions";
import type { TabMenuItem } from "@/plugins/tab-menus-shared";
import type { HeaderTab } from "./SiteHeader";
import { useT } from "@/components/I18nProvider";

// Where you last were under a tab ("/kanban/3", or "/kanban" itself) — kept in this browser.
const lastKey = (tab: string) => `zeff-tab-last:${tab}`;
const LAST_EVENT = "zeff-tab-last";
const subscribeLast = (cb: () => void) => {
  window.addEventListener(LAST_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LAST_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};
const readLast = (tab: string) => {
  try {
    return localStorage.getItem(lastKey(tab)) ?? tab;
  } catch {
    return tab;
  }
};

/**
 * A header tab as a split button: the tab itself, and beside it a dropdown its plugin fills
 * (Kanban: every board — open one directly). The entries load when it opens.
 */
export function TabSplit({ tab, current, pathname, className, active, children }: { tab: HeaderTab; current: boolean; pathname: string; className: string; active: boolean; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TabMenuItem[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }
  // The tab opens the page you were on last under it (a board, or the overview) — its settings aside.
  const last = useSyncExternalStore(subscribeLast, () => readLast(tab.href), () => tab.href);
  useEffect(() => {
    const under = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (!under || /\/settings(\/|$)/.test(pathname)) return;
    try {
      localStorage.setItem(lastKey(tab.href), pathname);
      window.dispatchEvent(new Event(LAST_EVENT));
    } catch {
      // not kept
    }
  }, [pathname, tab.href]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void tabMenuAction(tab.href).then((r) => live && setItems(r));
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      live = false;
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, tab.href]);

  return (
    <div ref={root} className="relative flex items-stretch">
      <Link href={last} className={className} aria-current={active ? "page" : undefined} title={last !== tab.href ? t("{tab} — last opened", { tab: tab.label }) : undefined}>
        {children}
      </Link>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("{tab}: more", { tab: tab.label })}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-md rounded-l-none border-l px-1.5 transition ${
          current
            ? "border-zinc-700 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900"
            : "border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        <svg viewBox="0 0 20 20" className={`size-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          {!items && <p className="px-3 py-2 text-sm text-zinc-500">{t("Loading…")}</p>}
          {items?.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">{t("Nothing here.")}</p>}
          {items?.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${pathname === i.href ? "font-medium" : ""}`}
            >
              {i.dot ? <span className={`size-2.5 shrink-0 rounded-full ${i.dot}`} aria-hidden /> : <span className="size-2.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              {i.hint && <span className="shrink-0 text-xs text-zinc-400">{i.hint}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
