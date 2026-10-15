"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { listWorkCommandsAction } from "@/plugins/ext/actions";
import { useT } from "../I18nProvider";

type Command = { id: string; plugin: string; label: string; description: string; template: string };

/**
 * The "/" menu of Work's message box: external plugins' commands (src/lib/ext). Typing "/" as
 * the first character opens a list above the box (typing on narrows it); ↑ ↓ choose, Enter or Tab
 * puts the command's text into the box, Esc closes. Only the text changes — nothing else of the
 * composer. Without any command (no plugin brings one) nothing shows.
 */
export function SlashCommands({ text, onPick, area }: { text: string; onPick: (template: string) => void; area: RefObject<HTMLTextAreaElement | null> }) {
  const t = useT();
  const [commands, setCommands] = useState<Command[] | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const asked = useRef(false);
  const query = /^\/(\S*)$/.exec(text)?.[1];

  useEffect(() => {
    if (query === undefined || asked.current) return;
    asked.current = true;
    void listWorkCommandsAction().then(setCommands, () => setCommands([]));
  }, [query]);

  const shown = useMemo(() => {
    if (query === undefined || !commands) return [];
    const q = query.toLowerCase();
    return commands.filter((c) => !q || `${c.label} ${c.id} ${c.description}`.toLowerCase().includes(q)).slice(0, 8);
  }, [commands, query]);
  const open = shown.length > 0 && dismissed !== text;
  const current = Math.min(index, Math.max(0, shown.length - 1));
  const pick = (template: string) => {
    onPick(template);
    area.current?.focus();
  };

  // The box's own Enter (send) must not fire while the list is open: caught first, on the box itself.
  useEffect(() => {
    const el = area.current;
    if (!el || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
      else if (e.key === "Enter" || e.key === "Tab") pick(shown[current].template);
      else if (e.key === "Escape") setDismissed(text);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick only wraps onPick and the box
  }, [area, open, shown, current, onPick, text]);

  if (!open) return null;
  return (
    <div className="relative h-0">
      <ul role="listbox" aria-label={t("Commands")} className="absolute bottom-1 left-2 z-20 max-h-72 w-[min(34rem,calc(100%-1rem))] overflow-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {shown.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === current}>
            <button
              type="button"
              className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${i === current ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                // (Not a blur of the box first.)
                e.preventDefault();
                pick(c.template);
              }}
            >
              <span className="font-medium">/{c.label}</span>
              {c.description && <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{c.description}</span>}
              <span className="ml-auto shrink-0 text-xs text-zinc-400">{c.plugin}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
