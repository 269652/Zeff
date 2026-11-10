import { useState } from "react";
import type { RCalendar, REvent } from "@/lib/replica/shared";
import { expand, parseRecurrence, addDays } from "@/lib/calendar/recurrence";
import { useReplica } from "./main";
import { fmtDay, today, tr } from "./words";

type Shown = { ev: REvent; start: string; end: string; series: boolean };
type Open = { ref: string } | { day: string } | null;

const GRAY = "#7A869A";
/** Zeff's .icon-btn spelled out (the companion's own app.css has an .icon-btn of its own, framed). */
const ICON = "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:disabled:text-zinc-700";
const local = (stamp: string) => new Date(stamp.length === 10 ? `${stamp}T00:00` : stamp.slice(0, 16));
const pad = (n: number) => String(n).padStart(2, "0");
const stampOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const plus = (stamp: string, minutes: number) => stampOf(new Date(local(stamp).getTime() + minutes * 60000));
const minutesBetween = (a: string, b: string) => Math.round((local(b).getTime() - local(a).getTime()) / 60000);
/** Monday of the week a day is in. */
const weekOf = (day: string) => addDays(day, -((local(day).getDay() + 6) % 7));
const weekday = (day: string, style: "long" | "short" | "narrow") => local(day).toLocaleDateString(undefined, { weekday: style });
const dayMonth = (day: string) => local(day).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** On a day, as Zeff's calendar has it (view-shared.ts itemOn): all day up to its (exclusive) end; else the days it touches. */
const on = (s: Shown, day: string) => (s.ev.allDay ? s.start.slice(0, 10) <= day && (s.end.slice(0, 10) > day || s.start.slice(0, 10) === day) : s.start.slice(0, 10) <= day && (s.end > `${day}T00:00` || s.start.slice(0, 10) === day));

