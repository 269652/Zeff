"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";

type Toast = { id: number; text: string; tone: "ok" | "error"; action?: { label: string; run: () => unknown } };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const dismiss = (id: number) => {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};
/** A toast's time to go starts (again): not while the pointer or the focus is on it (WCAG 2.2.1). */
const arm = (id: number, ms: number) => {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => dismiss(id), ms));
};
const hold = (id: number) => {
  clearTimeout(timers.get(id));
  timers.delete(id);
};

/**
 * A short message at the bottom of the window — "T-12 erledigt" — with an action to take it
 * back (Undo), gone after a few seconds (or with ×); it stays while the pointer or the focus is on
 * it, and an error stays until it is closed (`ms` gives it a time anyway). From anywhere in the page.
 */
export function toast(text: string, opts: { tone?: Toast["tone"]; action?: Toast["action"]; ms?: number } = {}): void {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, text, tone: opts.tone ?? "ok", action: opts.action }];
  emit();
  const tone = opts.tone ?? "ok";
  if (opts.ms !== undefined || tone === "ok") arm(id, opts.ms ?? 8000);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const NONE: Toast[] = [];

/** Where the toasts show (once, in the layout). */
export function Toaster() {
  const t = useT();
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => NONE,
  );
  return (
    // On a phone: above the tab bar, small (two lines each; the newest three) — the page stays in sight.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-3 sm:bottom-4 sm:px-4" aria-live="polite" role="status">
      {list.map((item, i) => (
        // (On a phone only the newest three; the others come when those go.)
        <div
          key={item.id}
          // An error is said at once (it interrupts); the others wait their turn (the polite region around).
          role={item.tone === "error" ? "alert" : undefined}
          onMouseEnter={() => hold(item.id)}
          onMouseLeave={() => item.tone === "ok" && arm(item.id, 4000)}
          onFocus={() => hold(item.id)}
          onBlur={() => item.tone === "ok" && arm(item.id, 4000)}
          className={`pointer-events-auto flex max-w-full flex-col gap-1 rounded-lg px-3 py-2 text-[13px] leading-snug shadow-lg sm:px-4 sm:py-2.5 sm:text-sm ${i < list.length - 3 ? "max-sm:hidden" : ""} ${
            item.tone === "error" ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          }`}
        >
          {/* The text and its ×; the action in a row of its own below. */}
          <div className="flex items-start gap-2 sm:gap-3">
            <span className="line-clamp-2 min-w-0 flex-1 sm:line-clamp-none" title={item.text}>
              {item.text}
            </span>
            <button type="button" className={`shrink-0 rounded px-2 py-0.5 ${item.tone === "error" ? "text-red-50 hover:text-white" : "text-zinc-300 hover:text-white dark:text-zinc-600 dark:hover:text-zinc-900"}`} onClick={() => dismiss(item.id)} aria-label={t("Close")}>
              ×
            </button>
          </div>
          {item.action && (
            <div className="flex">
              <button
                type="button"
                className={`-ml-2 rounded px-2 py-0.5 font-semibold ${item.tone === "error" ? "text-white underline hover:bg-white/10" : "text-indigo-300 hover:bg-white/10 dark:text-indigo-700 dark:hover:bg-black/10"}`}
                onClick={() => {
                  dismiss(item.id);
                  item.action!.run();
                }}
              >
                {item.action.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
