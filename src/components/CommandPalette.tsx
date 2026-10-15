"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Overlay } from "@/components/Overlay";
import { useT } from "@/components/I18nProvider";
import { filterPalette, opensPalette, opensShortcuts, type PaletteItem } from "@/lib/palette";

/**
 * The global command palette (Ctrl/Cmd+K, or "/" outside a field): a combobox over the menu's pages and the open todos,
 * and a "?" dialog listing the keyboard shortcuts. `pages`: the same entries the menu shows, built by the header.
 */
export function CommandPalette({ pages }: { pages: PaletteItem[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<{ q: string; hits: PaletteItem[] }>({ q: "", hits: [] });
  const uid = useId();
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (opensPalette(e)) {
        e.preventDefault();
        setHelp(false);
        setQ("");
        setActive(0);
        setOpen(true);
      } else if (opensShortcuts(e)) {
        e.preventDefault();
        setOpen(false);
        setHelp(true);
      }
    };
    const onOpen = () => {
      setHelp(false);
      setQ("");
      setActive(0);
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("zeff:palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("zeff:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const mine = ++seq.current;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/palette?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ hits: PaletteItem[] }>) : { hits: [] }))
        .catch(() => ({ hits: [] as PaletteItem[] }))
        .then((r) => {
          if (mine === seq.current) setRecords({ q, hits: r.hits });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q, open]);

  const results = useMemo(() => {
    const found = filterPalette(pages, q);
    const recs = q.trim().length >= 2 && records.q === q ? records.hits : [];
    return [...found, ...recs];
  }, [pages, q, records]);
  const cur = Math.min(active, Math.max(results.length - 1, 0));
  const group = (g: string) => (g === "Todos" ? t("Todos") : g === "Pages" ? t("Pages") : g);

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  };
  const list = `${uid}-list`;
  const kbd = "rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-800";
  const keys: { keys: string[]; what: string }[] = [
    { keys: ["Ctrl/⌘", "K"], what: t("Open the command palette") },
    { keys: ["/"], what: t("Open the command palette (outside a text field)") },
    { keys: ["?"], what: t("Show these shortcuts") },
    { keys: ["↑", "↓", "Enter"], what: t("In the palette: choose a result and open it") },
    { keys: ["Esc"], what: t("Close a dialog or the menu") },
    { keys: ["Tab"], what: t("Move on; the first stop skips the header to the page") },
  ];

  return (
    <>
      <Overlay open={open} onClose={() => setOpen(false)} label={t("Command palette")} side="center" className="max-w-xl">
        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <input
            autoFocus
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={list}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `${uid}-${cur}` : undefined}
            aria-label={t("Search pages, settings and todos")}
            placeholder={t("Search pages, settings and todos…")}
            className="input w-full"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (results.length) setActive((cur + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[cur]);
              }
            }}
          />
        </div>
        <ul id={list} role="listbox" aria-label={t("Results")} className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={i === cur}
              onMouseMove={() => setActive(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-1.5 ${i === cur ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.label}</span>
                {r.hint && <span className={`block truncate text-xs ${i === cur ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>{r.hint}</span>}
              </span>
              <span className={`shrink-0 text-xs ${i === cur ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>{group(r.group)}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400" role="status" aria-live="polite">
          {results.length ? t("{n} results — ↑↓ to choose, Enter to open, Esc to close", { n: results.length }) : t("No results")}
        </p>
      </Overlay>
      <Overlay open={help} onClose={() => setHelp(false)} label={t("Keyboard shortcuts")} side="center" className="max-w-md">
        <div className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Keyboard shortcuts")}</h2>
          <ul className="space-y-2">
            {keys.map((k) => (
              <li key={k.what} className="flex items-center justify-between gap-3 text-sm">
                <span>{k.what}</span>
                <span className="flex shrink-0 gap-1">
                  {k.keys.map((x) => (
                    <kbd key={x} className={kbd}>
                      {x}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="text-right">
            <button type="button" className="btn btn-sm" onClick={() => setHelp(false)}>
              {t("Close")}
            </button>
          </div>
        </div>
      </Overlay>
    </>
  );
}
