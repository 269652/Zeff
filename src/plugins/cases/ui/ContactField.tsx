"use client";

import { useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useComboboxKeys } from "@/components/Combobox";

/**
 * A contact chosen by typing (an autocomplete): the contacts whose name has what you typed — people and organisations, the ones
 * starting with it first — and, when none is it, "add “…”" as an organisation or a person. Arrow keys, Enter, Escape.
 */

export type ContactOption = { id: number; name: string; kind: "person" | "organization" };
type Kind = ContactOption["kind"];

export function ContactField({ contacts, value, onPick, onNew, label, placeholder }: { contacts: ContactOption[]; value: number | null; onPick: (id: number | null) => void; onNew: (name: string, kind: Kind) => void; label: string; placeholder?: string }) {
  const t = useT();
  const chosen = contacts.find((c) => c.id === value) ?? null;
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const text = q ?? chosen?.name ?? "";
  const words = text.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!words) return contacts.slice(0, 8);
    return contacts
      .filter((c) => c.name.toLowerCase().includes(words))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(words)) - Number(a.name.toLowerCase().startsWith(words)) || a.name.localeCompare(b.name, "de"))
      .slice(0, 8);
  }, [contacts, words]);
  // "Add …" when no contact is called just so.
  const canAdd = !!words && !contacts.some((c) => c.name.toLowerCase() === words);
  const options = [...hits.map((c) => ({ type: "pick" as const, c })), ...(canAdd ? (["organization", "person"] as const).map((k) => ({ type: "new" as const, k })) : [])];
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.type === "pick") onPick(o.c.id);
    else onNew(text.trim(), o.k);
    setQ(null);
    setOpen(false);
  };
  const keys = useComboboxKeys({ count: options.length, open, setOpen, onPick: choose, wrap: true, start: 0, onEscape: () => setQ(null) });
  const { active: at, setActive: setAt, listId: list } = keys;
  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <input
          ref={input}
          className="input py-1 text-sm"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={list}
          aria-activedescendant={keys.activeDescendant}
          aria-autocomplete="list"
          value={text}
          placeholder={placeholder ?? t("Type a name…")}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => (setOpen(false), setQ(null)), 120)}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setAt(0))}
          onKeyDown={keys.onKeyDown}
        />
        {chosen && (
          <button type="button" className="icon-btn" title={t("Remove")} aria-label={t("Remove")} onClick={() => (onPick(null), setQ(""), input.current?.focus())}>
            ×
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul id={list} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {options.map((o, i) => (
            <li
              key={o.type === "pick" ? o.c.id : `new-${o.k}`}
              id={keys.optionId(i)}
              role="option"
              aria-selected={i === at}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === at ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => (e.preventDefault(), choose(i))}
            >
              {o.type === "pick" ? (
                <>
                  <span className="w-4 text-center text-xs" aria-hidden>
                    {o.c.kind === "organization" ? "🏢" : "👤"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.c.name}</span>
                  {o.c.id === value && <span className="text-xs text-zinc-400">✓</span>}
                </>
              ) : (
                <>
                  <span className="w-4 text-center text-indigo-600 dark:text-indigo-400" aria-hidden>
                    +
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t("Add “{name}”", { name: text.trim() })} <span className="text-zinc-500">{o.k === "organization" ? t("as an organisation") : t("as a person")}</span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
