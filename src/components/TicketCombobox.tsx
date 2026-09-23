"use client";

import { useRef, useState } from "react";
import type { TicketSuggestionLite } from "./EntryForm";

/**
 * A ticket autocomplete that replaces the native <datalist>. Unlike a datalist —
 * which hides an option once the field already holds its exact value — this always
 * lists every matching ticket, so the same ticket can be picked again (e.g. to book
 * it on another day). Picking one fills the field and lets the caller reuse its job.
 */
export function TicketCombobox({
  value,
  onChange,
  suggestions,
  id = "ticket",
  name = "ticket",
  placeholder = "PROJ-337",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: TicketSuggestionLite[];
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const q = value.trim().toLowerCase();
  const filtered = q
    ? suggestions.filter(
        (s) =>
          s.ticket.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.jobName.toLowerCase().includes(q),
      )
    : suggestions;
  const shown = filtered.slice(0, 25);

  const pick = (s: TicketSuggestionLite) => {
    onChange(s.ticket);
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
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        className="input"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
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
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-64 overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => {
            // Keep focus so the input's onBlur doesn't close before the click.
            e.preventDefault();
            if (closeTimer.current) clearTimeout(closeTimer.current);
          }}
        >
          {shown.map((s, i) => (
            <li
              key={s.ticket}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 text-sm ${
                i === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono">{s.ticket}</span>
                {s.assignee && (
                  <span
                    className={`badge ${s.mine ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300" : "badge-web"}`}
                  >
                    {s.mine ? "You" : s.assignee}
                  </span>
                )}
              </div>
              {(s.jobName || s.description) && (
                <div className="truncate text-xs text-zinc-500">
                  {s.jobName}
                  {s.jobName && s.description ? " — " : ""}
                  {s.description}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
