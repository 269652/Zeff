"use client";

import { useT } from "@/components/I18nProvider";
import { byDay, kindIcon, kindLabel, localDay, seenIndex } from "../shared";

/**
 * A timeline drawn: the events by day (today, yesterday, then the date), each with its kind's sign and name, the time, its title
 * (to where it is — in Zeff, or its source in a new tab), a short summary and the other entities it concerns; a line where your last
 * visit was. Only draws what it is given (TimelineList reads it).
 */

export type ViewEvent = { id: number; at: string; kind: string; source: string; title: string; summary: string; url: string; entities: { ref: string; label: string; href: string }[] };

const external = (url: string) => /^https?:\/\//.test(url);

function Link({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return external(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function TimelineView({ events, lastSeen, compact = false }: { events: ViewEvent[]; lastSeen: string | null; compact?: boolean }) {
  const t = useT();
  if (!events.length) return <p className="text-sm text-zinc-400">{t("Nothing yet — what happens shows up here after the next sync.")}</p>;
  const line = seenIndex(events, lastSeen);
  const firstSeen = line >= 0 ? events[line].id : null;
  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 864e5).toISOString());
  const dayName = (day: string) => (day === today ? t("Today") : day === yesterday ? t("Yesterday") : new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }));
  return (
    <div className="space-y-3 text-sm" data-timeline>
      {byDay(events).map((d) => (
        <section key={d.day} data-day={d.day}>
          <h4 className="sticky top-0 z-[1] mb-1 bg-white/90 py-0.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase backdrop-blur dark:bg-zinc-950/90">{dayName(d.day)}</h4>
          <ol className="space-y-1.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            {d.events.map((e) => (
              <li key={e.id}>
                {e.id === firstSeen && (
                  <div className="my-2 -ml-3 flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400" role="separator">
                    <span className="h-px flex-1 bg-indigo-300 dark:bg-indigo-800" />▲ {t("New since your last visit")}
                    <span className="h-px flex-1 bg-indigo-300 dark:bg-indigo-800" />
                  </div>
                )}
                <div className="grid grid-cols-[1.4rem_1fr] gap-1.5" data-kind={e.kind}>
                  <span aria-hidden className="text-center">
                    {kindIcon(e.kind)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs text-zinc-400 tabular-nums" title={new Date(e.at).toLocaleString()}>
                        {new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-zinc-500">{kindLabel(t, e.kind)}</span>
                      <Link href={e.url} className={`min-w-0 font-medium break-words ${e.url ? "text-zinc-900 hover:underline dark:text-zinc-100" : ""}`}>
                        {e.title || "—"}
                        {e.url && external(e.url) ? " ↗" : ""}
                      </Link>
                    </div>
                    {!compact && e.summary && e.summary !== e.title && <p className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{e.summary}</p>}
                    {e.entities.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {e.entities.map((x) => (
                          <Link key={x.ref} href={x.href} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                            {x.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
