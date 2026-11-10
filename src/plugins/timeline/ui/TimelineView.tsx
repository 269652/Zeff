"use client";

import { EmptyState } from "@/components/EmptyState";
import { useT } from "@/components/I18nProvider";
import { byDay, kindIcon, kindLabel, localDay, seenIndex, sourceLabel } from "../shared";

/**
 * A timeline drawn: the events by day (today, yesterday, then the date, with how many), each on a rail with its kind's sign, the
 * time, its title (to where it is — in Zeff, or its source in a new tab), where it came from (source and kind), its summary and the
 * entities it concerns; a line where your last visit was. Never draws what lies in the future. Only draws what it is given
 * (TimelineList reads it).
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

export function TimelineView({ events: all, lastSeen, compact = false }: { events: ViewEvent[]; lastSeen: string | null; compact?: boolean }) {
  const t = useT();
  // What lies ahead is no event yet.
  const now = new Date().toISOString();
  const events = all.filter((e) => e.at <= now);
  if (!events.length) return <EmptyState faint>{t("Nothing yet — what happens shows up here after the next sync.")}</EmptyState>;
  const line = seenIndex(events, lastSeen);
  const firstSeen = line >= 0 ? events[line].id : null;
  const today = localDay(now);
  const yesterday = localDay(new Date(Date.now() - 864e5).toISOString());
  const dayName = (day: string) => (day === today ? t("Today") : day === yesterday ? t("Yesterday") : new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }));
  return (
    <div className="space-y-6 text-sm" data-timeline>
      {byDay(events).map((d) => (
        <section key={d.day} data-day={d.day}>
          <h4 className="sticky top-0 z-[1] mb-2 flex items-baseline gap-2 border-b border-zinc-200 bg-white/90 py-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{dayName(d.day)}</span>
            <span className="text-xs text-zinc-400 tabular-nums">{d.events.length}</span>
          </h4>
          <ol className="relative ml-3 border-l border-zinc-200 dark:border-zinc-800">
            {d.events.map((e) => (
              <li key={e.id} className="relative pb-3 pl-6 last:pb-0">
                {e.id === firstSeen && (
                  <div className="mb-3 -ml-6 flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400" role="separator">
                    <span className="h-px flex-1 bg-indigo-300 dark:bg-indigo-800" />▲ {t("New since your last visit")}
                    <span className="h-px flex-1 bg-indigo-300 dark:bg-indigo-800" />
                  </div>
                )}
                <span aria-hidden className="absolute top-0.5 -left-3 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-900">
                  {kindIcon(e.kind)}
                </span>
                <div className="min-w-0 rounded-lg px-2 py-1 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60" data-kind={e.kind}>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
                    <time dateTime={e.at} className="font-medium tabular-nums text-zinc-600 dark:text-zinc-300" title={new Date(e.at).toLocaleString()}>
                      {new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <span aria-hidden>·</span>
                    <span>{kindLabel(t, e.kind)}</span>
                    {e.source && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-zinc-400">{sourceLabel(t, e.source)}</span>
                      </>
                    )}
                  </div>
                  <Link href={e.url} className={`block min-w-0 font-medium break-words ${e.url ? "text-zinc-900 hover:underline dark:text-zinc-100" : ""}`}>
                    {e.title || "—"}
                    {e.url && external(e.url) ? " ↗" : ""}
                  </Link>
                  {!compact && e.summary && e.summary !== e.title && <p className="mt-0.5 line-clamp-3 text-zinc-600 dark:text-zinc-400">{e.summary}</p>}
                  {e.entities.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {e.entities.map((x) => (
                        <Link key={x.ref} href={x.href} className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          {x.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
