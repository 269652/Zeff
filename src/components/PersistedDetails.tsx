"use client";

import { useEffect, useRef, type ReactNode } from "react";

const read = (key: string): boolean | null => {
  try {
    const v = window.localStorage.getItem(`zeff:open:${key}`);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
};
const write = (key: string, open: boolean) => {
  try {
    window.localStorage.setItem(`zeff:open:${key}`, open ? "1" : "0");
  } catch {
    // no storage (private window): it just isn't remembered
  }
};

/**
 * A fold-out that remembers whether it's open (in this browser, over reloads) — closed until
 * opened unless `defaultOpen`. A link to something inside it (#todo-12) opens it.
 */
export function PersistedDetails({ storageKey, defaultOpen = false, summary, className = "", summaryClassName = "", children }: { storageKey: string; defaultOpen?: boolean; summary: ReactNode; className?: string; summaryClassName?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // After mounting (the server doesn't know the browser's choice): the remembered state — or open for a link into it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const linkedInto = () => {
      const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
      if (!target || !el.contains(target)) return false;
      el.open = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
      return true;
    };
    if (!linkedInto()) {
      const remembered = read(storageKey);
      if (remembered !== null) el.open = remembered;
    }
    window.addEventListener("hashchange", linkedInto);
    return () => window.removeEventListener("hashchange", linkedInto);
  }, [storageKey]);
  return (
    <details ref={ref} open={defaultOpen || undefined} className={className} onToggle={(e) => write(storageKey, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={`cursor-pointer ${summaryClassName}`}>{summary}</summary>
      {children}
    </details>
  );
}
