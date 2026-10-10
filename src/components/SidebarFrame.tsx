"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

/**
 * A full-window page with a sidebar on the left (what the page is, its controls — folded away on
 * request, remembered per page kind) and its content on the right, the window's whole height
 * (the content scrolls in itself). Kanban boards, the Knowledge chat.
 */
export function SidebarFrame({ sidebar, children, back, storageKey, contentClassName = "" }: { sidebar: ReactNode; children: ReactNode; back?: { href: string; label: string }; storageKey: string; contentClassName?: string }) {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- as you left it, after hydration
      setFolded(localStorage.getItem(storageKey) === "1");
    } catch {
      // as it is
    }
  }, [storageKey]);
  const fold = (v: boolean) => {
    setFolded(v);
    try {
      localStorage.setItem(storageKey, v ? "1" : "0");
    } catch {
      // not kept
    }
  };
  return (
    <div className="flex gap-6 max-lg:flex-col lg:h-full">
      {folded ? (
        <button type="button" onClick={() => fold(false)} className="icon-btn shrink-0 self-start" title="Seitenleiste zeigen" aria-label="Seitenleiste zeigen">
          »
        </button>
      ) : (
        <aside className="w-full shrink-0 space-y-4 overflow-y-auto pr-1 pb-2 [scrollbar-width:thin] lg:w-72">
          <div className="flex items-center justify-between gap-2">
            {back ? (
              <Link href={back.href} className="text-sm text-zinc-500 hover:underline">
                ← {back.label}
              </Link>
            ) : (
              <span />
            )}
            <button type="button" onClick={() => fold(true)} className="icon-btn max-lg:hidden" title="Seitenleiste einklappen" aria-label="Seitenleiste einklappen">
              «
            </button>
          </div>
          {sidebar}
        </aside>
      )}
      <div className={`flex min-h-0 min-w-0 flex-1 ${contentClassName}`}>{children}</div>
    </div>
  );
}
