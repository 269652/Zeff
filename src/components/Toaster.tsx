"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";

type Toast = { id: number; text: string; tone: "ok" | "error"; action?: { label: string; run: () => unknown } };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

/**
 * A short message at the bottom of the window — "T-12 erledigt" — with an action to take it
 * back (Undo), gone after a few seconds (or with ×). From anywhere in the page.
 */
export function toast(text: string, opts: { tone?: Toast["tone"]; action?: Toast["action"]; ms?: number } = {}): void {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, text, tone: opts.tone ?? "ok", action: opts.action }];
  emit();
  setTimeout(() => dismiss(id), opts.ms ?? 8000);
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
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
      {list.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto flex max-w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg ${
            item.tone === "error" ? "bg-red-700 text-white" : "bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          }`}
        >
          <span className="min-w-0">{item.text}</span>
          {item.action && (
            <button
              type="button"
              className="shrink-0 rounded px-2 py-0.5 font-semibold text-indigo-300 hover:bg-white/10 dark:text-indigo-700 dark:hover:bg-black/10"
              onClick={() => {
                dismiss(item.id);
                item.action!.run();
              }}
            >
              {item.action.label}
            </button>
          )}
          <button type="button" className="shrink-0 rounded px-1 text-zinc-400 hover:text-zinc-200 dark:hover:text-zinc-700" onClick={() => dismiss(item.id)} aria-label={t("Close")}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
