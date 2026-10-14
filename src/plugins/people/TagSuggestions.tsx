"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { suggestTagsAction } from "./server-actions";

/**
 * Under a note being written: who to tag (@) — the people linked to the todo's ticket and to what the note
 * is about (their roles, what they are responsible for). One click puts @Name in; those already tagged aren't offered.
 */
export function TagSuggestions({ todoId, text, onPick }: { todoId: number; text: string; onPick: (name: string) => void }) {
  const t = useT();
  const [found, setFound] = useState<{ id: number; name: string; why: string }[]>([]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      suggestTagsAction(todoId, text)
        .then((r) => live && setFound(r))
        .catch(() => live && setFound([]));
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [todoId, text]);
  if (!found.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
      {t("Tag?")}
      {found.map((p) => (
        <button key={p.id} type="button" className="rounded-full border border-teal-200 px-2 py-0.5 text-teal-800 hover:bg-teal-50 dark:border-teal-900 dark:text-teal-300 dark:hover:bg-teal-950" title={p.why} onClick={() => onPick(p.name)}>
          @{p.name}
        </button>
      ))}
    </span>
  );
}