/** The calendar from the phone's copy as Zeff's on a phone: a week to page through, or the coming weeks as a list; Zeff's own events editable. */
export function CalendarView() {
  const { engine } = useReplica();
  const [open, setOpen] = useState<Open>(null);
  const [mode, setMode] = useState<"list" | "week">(() => (sessionStorage.getItem("zeff.offline.calmode") === "week" ? "week" : "list"));
  const day = today();
  const [week, setWeek] = useState(() => weekOf(day));
  const cals = engine.list("calendar");
  const visible = new Set(cals.filter((c) => c.visible).map((c) => c.id));
  // The list: a week back, two months ahead (what the copy holds); the week: its seven days.
  const from = mode === "week" ? week : addDays(day, -7);
  const to = mode === "week" ? addDays(week, 7) : addDays(day, 60);
  const shown: Shown[] = [];
  for (const ev of engine.list("event")) {
    if (ev.cancelled || (cals.length && !visible.has(ev.calendarId))) continue;
    const rule = ev.recurrence ? parseRecurrence(ev.recurrence) : null;
    if (rule) for (const o of expand(ev, rule, ev.exdates, from, to)) shown.push({ ev, start: o.start, end: o.end, series: true });
    else if (ev.start < to && (ev.end >= from || ev.start >= from)) shown.push({ ev, start: ev.start, end: ev.end, series: false });
  }
  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const groups = days
    .map((d) => ({ d, list: shown.filter((s) => on(s, d)).sort((a, b) => Number(b.ev.allDay) - Number(a.ev.allDay) || a.start.localeCompare(b.start)) }))
    .filter((g) => mode === "week" || g.list.length);
  const calOf = (id: number) => cals.find((c) => c.id === id);
  const canAdd = cals.some((c) => c.editable);

  const ev = open && "ref" in open ? engine.list("event").find((e) => e.ref === open.ref) : undefined;
  if (open && ("day" in open || ev)) return <EventForm ev={ev} day={"day" in open ? open.day : undefined} onBack={() => setOpen(null)} />;

  const pick = (m: "list" | "week") => {
    setMode(m);
    try {
      sessionStorage.setItem("zeff.offline.calmode", m);
    } catch {
      /* (only a convenience) */
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900" role="tablist">
          {(["list", "week"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={`min-h-8 rounded-md px-3 text-sm ${mode === m ? "bg-white font-medium text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}`} onClick={() => pick(m)}>
              {tr(m === "list" ? "List" : "Week")}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary ml-auto" onClick={() => setOpen({ day: mode === "week" && !(day >= week && day < addDays(week, 7)) ? week : day })}>
          + {tr("New event")}
        </button>
      </div>
      {mode === "week" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <button type="button" className={`${ICON} size-9 text-lg`} aria-label={tr("Previous week")} title={tr("Previous week")} onClick={() => setWeek(addDays(week, -7))}>
              ‹
            </button>
            <p className="min-w-0 flex-1 text-center text-sm font-semibold">
              {dayMonth(week)} – {dayMonth(addDays(week, 6))}
            </p>
            <button type="button" className={`${ICON} size-9 text-lg`} aria-label={tr("Next week")} title={tr("Next week")} onClick={() => setWeek(addDays(week, 7))}>
              ›
            </button>
            <button type="button" className="btn btn-sm" disabled={week === weekOf(day)} onClick={() => setWeek(weekOf(day))}>
              {tr("Today")}
            </button>
          </div>
          {/* The week's strip: a day each, a dot where something is on. */}
          <div className="card grid grid-cols-7 p-1">
            {groups.map(({ d, list }) => (
              <a key={d} href={`#zo-day-${d}`} className="flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={fmtDay(d)}>
                <span className="text-zinc-500 dark:text-zinc-400">{weekday(d, "narrow")}</span>
                <span className={`flex size-7 items-center justify-center rounded-full text-sm tabular-nums ${d === day ? "bg-indigo-600 font-semibold text-white dark:bg-indigo-500" : "font-medium"}`}>{Number(d.slice(8, 10))}</span>
                <span className={`size-1 rounded-full ${list.length ? "bg-indigo-500 dark:bg-indigo-400" : "bg-transparent"}`} aria-hidden />
              </a>
            ))}
          </div>
        </div>
      )}
      {!groups.length && <p className="px-1 text-sm text-zinc-500">{tr("noEvents")}</p>}
      {groups.map(({ d, list }) => (
        <section key={d} id={`zo-day-${d}`} className="scroll-mt-14">
          <h2 className={`mb-1 flex items-center gap-1.5 px-1 text-xs font-medium ${d === day ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-400"}`}>
            {d === day && <span className="size-1.5 rounded-full bg-indigo-500" aria-hidden />}
            <span className={d === day ? "font-semibold" : ""}>{d === day ? tr("Today") : weekday(d, "long")}</span>
            <span className="text-zinc-400">{dayMonth(d)}</span>
            {canAdd && (
              <button type="button" className={`${ICON} ml-auto size-8 text-base`} aria-label={`${tr("New event")} · ${fmtDay(d)}`} title={tr("New event")} onClick={() => setOpen({ day: d })}>
                +
              </button>
            )}
          </h2>
          {list.length ? (
            <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
              {list.map((s) => (
                <EventItem key={`${s.ev.ref}@${s.start}`} s={s} day={d} cal={calOf(s.ev.calendarId)} onOpen={() => setOpen({ ref: s.ev.ref })} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-2.5 text-sm text-zinc-400 dark:border-zinc-800">{tr("Free")}</p>
          )}
        </section>
      ))}
    </div>
  );
}

/** An event as Zeff's agenda shows it (AgendaList.tsx): its times, its calendar's colour, title and place. */
function EventItem({ s, day, cal, onOpen }: { s: Shown; day: string; cal?: RCalendar; onOpen: () => void }) {
  const { engine } = useReplica();
  const waiting = engine.pending().some((o) => (o as { event?: unknown; tmp?: unknown }).event === s.ev.ref || (o as { tmp?: unknown }).tmp === s.ev.ref);
  const from = s.start.slice(0, 10) < day ? "…" : s.start.slice(11, 16);
  const until = s.end.slice(0, 10) > day ? "…" : s.end.slice(11, 16);
  return (
    <li data-zo="event">
      <button type="button" className="flex w-full cursor-pointer items-stretch gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60" onClick={onOpen}>
        <span className="flex w-12 shrink-0 flex-col pt-px text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
          {s.ev.allDay ? (
            <span>{tr("All day")}</span>
          ) : (
            <>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{from}</span>
              <span>{until}</span>
            </>
          )}
        </span>
        <span className="w-1 shrink-0 rounded-full" style={{ background: cal?.color || GRAY }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium text-zinc-900 dark:text-zinc-100">
            {s.series && (
              <span className="mr-1 text-zinc-400" aria-label={tr("Series")}>
                ↻
              </span>
            )}
            {s.ev.title || tr("Untitled")}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-zinc-500 dark:text-zinc-400">
            {[s.ev.location, cal?.name].filter(Boolean).map((x, i) => (
              <span key={i} className="min-w-0 truncate">
                {i > 0 && "· "}
                {x}
              </span>
            ))}
            {waiting && <span className="rounded-full bg-indigo-50 px-1.5 leading-5 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{tr("pending")}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Zeff's event editor (EventEditor.tsx) for a phone: title, calendar, all day, from–to (dates and times apart), place, description. */
function EventForm({ ev, day: startDayIn, onBack }: { ev?: REvent; day?: string; onBack: () => void }) {
  const { engine, edit } = useReplica();
  const all = engine.list("calendar");
  const own = all.filter((c) => c.editable);
  const series = !!ev?.recurrence;
  const d0 = startDayIn ?? today();
  const [v, setV] = useState(() => {
    const allDay = ev?.allDay ?? false;
    const start = ev ? (allDay ? ev.start.slice(0, 10) : ev.start.slice(0, 16)) : `${d0}T09:00`;
    const end = ev ? (allDay ? ev.end.slice(0, 10) : ev.end.slice(0, 16)) : `${d0}T10:00`;
    return { calendarId: ev?.calendarId ?? own[0]?.id ?? 0, title: ev?.title ?? "", allDay, start, end, location: ev?.location ?? "", description: ev?.description ?? "" };
  });
  const cal = all.find((c) => c.id === v.calendarId);
  // A series: its words (title, place, description) for all its dates here; its times only on the PC (they'd move it).
  const editable = ev ? !!cal?.editable : own.length > 0;
  const set = (patch: Partial<typeof v>) => setV((cur) => ({ ...cur, ...patch }));

  // From–to as the fields show it: dates and times apart; all day: the last day (inclusive).
  const startDay = v.start.slice(0, 10);
  const startTime = v.allDay ? "09:00" : v.start.slice(11, 16) || "09:00";
  const lastDay = v.allDay ? addDays(v.end.slice(0, 10), -1) : v.end.slice(0, 10);
  const endDay = lastDay < startDay ? startDay : lastDay;
  const endTime = v.allDay ? "10:00" : v.end.slice(11, 16) || "10:00";
  const minutes = v.allDay ? 0 : minutesBetween(v.start, v.end);
  const setStart = (dayV: string, time: string) => {
    // The end keeps its distance.
    if (v.allDay) set({ start: dayV, end: addDays(dayV, Math.max(1, Math.round(minutesBetween(v.start, v.end) / 1440))) });
    else {
      const s = `${dayV}T${time}`;
      set({ start: s, end: plus(s, Math.max(15, minutes)) });
    }
  };
  const setEnd = (dayV: string, time: string) => (v.allDay ? set({ end: addDays(dayV < startDay ? startDay : dayV, 1) }) : set({ end: `${dayV}T${time}` }));
  const toggleAllDay = (allDay: boolean) => (allDay ? set({ allDay, start: startDay, end: addDays(endDay, 1) }) : set({ allDay, start: `${startDay}T09:00`, end: `${startDay}T10:00` }));

  const save = async () => {
    if (!v.title.trim()) return;
    const start = v.start;
    const end = v.allDay ? (v.end <= start ? addDays(start, 1) : v.end) : v.end < start ? start : v.end;
    if (!ev) await edit({ kind: "event.add", calendarId: v.calendarId, title: v.title.trim(), start, end, allDay: v.allDay, location: v.location, description: v.description });
    else {
      const was: Record<string, unknown> = { ...ev, start: ev.allDay ? ev.start.slice(0, 10) : ev.start.slice(0, 16), end: ev.allDay ? ev.end.slice(0, 10) : ev.end.slice(0, 16) };
      const fields = [["title", v.title.trim()], ...(series ? [] : ([["start", start], ["end", end], ["allDay", v.allDay]] as const)), ["location", v.location], ["description", v.description]] as const;
      for (const [field, value] of fields) if (was[field] !== value) await edit({ kind: "event.set", event: ev.ref, field, value });
    }
    onBack();
  };

  const backBtn = (
    <button type="button" className="flex min-h-9 items-center text-sm text-zinc-500 hover:underline" onClick={onBack}>
      ← {tr("Calendar")}
    </button>
  );
  if (!ev && !own.length)
    return (
      <div className="space-y-3">
        {backBtn}
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{tr("noOwnCalendar")}</p>
      </div>
    );
  const note = "rounded-lg border px-3 py-2 text-sm";
  return (
    <div className="space-y-3">
      {backBtn}
      {!editable && <p className={`${note} border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400`}>{tr("notEditable")}</p>}
      {editable && series && <p className={`${note} border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300`}>↻ {tr("seriesWords")}</p>}
      <form
        className="card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!editable} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: cal?.color || GRAY }} aria-hidden />
            <input
              className="w-full min-w-0 border-0 border-b border-zinc-200 bg-transparent py-1 text-lg font-semibold outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700"
              aria-label={tr("Title")}
              placeholder={tr("Add title")}
              value={v.title}
              autoFocus={!ev}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          {!ev && own.length > 1 ? (
            <label className="block">
              <span className="label">{tr("Calendar2")}</span>
              <select className="input" value={v.calendarId} onChange={(e) => set({ calendarId: Number(e.target.value) })}>
                {own.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            cal && <p className="text-xs text-zinc-500 dark:text-zinc-400">{cal.name}</p>
          )}
          <fieldset disabled={series || !editable} className="space-y-3">
            <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 cursor-pointer accent-indigo-600" checked={v.allDay} onChange={(e) => toggleAllDay(e.target.checked)} /> {tr("All day")}
            </label>
            <div className={`grid items-center gap-2 text-sm ${v.allDay ? "grid-cols-[3rem_1fr]" : "grid-cols-[3rem_1fr_6.5rem]"}`}>
              <span className="text-zinc-600 dark:text-zinc-400">{tr("From")}</span>
              <input type="date" className="input" value={startDay} aria-label={tr("Start")} onChange={(e) => e.target.value && setStart(e.target.value, startTime)} />
              {!v.allDay && <input type="time" step={300} className="input" value={startTime} aria-label={tr("Start")} onChange={(e) => e.target.value && setStart(startDay, e.target.value)} />}
              <span className="text-zinc-600 dark:text-zinc-400">{tr("To")}</span>
              <input type="date" className="input" value={endDay} min={startDay} aria-label={tr("End")} onChange={(e) => e.target.value && setEnd(e.target.value, endTime)} />
              {!v.allDay && <input type="time" step={300} className="input" value={endTime} aria-label={tr("End")} onChange={(e) => e.target.value && setEnd(endDay, e.target.value)} />}
            </div>
          </fieldset>
          <label className="block">
            <span className="label">{tr("Location")}</span>
            <input className="input" value={v.location} onChange={(e) => set({ location: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">{tr("Description")}</span>
            <textarea className="input" rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
        </fieldset>
        {editable && (
          <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            {ev && !series && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (!confirm(`${tr("Delete")}: ${ev.title}?`)) return;
                  void edit({ kind: "event.delete", event: ev.ref });
                  onBack();
                }}
              >
                {tr("Delete")}
              </button>
            )}
            <button type="button" className="btn ml-auto" onClick={onBack}>
              {tr("Cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!v.title.trim()}>
              {tr("Save")}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
