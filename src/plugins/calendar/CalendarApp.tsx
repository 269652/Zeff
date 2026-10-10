"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { dateOf, dayOf, plusMinutes, SOURCE_LABELS, type CalendarEventView, type CalendarView, type ProposedEvent } from "@/lib/calendar/ir-shared";
import { deleteEventAction, saveEventAction, syncCalendarsAction, updateCalendarAction } from "./server-actions";

const HOUR = 44;
const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** An appointment as the week shows it: a calendar's, or one a todo proposes. */
type Item = { id: string; title: string; start: string; end: string; allDay: boolean; color: string; event?: CalendarEventView; calendar?: CalendarView; proposed?: ProposedEvent };

const minutesOfDay = (stamp: string) => (stamp.length === 10 ? 0 : Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16)));
const timeText = (stamp: string) => (stamp.length === 10 ? "" : stamp.slice(11, 16));

/** A day's timed appointments side by side where they overlap: each its lane and how many lanes its group has. */
function lanes(items: Item[]): (Item & { lane: number; of: number })[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const out: (Item & { lane: number; of: number })[] = [];
  let group: (Item & { lane: number; of: number })[] = [];
  let groupEnd = "";
  const close = () => {
    const n = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.of = n;
    out.push(...group);
    group = [];
  };
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) close();
    const ends: string[] = [];
    for (const g of group) ends[g.lane] = ends[g.lane] && ends[g.lane] > g.end ? ends[g.lane] : g.end;
    let lane = ends.findIndex((e) => !e || e <= it.start);
    if (lane < 0) lane = ends.length;
    group.push({ ...it, lane, of: 1 });
    groupEnd = groupEnd > it.end ? groupEnd : it.end;
  }
  if (group.length) close();
  return out;
}

/**
 * The Kalender app: a week of every calendar (Zeff's own, Google's, Outlook's) — each shown or not
 * from the list beside it — with the appointments todos propose, dashed; a click on a free time
 * enters one in a Zeff calendar.
 */
