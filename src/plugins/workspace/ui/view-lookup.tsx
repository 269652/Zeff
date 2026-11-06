"use client";

import { useId, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { lookupAddAction, lookupSearchAction, undoAction } from "../actions";
import type { LookupHit } from "../lookup-point";

const WAIT_MS = 300;

/**
 * A view's <lookup>: typed to find elsewhere (a film at TMDB) — the suggestions under it (arrows, Enter, Esc) — and the one picked
 * becomes a row. The field stays, for the next one; open=true opens the row instead.
 */
export function LookupField({ a, dbId, reload, openRow }: { a: Record<string, string>; dbId: number; reload: () => void; openRow: (id: number) => void }) {
  const t = useT();
  const list = useId();
  const [text, setText] = useState("");
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [credit, setCredit] = useState("");
  const [hi, setHi] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // (An answer overtaken by the next key is dropped.)
  const asked = useRef(0);
  const language = () => a.language || navigator.language || "de-DE";

  const changed = (q: string) => {
    setText(q);
    setHi(0);
    setNote("");
    clearTimeout(timer.current);
    const turn = ++asked.current;
    if (q.trim().length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const r = await lookupSearchAction(a.source, q, language());
      if (turn !== asked.current) return;
      setBusy(false);
      if (!r.ok) {
        setHits([]);
        setNote(r.error);
        return;
      }
      setHits(r.hits);
      setCredit(r.credit);
      setNote(r.hits.length ? "" : t("No match"));
    }, WAIT_MS);
  };

  const close = () => {
    asked.current++;
    clearTimeout(timer.current);
    setHits([]);
    setNote("");
    setBusy(false);
  };

  const pick = async (hit: LookupHit) => {
    close();
    setAdding(true);
    const r = await lookupAddAction({ dbId, source: a.source, hit: hit.id, language: language(), map: JSON.parse(a.map) as [string, string][], unique: a.unique || undefined });
    setAdding(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setText("");
    reload();
    if (r.existed) return toast(t("“{title}” is already there.", { title: r.title }), { action: { label: t("Open"), run: () => openRow(r.id) } });
    if (r.notes.length) toast(`${r.title}: ${r.notes.join("; ")}`, { tone: "error" });
    if (a.open === "true") return openRow(r.id);
    if (r.notes.length) return;
    const undoId = r.undoId;
    toast(t("“{title}” added.", { title: r.title }), undoId ? { action: { label: t("Undo"), run: () => void undoAction(undoId).then(reload) } } : {});
  };

  const shown = hits.length > 0 || !!note;
  return (
    <div className="relative min-w-0 flex-1 print:hidden" onClick={(e) => e.stopPropagation()}>
      <input
        className="input w-full py-1 text-sm"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={hits[hi] ? `${list}-${hi}` : undefined}
        aria-busy={busy || adding}
        aria-label={a.placeholder ?? t("Search …")}
        placeholder={a.placeholder ?? t("Search …")}
        value={text}
        disabled={adding}
        onChange={(e) => changed(e.target.value)}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") return close();
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && !(e.key === "Enter" && hits[hi])) return;
          e.preventDefault();
          if (e.key === "Enter") void pick(hits[hi]);
          else setHi((h) => (e.key === "ArrowDown" ? Math.min(h + 1, hits.length - 1) : Math.max(h - 1, 0)));
        }}
      />
      {adding && <span className="absolute top-1.5 right-2 text-xs text-zinc-500">{t("Adding …")}</span>}
      {busy && !adding && <span className="absolute top-1.5 right-2 text-xs text-zinc-500">{t("Searching …")}</span>}
      {shown && (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-md border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {note && <p className="px-3 py-2 text-zinc-500">{note}</p>}
          <ul id={list} role="listbox" aria-label={a.placeholder ?? t("Search …")} className="max-h-80 overflow-auto">
            {hits.map((h, i) => (
              <li key={h.id} id={`${list}-${i}`} role="option" aria-selected={i === hi}>
                <button type="button" tabIndex={-1} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === hi ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`} onMouseDown={(e) => (e.preventDefault(), void pick(h))} onMouseEnter={() => setHi(i)}>
                  {h.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a picture linked from the source, as it is
                    <img src={h.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-8 shrink-0 rounded-sm object-cover" />
                  ) : (
                    <span className="h-12 w-8 shrink-0 rounded-sm bg-zinc-100 dark:bg-zinc-800" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{h.title}</span>
                    {h.subtitle && <span className="block truncate text-xs text-zinc-500">{h.subtitle}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {credit && hits.length > 0 && <p className="border-t border-zinc-100 px-3 py-1 text-[11px] text-zinc-500 dark:border-zinc-800">{credit}</p>}
        </div>
      )}
    </div>
  );
}
