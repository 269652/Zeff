"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useComboboxKeys } from "@/components/Combobox";

type TodoOption = { id: number; ref: string; text: string };

/**
 * A todo to pick by typing: the field filters the open todos by their ref or words of their text,
 * arrow keys and Enter (or a click) choose one — `onPick` gets it and the field empties again.
 */
export function TodoPicker({ todos, onPick, disabled = false }: { todos: TodoOption[]; onPick: (todoId: number) => void; disabled?: boolean }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (words.length ? todos.filter((x) => words.every((w) => `${x.ref} ${x.text}`.toLowerCase().includes(w))) : todos).slice(0, 25);

  const pick = (x: TodoOption) => {
    setQ("");
    setOpen(false);
    keys.reset();
    onPick(x.id);
  };
  const keys = useComboboxKeys({ count: shown.length, open, setOpen, start: 0, onPick: (i) => pick(shown[i]) });
  const { active, setActive, listId } = keys;

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={keys.activeDescendant}
        aria-autocomplete="list"
        aria-label={t("Attach to a todo")}
        autoComplete="off"
        className="input h-7 w-44 py-0 text-xs"
        placeholder={t("Attach to todo …")}
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          keys.reset();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 150); // let a click land first
        }}
        onKeyDown={keys.onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute right-0 z-30 mt-1 max-h-64 w-96 max-w-[85vw] overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => {
            // Keep focus so the input's onBlur doesn't close before the click.
            e.preventDefault();
            if (closeTimer.current) clearTimeout(closeTimer.current);
          }}
        >
          {shown.length === 0 && <li className="px-3 py-1.5 text-xs text-zinc-400">{t("Nothing matches.")}</li>}
          {shown.map((x, i) => (
            <li
              key={x.id}
              id={keys.optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-xs ${i === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(x)}
            >
              <span className="shrink-0 font-mono text-zinc-400">{x.ref}</span>
              <span className="line-clamp-2 min-w-0">{x.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
