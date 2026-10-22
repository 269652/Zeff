"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * The Workspace's tree on a phone: folded behind a "Pages" button while a page is open (the page comes first, not the whole
 * tree above it), open on the Workspace's start page; a page picked folds it again. On a wide screen it is the sidebar as ever.
 */
export function MobileAside({ children }: { children: ReactNode }) {
  const t = useT();
  const path = usePathname();
  const home = path === "/workspace";
  const [open, setOpen] = useState(home);
  // Another page opened: the tree folds (the start page: it opens).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the address
  useEffect(() => setOpen(home), [path, home]);
  return (
    <>
      {!home && (
        <button type="button" className="btn btn-sm mb-2 w-full justify-between lg:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>☰ {t("Pages")}</span>
          <span aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
      )}
      <div className={open ? "" : "max-lg:hidden"}>{children}</div>
    </>
  );
}
