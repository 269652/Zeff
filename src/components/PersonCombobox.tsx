"use client";

import { useId, useRef, useState } from "react";

export type PersonOption = { name: string; hint: string };

/**
 * A name autocomplete for colleagues (like TicketCombobox): typing filters the known people
 * — by any part of the name — arrows move, Enter or a click picks; any other name can still
 * be typed.
 */
export function PersonCombobox({
  value,
  onChange,
  people,
  id,
  name,
  placeholder = "Nina Wolf",
}: {
  value: string;
  onChange: (v: string) => void;
  people: PersonOption[];
  id?: string;
  name?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listId = useId();

  const q = value.trim().toLowerCase();
  // Names starting with what's typed (or with a word that does) come first.
  const shown = (
    q
      ? people
          .filter((p) => p.name.toLowerCase().includes(q) && p.name.toLowerCase() !== q)
          .sort((a, b) => Number(!a.name.toLowerCase().split(" ").some((w) => w.startsWith(q))) - Number(!b.name.toLowerCase().split(" ").some((w) => w.startsWith(q))))
      : people
  ).slice(0, 12);

  const pick = (p: PersonOption) => {
    onChange(p.name);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
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
          } else if (e.key === "Enter" && open && active >= 0 && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => {
            // Keep focus so the input's onBlur doesn't close before the click.
            e.preventDefault();
            if (closeTimer.current) clearTimeout(closeTimer.current);
          }}
        >
          {shown.map((p, i) => (
            <li
              key={p.name}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm ${
                i === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
            >
              <span>{p.name}</span>
              <span className="truncate text-xs text-zinc-400">{p.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
