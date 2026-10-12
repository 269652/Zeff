"use client";

import { useEffect, useRef, useState } from "react";
import { searchPeopleAction } from "@/plugins/todos/server-actions";
import { useT } from "@/components/I18nProvider";

type Found = { id: number; name: string; jira: string | null };

/** The @word being typed at the cursor (letters, digits, spaces inside a name up to the cursor) — or null. */
function tagAt(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && /[\p{L}\p{N}_.@]/u.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  return /^[\p{L}\p{N}_. -]{0,40}$/u.test(query) && !/\n/.test(query) && !/\s{2}/.test(query) ? { start: at, query } : null;
}

/**
 * A textarea in which @ tags people (the People plugin): typing @ and a few letters suggests them
 * — arrow keys and Enter (or a click) put @Name in. A tagged person with a linked Jira account becomes
 * a mention of them when the note is synced to Jira. Everything else is a plain textarea.
 */
export function MentionTextarea({ value, onChange, onKeyDown, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const [tag, setTag] = useState<{ start: number; query: string } | null>(null);
  useEffect(() => {
    if (!tag) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the suggestions go with the tag being typed
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const r = await searchPeopleAction(tag.query).catch(() => []);
      if (live) {
        setFound(r);
        setActive(0);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tag]);
  const pick = (p: Found) => {
    if (!tag) return;
    const el = ref.current;
    const end = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, tag.start)}@${p.name} ${value.slice(end)}`;
    onChange(next);
    setTag(null);
    setFound([]);
    const pos = tag.start + p.name.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTag(tagAt(e.target.value, e.target.selectionStart));
        }}
        onKeyDown={(e) => {
          if (found.length && tag) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(found[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setTag(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={() => setTimeout(() => setTag(null), 150)}
      />
      {found.length > 0 && (
        <ul role="listbox" aria-label={t("People")} className="absolute z-20 mt-1 max-h-48 w-72 overflow-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {found.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left ${i === active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className={`shrink-0 text-xs ${p.jira ? "font-mono text-zinc-500" : "text-amber-600 dark:text-amber-400"}`}>{p.jira ? `~${p.jira}` : t("no Jira account")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
