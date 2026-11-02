"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePagePathname } from "@/lib/use-page-pathname";
import { Suspense, useEffect, useSyncExternalStore, type ReactNode } from "react";

// Where you last were under a tab ("/work?run=5") — kept in this browser.
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

type Props = { href: string; className: string; active: boolean; label: string; children: ReactNode };

function Remembered({ href, className, active, label, children }: Props) {
  const pathname = usePagePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  const last = useSyncExternalStore(subscribeLast, () => readLast(href), () => href);
  useEffect(() => {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) return;
    try {
      localStorage.setItem(lastKey(href), here);
      window.dispatchEvent(new Event(LAST_EVENT));
    } catch {
      // not kept
    }
  }, [pathname, here, href]);
  return (
    <Link href={last} className={className} aria-current={active ? "page" : undefined} title={last !== href ? `${label} — zuletzt geöffnet` : undefined}>
      {children}
    </Link>
  );
}

/**
 * A header tab that opens the page you were on last under it (Work: the session you had open),
 * not its start page. The plain tab until that's known.
 */
export function LastTabLink(props: Props) {
  return (
    <Suspense
      fallback={
        <Link href={props.href} className={props.className} aria-current={props.active ? "page" : undefined}>
          {props.children}
        </Link>
      }
    >
      <Remembered {...props} />
    </Suspense>
  );
}