export function CalendarApp({
  week,
  calendars,
  events,
  proposed,
  now,
  canSync,
}: {
  /** The Monday, "YYYY-MM-DD". */
  week: string;
  calendars: CalendarView[];
  events: CalendarEventView[];
  proposed: ProposedEvent[];
  /** Now, as a local stamp (from the server). */
  now: string;
  canSync: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useState<Record<number, boolean>>(() => Object.fromEntries(calendars.map((c) => [c.id, c.visible])));
  const [showProposed, setShowProposed] = useState(true);
  const [picked, setPicked] = useState<Item | null>(null);
  const [draft, setDraft] = useState<{ calendarId: number; title: string; start: string; minutes: number } | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);
  const own = calendars.filter((c) => c.source === "zeff");
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (grid.current) grid.current.scrollTop = 7 * HOUR;
    }, 0);
    return () => clearTimeout(t);
  }, [week]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = dateOf(week);
    d.setDate(d.getDate() + i);
    return dayOf(d);
  });
  const shift = (n: number) => {
    const d = dateOf(week);
    d.setDate(d.getDate() + 7 * n);
    return `/kalender?w=${dayOf(d)}`;
  };
  const items: Item[] = [
    ...events
      .filter((e) => shown[e.calendarId] && !e.cancelled)
      .map((e) => ({ id: `e${e.id}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay, color: byId.get(e.calendarId)?.color ?? "#7A869A", event: e, calendar: byId.get(e.calendarId) })),
    ...(showProposed ? proposed.map((p, i) => ({ id: `p${i}`, title: p.title, start: p.start, end: p.end, allDay: false, color: "#6366F1", proposed: p })) : []),
  ];
  const done = (r: { ok: boolean; message?: string; error?: string } | null) => {
    toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
    if (r?.ok) router.refresh();
    return !!r?.ok;
  };
  const toggle = (c: CalendarView) => {
    const next = !shown[c.id];
    setShown({ ...shown, [c.id]: next });
    start(async () => {
      const r = await updateCalendarAction(c.id, { visible: next });
      if (!r?.ok) done(r);
    });
  };
  const newAt = (day: string, y: number) => {
    if (!own.length) {
      toast("Erst einen eigenen Kalender anlegen (Einstellungen) — dann lassen sich hier Termine eintragen.", { tone: "error" });
      return;
    }
    const m = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR / 0.5) * 30));
    setPicked(null);
    setDraft({ calendarId: own[0].id, title: "", start: `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, minutes: 60 });
  };
  const nowDay = now.slice(0, 10);

  return (
    <>
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Kalender</h1>
        <div className="flex items-center gap-1">
          <Link href={shift(-1)} className="btn btn-sm" aria-label="Woche davor">
            ‹
          </Link>
          <Link href="/kalender" className="btn btn-sm">
            Heute
          </Link>
          <Link href={shift(1)} className="btn btn-sm" aria-label="Woche danach">
            ›
          </Link>
          {canSync && (
            <button type="button" className="btn btn-sm ml-auto" disabled={pending} onClick={() => start(async () => void done(await syncCalendarsAction()))} title="Google Calendar jetzt lesen">
              {pending ? "…" : "Sync"}
            </button>
          )}
        </div>
        <p className="text-sm font-medium">
          {dateOf(days[0]).toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – {dateOf(days[6]).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}
        </p>
        {(["zeff", "google", "outlook"] as const).map((src) => {
          const list = calendars.filter((c) => c.source === src);
          return list.length ? (
            <div key={src} className="space-y-1">
              <p className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{src === "zeff" ? "Meine Kalender" : SOURCE_LABELS[src]}</p>
              {list.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 rounded" style={{ accentColor: c.color }} checked={!!shown[c.id]} onChange={() => toggle(c)} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </label>
              ))}
            </div>
          ) : null;
        })}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 rounded" style={{ accentColor: "#6366F1" }} checked={showProposed} onChange={() => setShowProposed(!showProposed)} />
          <span className="min-w-0 flex-1 truncate">Vorschläge der Todos ({proposed.length})</span>
        </label>
        <Link href="/kalender/einstellungen" className="block text-xs text-zinc-500 hover:underline">
          Kalender verwalten …
        </Link>
      </div>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {/* The days, and their all-day appointments. */}
            <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-zinc-200 text-xs dark:border-zinc-800">
              <div />
              {days.map((d, i) => (
                <div key={d} className={`border-l border-zinc-100 px-1 py-1 dark:border-zinc-800 ${d === nowDay ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}`}>
                  <div className={`font-medium ${d === nowDay ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
                    {DAY_NAMES[i]} {Number(d.slice(8, 10))}.
                  </div>
                  <div className="space-y-0.5">
                    {items
                      .filter((it) => it.allDay && it.start <= d && it.end > d)
                      .map((it) => (
                        <button key={it.id} type="button" onClick={() => setPicked(it)} className="block w-full truncate rounded px-1 text-left text-[11px] text-white" style={{ background: it.color }} title={it.title}>
                          {it.title}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
            {/* The hours. */}
            <div ref={grid} className="relative max-h-[calc(100dvh-14rem)] min-h-80 overflow-y-auto">
              <div className="grid grid-cols-[3rem_repeat(7,1fr)]" style={{ height: 24 * HOUR }}>
                <div className="relative">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-zinc-400" style={{ top: h * HOUR }}>
                      {h ? `${h}:00` : ""}
                    </div>
                  ))}
                </div>
                {days.map((d) => (
                  <div
                    key={d}
                    className="relative cursor-pointer border-l border-zinc-100 dark:border-zinc-800"
                    style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, rgb(161 161 170 / 0.18) ${HOUR - 1}px, rgb(161 161 170 / 0.18) ${HOUR}px)` }}
                    onClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      newAt(d, e.clientY - e.currentTarget.getBoundingClientRect().top);
                    }}
                  >
                    {d === nowDay && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: (minutesOfDay(now) / 60) * HOUR }} />}
                    {lanes(items.filter((it) => !it.allDay && it.start.slice(0, 10) <= d && it.end > d)).map((it) => {
                      const from = it.start.slice(0, 10) < d ? 0 : minutesOfDay(it.start);
                      const to = it.end.slice(0, 10) > d ? 24 * 60 : Math.max(from + 15, minutesOfDay(it.end));
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => {
                            setDraft(null);
                            setPicked(it);
                          }}
                          className={`absolute flex flex-col justify-start overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight ${it.proposed ? "border-2 border-dashed" : "border-l-4"} ${it.event?.showAs === "free" || it.event?.response === "declined" ? "opacity-50" : ""}`}
                          style={{
                            top: (from / 60) * HOUR,
                            height: Math.max(18, ((to - from) / 60) * HOUR - 2),
                            left: `calc(${(it.lane / it.of) * 100}% + 1px)`,
                            width: `calc(${100 / it.of}% - 2px)`,
                            borderColor: it.color,
                            background: `${it.color}26`,
                          }}
                          title={`${timeText(it.start)}–${timeText(it.end)} ${it.title}`}
                        >
                          <span className="block truncate font-medium">{it.proposed ? `Vorschlag: ${it.title}` : it.title}</span>
                          <span className="block truncate text-zinc-500">
                            {timeText(it.start)}–{timeText(it.end)}
                            {it.event?.location ? ` · ${it.event.location}` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {(picked || draft) && (
        <aside className="card fixed inset-x-4 bottom-4 z-30 max-h-[60vh] space-y-2 overflow-y-auto p-3 text-sm shadow-lg sm:left-auto sm:w-80">
          {picked && (
            <>
              <div className="flex items-start gap-2">
                <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: picked.color }} />
                <p className="min-w-0 flex-1 font-medium">{picked.title}</p>
                <button type="button" className="icon-btn" onClick={() => setPicked(null)} aria-label="Schließen">
                  ×
                </button>
              </div>
              <p className="text-zinc-500">
                {picked.allDay
                  ? `${dateOf(picked.start).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })} · ganztägig`
                  : `${dateOf(picked.start).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} – ${timeText(picked.end)}`}
              </p>
              {picked.calendar && (
                <p className="text-xs text-zinc-500">
                  {picked.calendar.name} · {SOURCE_LABELS[picked.calendar.source]}
                  {picked.event?.showAs && picked.event.showAs !== "busy" ? ` · ${picked.event.showAs}` : ""}
                </p>
              )}
              {picked.event?.location && <p>📍 {picked.event.location}</p>}
              {picked.event?.organizer && <p className="text-xs text-zinc-500">Organisiert von {picked.event.organizer}</p>}
              {picked.event?.description && <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-300">{picked.event.description}</p>}
              {picked.event?.todoId && (
                <Link href={`/t/${picked.event.todoId}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                  Zum Todo
                </Link>
              )}
              {picked.proposed && (
                <p className="text-xs text-zinc-500">
                  Vorgeschlagen für{" "}
                  <Link href={`/t/${picked.proposed.todoId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {picked.proposed.todoRef}
                  </Link>{" "}
                  „{picked.proposed.todoText}“ — {picked.proposed.target}. Eintragen tust du ihn am Todo.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {picked.event?.url && (
                  <a href={picked.event.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                    In {picked.calendar ? SOURCE_LABELS[picked.calendar.source] : "der Quelle"} öffnen
                  </a>
                )}
                {picked.calendar?.source === "zeff" && picked.event && (
                  <button
                    type="button"
                    className="btn btn-sm text-red-600 dark:text-red-400"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        if (done(await deleteEventAction(picked.event!.id))) setPicked(null);
                      })
                    }
                  >
                    Löschen
                  </button>
                )}
              </div>
            </>
          )}
          {draft && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  if (done(await saveEventAction({ calendarId: draft.calendarId, title: draft.title, start: draft.start, end: plusMinutes(draft.start, draft.minutes) }))) setDraft(null);
                });
              }}
            >
              <p className="font-medium">Neuer Termin</p>
              <input className="input w-full" placeholder="Titel" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required autoFocus />
              <input type="datetime-local" className="input w-full" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required />
              <select className="input w-full" value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
              <select className="input w-full" value={draft.calendarId} onChange={(e) => setDraft({ ...draft, calendarId: Number(e.target.value) })}>
                {own.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !draft.title.trim()}>
                  Eintragen
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>
                  Abbrechen
                </button>
              </div>
            </form>
          )}
        </aside>
      )}
    </>
  );
}
