"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TONE, type OpTone } from "@/lib/todos/op-look";
import { useT } from "@/components/I18nProvider";

/**
 * The card an action is shown as on a todo (and an alternative way to do it): an icon in the colour of what it does, the title and a quiet
 * line under it, the button that runs it inside the card, and the small tools (edit, done, dismiss) that show on hover. What the action
 * carries (a draft, files) goes below as `children`.
 */
export function ActionCard({
  tone,
  icon,
  title,
  detail,
  action,
  tools,
  children,
}: {
  tone: OpTone;
  icon: string;
  title: ReactNode;
  /** The quiet line under the title. */
  detail?: ReactNode;
  /** The button that runs it. */
  action?: ReactNode;
  /** Small icon buttons, quiet until the card is hovered. */
  tools?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <span className={`group/op flex min-w-0 max-w-full flex-col gap-1.5 rounded-xl border border-l-4 border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 ${TONE[tone].bar}`}>
      <span className="flex items-start gap-2.5">
        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${TONE[tone].bubble}`} aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium break-words">{title}</span>
          {detail && <span className="mt-0.5 block text-xs break-words text-zinc-500 dark:text-zinc-400">{detail}</span>}
        </span>
        {tools && <span className="flex shrink-0 items-center gap-0.5 opacity-50 transition group-hover/op:opacity-100 focus-within:opacity-100">{tools}</span>}
      </span>
      {children}
      {action && <span className="flex justify-end">{action}</span>}
    </span>
  );
}

/** The quiet icon-button look the card's tools share. */
export const TOOL_BUTTON = "rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

// ---------------------------------------------------------------------------------------------------------------------
// Rows or a gallery: how a todo's action cards are laid out — kept in this browser, the same for every todo on the page.
// ---------------------------------------------------------------------------------------------------------------------

export type ActionLayout = "rows" | "grid";
const KEY = "zeff.actionLayout";
const EVENT = "zeff-action-layout";

export function useActionLayout(): [ActionLayout, (l: ActionLayout) => void] {
  const [layout, setLayout] = useState<ActionLayout>("rows");
  useEffect(() => {
    const read = () => {
      try {
        setLayout(localStorage.getItem(KEY) === "grid" ? "grid" : "rows");
      } catch {
        // (no storage: rows)
      }
    };
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const set = (l: ActionLayout) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // (not kept)
    }
    setLayout(l);
    window.dispatchEvent(new Event(EVENT));
  };
  return [layout, set];
}

/** The classes of the container the cards sit in. */
export const layoutClass = (l: ActionLayout) => (l === "grid" ? "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))] items-start" : "flex flex-col gap-1.5");

/** A small switch: the cards in rows, or as a gallery. */
export function ActionLayoutToggle() {
  const t = useT();
  const [layout, set] = useActionLayout();
  const btn = (l: ActionLayout, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={layout === l}
      title={label}
      aria-label={label}
      onClick={() => set(l)}
      className={`grid size-6 place-items-center rounded ${layout === l ? "bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-300" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`}
    >
      {icon}
    </button>
  );
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label={t("Layout of the actions")}>
      {btn(
        "rows",
        t("Actions as rows"),
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>,
      )}
      {btn(
        "grid",
        t("Actions as a gallery"),
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
        </svg>,
      )}
    </span>
  );
}
