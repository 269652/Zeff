"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * Full screen for an app (a database, a board): the app's header and the page's sidebar go, the page has the whole
 * window. Kept in this browser; Escape (or the button again) brings them back. The CSS is html[data-focus] in globals.css.
 */

const KEY = "zeff-focus";
const listeners = new Set<() => void>();
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const set = (on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: only for now
  }
  document.documentElement.toggleAttribute("data-focus", on);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export function FocusToggle() {
  const t = useT();
  const on = useSyncExternalStore(subscribe, read, () => false);
  // The page as it was left (full screen or not), and Escape to leave it.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-focus", on);
    if (!on) return;
    // (Not while a modal is open — on screen: the menu drawer is always there, moved out of view — Escape is its.)
    const modalOpen = () =>
      [...document.querySelectorAll('[aria-modal="true"]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
      });
    const key = (e: KeyboardEvent) => e.key === "Escape" && !modalOpen() && set(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [on]);
  useEffect(() => () => document.documentElement.removeAttribute("data-focus"), []);
  return (
    <button type="button" className="btn btn-sm" aria-pressed={on} onClick={() => set(!on)} title={on ? t("Leave full screen (Esc)") : t("Full screen")}>
      {on ? "⤡" : "⤢"}
    </button>
  );
}
