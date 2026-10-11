"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { contextKindLabels, type ContextBrief, type ContextBriefItem } from "@/lib/contexts-shared";
import { CONTEXT_KIND_STYLE } from "./contextKindStyle";
import { useT } from "@/components/I18nProvider";
import { formatDate } from "@/lib/format";
import type { T } from "@/lib/i18n/shared";

const CARD_WIDTH = 380;
/** Items shown in the card; the rest are counted. */
const SHOWN = 3;

const day = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10), { weekday: false, year: true }) : null);

const syncStates = (t: T): Record<Exclude<ContextBriefItem["sync"], "no-ticket">, { text: string; cls: string }> => ({
  synced: { text: `✓ ${t("in Jira")}`, cls: "text-emerald-700 dark:text-emerald-400" },
  changed: { text: t("changed since sync"), cls: "text-amber-700 dark:text-amber-400" },
  unsynced: { text: t("not in Jira yet"), cls: "text-zinc-400" },
});

/** One item in the card: where it's from, who and when, its headline, the start of the message, its links and files. */
function Item({ c, first, ticketUrl }: { c: ContextBriefItem; first: boolean; ticketUrl?: string | null }) {
  const t = useT();
  const SYNC = syncStates(t);
  return (
    <div className={`space-y-1 ${first ? "" : "border-t border-zinc-100 pt-2.5 dark:border-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500">
        <span className={`rounded px-1.5 py-0.5 font-medium ${CONTEXT_KIND_STYLE[c.kind]}`}>{contextKindLabels(t)[c.kind]}</span>
        {c.author && <span className="font-medium text-zinc-700 dark:text-zinc-200">{c.author}</span>}
        {c.date && <span>{day(c.date)}</span>}
        {c.ticket &&
          (ticketUrl ? (
            <a href={ticketUrl} target="_blank" rel="noreferrer" className="font-mono text-sky-700 hover:underline dark:text-sky-300">
              {c.ticket}
            </a>
          ) : (
            <span className="font-mono">{c.ticket}</span>
          ))}
        {c.sync !== "no-ticket" && <span className={SYNC[c.sync].cls}>{SYNC[c.sync].text}</span>}
      </div>
      <div className="font-medium leading-snug">{c.headline}</div>
      {c.excerpt && <p className="line-clamp-4 text-xs leading-relaxed whitespace-pre-line text-zinc-600 dark:text-zinc-300">{c.excerpt}</p>}
      {(c.links.length > 0 || c.files > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {c.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className={`rounded px-1.5 py-0.5 text-[11px] hover:underline ${CONTEXT_KIND_STYLE[l.kind ?? "note"]}`}
              title={l.url}
            >
              {l.label} ↗
            </a>
          ))}
          {c.files > 0 && (
            <span className="text-[11px] text-zinc-500">
              📎 {c.files === 1 ? t("1 file") : t("{n} files", { n: c.files })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The entries table's context icon: a link to the entry's Context section that, on hover (or
 * keyboard focus), shows a floating card with its items at a glance — like the ticket links' card.
 */
export function ContextHoverIcon({
  entryId,
  brief,
  ticketUrls = {},
}: {
  entryId: number;
  brief: ContextBrief;
  /** Jira addresses of the items' tickets, by key. */
  ticketUrls?: Record<string, string | null>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 0 });
  const linkRef = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };

  /**
   * Right-aligned to the icon, under it — or above it when there's more room there — and no
   * taller than that room (it scrolls inside), so the whole card stays in the window.
   */
  function place() {
    const r = linkRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.right - CARD_WIDTH, window.innerWidth - CARD_WIDTH - 8));
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    setPos(
      below >= 320 || below >= above
        ? { left, top: r.bottom + 6, maxHeight: below }
        : { left, bottom: window.innerHeight - r.top + 6, maxHeight: above },
    );
  }

  const show = () =>
    later(() => {
      place();
      setOpen(true);
    }, 250);
  const hide = () => later(() => setOpen(false), 150);
  const keep = () => timer.current && clearTimeout(timer.current);

  return (
    <>
      <Link
        ref={linkRef}
        href={`/entries/${entryId}#context`}
        className="mt-[3px] inline-flex shrink-0 text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300"
        aria-label={t("Context ({n})", { n: brief.count })}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v4" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </Link>

      {open && (
        <div
          role="tooltip"
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: CARD_WIDTH, maxHeight: pos.maxHeight }}
          className="card z-50 space-y-2.5 overflow-y-auto p-3 text-left text-sm font-normal tracking-normal text-zinc-800 normal-case shadow-lg dark:text-zinc-100"
          onMouseEnter={keep}
          onMouseLeave={hide}
        >
          <div className="text-xs font-semibold text-zinc-500 uppercase">
            {brief.count === 1 ? t("Context · 1 item") : t("Context · {n} items", { n: brief.count })}
          </div>
          {brief.items.slice(0, SHOWN).map((c, i) => (
            <Item key={c.id} c={c} first={i === 0} ticketUrl={c.ticket ? ticketUrls[c.ticket] : null} />
          ))}
          {brief.count > SHOWN && <p className="text-xs text-zinc-500">{t("and {n} more", { n: brief.count - SHOWN })}</p>}
          <Link href={`/entries/${entryId}#context`} className="inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open on the entry")} →
          </Link>
        </div>
      )}
    </>
  );
}
