"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { markTimelineSeenAction, timelineAction } from "../server-actions";
import { KIND_GROUPS, kindGroupLabel, SOURCES, sourceLabel } from "../shared";
import { TimelineView, type ViewEvent } from "./TimelineView";

/**
 * A timeline that reads itself: an entity's (`entity`: a ref, or a free name), a Workspace row's (`row`: the row, the person or case
 * it stands for), or everything (neither). The kinds (and, `sources`, the sources) to filter by on top; more on demand; the line of
 * your last visit stays while the view is open — the visit is counted a few seconds after it is shown.
 */
export function TimelineList({ entity, row, limit = 30, filters = true, sources: withSources = false, compact = false, initialKinds = [], initialSources = [], since, title, hideWhenOff = false }: { entity?: string; row?: number; limit?: number; filters?: boolean; sources?: boolean; compact?: boolean; initialKinds?: string[]; initialSources?: string[]; since?: string; /** A heading of its own (gone with the rest when hidden). */ title?: string; /** Nothing at all while the Timeline plugin is off (on pages of other plugins). */ hideWhenOff?: boolean }) {
  const t = useT();
  const [kinds, setKinds] = useState<string[]>(initialKinds);
  const [sources, setSources] = useState<string[]>(initialSources);
  const [events, setEvents] = useState<ViewEvent[] | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(false);
  const seenRef = useRef<string>("");

  const load = useCallback(
    async (before?: { at: string; id: number }) => {
      setBusy(true);
      const r = await timelineAction({ ref: entity, row, kinds, sources, since, limit, before });
      setBusy(false);
      if (!r.ok) return r.off ? (setOff(true), setError(r.error)) : setError(r.error);
      setError("");
      setEvents((had) => (before && had ? [...had, ...r.events] : r.events));
      setMore(r.events.length >= limit);
      // The line stays where your last visit was while you look (the first answer's).
      setLastSeen((had) => (had === undefined ? r.lastSeen : had));
      seenRef.current = entity || row ? (r.refs[0] ?? "") : "all";
    },
    [entity, row, kinds, sources, since, limit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Seen: counted once it was shown for a moment.
  useEffect(() => {
    if (!events) return;
    const timer = setTimeout(() => seenRef.current && void markTimelineSeenAction(seenRef.current), 4000);
    return () => clearTimeout(timer);
  }, [events]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (on: boolean) => `rounded-full border px-2 py-0.5 text-xs ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"}`;

  if (off && hideWhenOff) return null;
  return (
    <div className="space-y-2">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {filters && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("Kinds")}>
          {KIND_GROUPS.map((k) => (
            <button key={k} type="button" className={chip(kinds.includes(k))} aria-pressed={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)}>
              {kindGroupLabel(t, k)}
            </button>
          ))}
        </div>
      )}
      {withSources && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("Sources")}>
          {SOURCES.map((s) => (
            <button key={s} type="button" className={chip(sources.includes(s))} aria-pressed={sources.includes(s)} onClick={() => toggle(sources, setSources, s)}>
              {sourceLabel(t, s)}
            </button>
          ))}
        </div>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : events === null ? <p className="text-sm text-zinc-400">…</p> : <TimelineView events={events} lastSeen={lastSeen ?? null} compact={compact} />}
      {more && events && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void load({ at: events[events.length - 1].at, id: events[events.length - 1].id })}>
          {busy ? "…" : t("Older")}
        </button>
      )}
    </div>
  );
}
