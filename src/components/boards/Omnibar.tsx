"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { omniSearchAction } from "@/plugins/todos/server-actions";

export type OmniChip = { key: string; kind: string; title: string; todoIds: number[] };
type Hit = OmniChip & { sub: string };

const ICON: Record<string, string> = { text: "🔎", ticket: "🎫", todo: "☑", note: "📝", mail: "✉", teams: "💬", jira: "🗨", gitlab: "🔀", context: "📝", fact: "💡", doc: "📄", keep: "🗒", person: "👤", kind: "🏷" };

/**
 * The todo omnibar: type anything — a word from a todo, a ticket, a mail, a comment, a note, a person — and pick what
 * you mean; it becomes a chip, and the lists show exactly the todos that chip belongs to (several chips: those that
 * fit all). One mail cited by three todos shows all three; a ticket shows all its todos.
 */
export function Omnibar({ chips, onChange }: { chips: OmniChip[]; onChange: (chips: OmniChip[]) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      seq.current++;
      setHits([]);
      setBusy(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      void omniSearchAction(q).then((r) => {
        if (mine !== seq.current) return;
        setHits(r);
        setActive(0);
        setBusy(false);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const pick = (h: Hit) => {
    if (!chips.some((c) => c.key === h.key)) onChange([...chips, { key: h.key, kind: h.kind, title: h.title, todoIds: h.todoIds }]);
    setQ("");
    setHits([]);
    setOpen(false);
  };
  const labels: Record<string, string> = {
    text: t("Everything with this"),
    ticket: t("Tickets"),
    kind: t("Kinds"),
    person: t("People"),
    todo: t("Todos"),
    note: t("Notes"),
    mail: t("Mails"),
    teams: t("Messages"),
    jira: t("Jira comments"),
    gitlab: t("GitLab"),
    context: t("Context"),
    keep: t("Keep"),
    doc: t("Documents"),
    fact: t("Facts"),
  };

  return (
    <div ref={box} className="relative flex min-w-[16rem] flex-1 flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900" role="search">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-[16rem] items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100" title={`${c.title} — ${t("{n} todos", { n: c.todoIds.length })}`}>
          <span aria-hidden>{ICON[c.kind] ?? "•"}</span>
          <span className="truncate">{c.title}</span>
          <button type="button" className="opacity-60 hover:opacity-100" aria-label={t("Remove this filter")} onClick={() => onChange(chips.filter((x) => x.key !== c.key))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            pick(hits[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Backspace" && !q && chips.length) {
            onChange(chips.slice(0, -1));
          }
        }}
        placeholder={chips.length ? t("and …") : t("Search todos, tickets, mails, comments, notes, people …")}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none"
        aria-label={t("Search the todos and everything they are made of")}
        aria-expanded={open}
        role="combobox"
        aria-controls="omnibar-list"
      />
      {open && q.trim().length >= 2 && (
        <ul id="omnibar-list" role="listbox" className="absolute top-full left-0 z-30 mt-1 max-h-[60vh] w-full min-w-[22rem] overflow-auto rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {hits.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500">{busy ? t("Searching …") : t("Nothing found that a todo refers to.")}</li>}
          {hits.map((h, i) => {
            const first = i === 0 || hits[i - 1].kind !== h.kind;
            return (
              <li key={h.key} role="presentation">
                {first && <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">{labels[h.kind] ?? h.kind}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(h)}
                  className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left ${i === active ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                >
                  <span aria-hidden>{ICON[h.kind] ?? "•"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.title}</span>
                    {h.sub && h.kind !== "text" && <span className="block truncate text-xs text-zinc-500">{h.sub}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{t("{n} todos", { n: h.todoIds.length })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
