"use client";

import { useEffect, useRef, useState } from "react";
import type { JiraStatusCategory } from "@/db/schema";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";

const CARD_WIDTH = 360;

const STATUS_BADGE: Record<JiraStatusCategory, string> = {
  todo: "badge-jtodo",
  inprogress: "badge-jprogress",
  done: "badge-jdone",
  unknown: "badge-junknown",
};

/** Jira wiki markup to readable text: headings, code/quote blocks, [label|url] links and *bold* markers. */
function plainDescription(text: string): string {
  return text
    .replace(/\{(?:code|noformat|quote|panel|color)(?::[^}]*)?\}/g, "")
    .replace(/^h[1-6]\.\s*/gm, "")
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, "$1")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,:;!?])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "2026-09-15T10:00:00.000+0200" (or a localized string) → "2026-09-15". */
function day(s: string | null): string | null {
  const d = (s ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * A ticket key that links to Jira and, on hover (or keyboard focus), shows a floating card
 * with its title, status, description and details. Without a card it's just the link.
 */
export function TicketLink({ ticket, card, className = "", external = false }: { ticket: string; card?: TicketCard; className?: string; /** With ↗: it opens Jira. */ external?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const linkRef = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };

  /** Under the key, or above it when it sits low in the window; kept inside the window. */
  function place() {
    const r = linkRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_WIDTH - 8));
    setPos(r.bottom > window.innerHeight * 0.6 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  }

  const show = () =>
    later(() => {
      place();
      setOpen(true);
    }, 250);
  const hide = () => later(() => setOpen(false), 150);
  const keep = () => timer.current && clearTimeout(timer.current);

  const label = (
    <span className={`font-mono ${className}`}>
      {ticket}
      {external && " ↗"}
    </span>
  );
  const url = card?.url;
  const description = card?.description ? plainDescription(card.description) : "";

  return (
    <>
      {url ? (
        <a
          ref={linkRef}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
          onMouseEnter={card ? show : undefined}
          onMouseLeave={card ? hide : undefined}
          onFocus={card ? show : undefined}
          onBlur={card ? hide : undefined}
        >
          {label}
        </a>
      ) : (
        label
      )}

      {open && card && (
        <div
          role="tooltip"
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: CARD_WIDTH }}
          className="card z-50 space-y-2 p-3 text-left text-sm font-normal tracking-normal text-zinc-800 normal-case shadow-lg dark:text-zinc-100"
          onMouseEnter={keep}
          onMouseLeave={hide}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-zinc-500">
              {card.key}
              {card.issueType ? ` · ${card.issueType}` : ""}
            </span>
            {card.status && <span className={`badge ${STATUS_BADGE[card.statusCategory]}`}>{card.status}</span>}
          </div>
          {card.synced ? (
            <>
              <div className="font-medium leading-snug">{card.summary || <span className="text-zinc-400">No title</span>}</div>
              {description && (
                <p className="line-clamp-6 text-xs leading-relaxed whitespace-pre-line text-zinc-600 dark:text-zinc-300">{description}</p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {card.assignee && (
                  <>
                    <dt className="text-zinc-500">Assignee</dt>
                    <dd>{card.assignee}</dd>
                  </>
                )}
                {card.priority && (
                  <>
                    <dt className="text-zinc-500">Priority</dt>
                    <dd>{card.priority}</dd>
                  </>
                )}
                {day(card.openedAt) && (
                  <>
                    <dt className="text-zinc-500">Opened</dt>
                    <dd className="font-mono">{day(card.openedAt)}</dd>
                  </>
                )}
                {day(card.resolvedAt) && (
                  <>
                    <dt className="text-zinc-500">Resolved</dt>
                    <dd className="font-mono">{day(card.resolvedAt)}</dd>
                  </>
                )}
                {card.jobNumber && (
                  <>
                    <dt className="text-zinc-500">Zeff job</dt>
                    <dd className="font-mono">{card.jobNumber}</dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <p className="text-xs text-zinc-500">Not synced from Jira yet — sync on the Jira tab for its title and details.</p>
          )}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Open in Jira ↗
            </a>
          )}
        </div>
      )}
    </>
  );
}
