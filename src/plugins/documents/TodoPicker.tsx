"use client";

import { useId, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";

type TodoOption = { id: number; ref: string; text: string };

/**
 * A todo to pick by typing: the field filters the open todos by their ref or words of their text,
 * arrow keys and Enter (or a click) choose one — `onPick` gets it and the field empties again.
 */
export function TodoPicker({ todos, onPick, disabled = false }: { todos: TodoOption[]; onPick: (todoId: number) => void; disabled?: boolean }) {
  const t = useT();
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (words.length ? todos.filter((x) => words.every((w) => `${x.ref} ${x.text}`.toLowerCase().includes(w))) : todos).slice(0, 25);

  const pick = (x: TodoOption) => {
    setQ("");
    setOpen(false);
    setActive(0);
    onPick(x.id);
  };

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
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
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 150); // let a click land first
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
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
