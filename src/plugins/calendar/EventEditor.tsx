"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import type { CalendarView, SeriesScope } from "@/lib/calendar/ir-shared";
import { addDays, describeRecurrence, monthlyChoices, presets, weekdayOf, weekdayShort, type Frequency, type Recurrence } from "@/lib/calendar/recurrence";
import type { T } from "@/lib/i18n/shared";
import { deleteEventAction, saveEventAction } from "./server-actions";
import { durationText, local, minutesBetween, plus } from "./view-shared";

/** What the editor opens with: a new appointment (no id), or one to change (a series' occurrence: its day). */
export type EditorInit = {
  id?: number;
  calendarId: number;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  recurrence: Recurrence | null;
  occurrence?: string | null;
};

type Result = { ok: boolean; message?: string; error?: string } | null;

/** "Every n …": the units, one and several, in the language of `t`. */
const units = (t: T): Record<Frequency, [string, string]> => ({
  daily: [t("day"), t("days")],
  weekly: [t("week"), t("weeks")],
  monthly: [t("month"), t("months")],
  yearly: [t("year"), t("years")],
});
const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly", "yearly"];

/**
 * Which of these three a change to a series means — asked before it's saved or deleted. `title`:
 * the question ("Delete recurring event").
 */
export function ScopeChoice({ title, onPick, onCancel, pending }: { title: string; onPick: (s: SeriesScope) => void; onCancel: () => void; pending: boolean }) {
  const t = useT();
  const [scope, setScope] = useState<SeriesScope>("one");
  return (
    <div className="space-y-3">
      <p className="font-medium">{title}</p>
      <div className="space-y-1.5" role="radiogroup">
        {(
          [
            ["one", t("This event")],
            ["following", t("This and following events")],
            ["all", t("All events")],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} />
            {label}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => onPick(scope)} autoFocus>
          {t("OK")}
        </button>
      </div>
    </div>
  );
}

/**
 * A new appointment, or one of Zeff's own calendars changed: title, all day or from–to, calendar,
 * repeat (a preset or a rule of your own, ending never / on a day / after n times), place, notes.
 * A series' occurrence asks first: this one, it and the following, or all.
 */
export function EventEditor({ init, calendars, onClose, onDone }: { init: EditorInit; calendars: CalendarView[]; onClose: () => void; onDone: (r: Result) => void }) {
  const t = useT();
  const [v, setV] = useState(init);
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<null | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const title = useRef<HTMLInputElement>(null);
  const series = !!(init.id && init.occurrence);
  const firstStart = v.start;
  const options = useMemo(() => presets(firstStart, t), [firstStart, t]);
  const presetKey = (() => {
    if (!v.recurrence) return "none";
    const plain = JSON.stringify({ ...v.recurrence, until: undefined, count: undefined });
    return options.find((o) => o.rule && JSON.stringify({ ...o.rule, until: undefined, count: undefined }) === plain)?.key ?? "custom";
  })();
  const [custom, setCustom] = useState(presetKey === "custom");
  const set = (patch: Partial<EditorInit>) => setV((x) => ({ ...x, ...patch }));

  useEffect(() => {
    title.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  // From–to as the fields show it: dates and times apart; all day: the last day (inclusive).
  const startDay = v.start.slice(0, 10);
  const startTime = v.allDay ? "09:00" : v.start.slice(11, 16);
  const endDay = v.allDay ? addDays(v.end.slice(0, 10), -1) : v.end.slice(0, 10);
  const endTime = v.allDay ? "10:00" : v.end.slice(11, 16);
  const minutes = v.allDay ? 0 : minutesBetween(v.start, v.end);
  const setStart = (day: string, time: string) => {
    // The end keeps its distance.
    if (v.allDay) {
      const span = Math.max(1, Math.round(minutesBetween(v.start, v.end) / 1440));
      set({ start: day, end: addDays(day, span) });
    } else {
      const s = `${day}T${time}`;
      set({ start: s, end: plus(s, Math.max(15, minutes)) });
    }
  };
  const setEnd = (day: string, time: string) => (v.allDay ? set({ end: addDays(day < startDay ? startDay : day, 1) }) : set({ end: `${day}T${time}` }));
  const toggleAllDay = (on: boolean) =>
    on ? set({ allDay: true, start: startDay, end: addDays(endDay < startDay ? startDay : endDay, 1) }) : set({ allDay: false, start: `${startDay}T09:00`, end: `${startDay}T10:00` });

  const rule = v.recurrence;
  const setRule = (patch: Partial<Recurrence> | null) => set({ recurrence: patch === null ? null : ({ ...(rule ?? { freq: "weekly", interval: 1 }), ...patch } as Recurrence) });
  const ends = rule?.until ? "on" : rule?.count ? "after" : "never";

  const finish = (r: Result) => {
    if (r?.ok) onDone(r);
    else setError(r?.error ?? t("That didn't work."));
  };
  const save = (scope?: SeriesScope) =>
    start(async () =>
      finish(
        await saveEventAction({
          id: v.id,
          calendarId: v.calendarId,
          title: v.title,
          start: v.start,
          end: v.end,
          allDay: v.allDay,
          location: v.location,
          description: v.description,
          recurrence: v.recurrence,
          occurrence: series ? init.occurrence : null,
          scope,
        }),
      ),
    );
  const remove = (scope?: SeriesScope) => start(async () => finish(await deleteEventAction(v.id!, series && scope ? { occurrence: init.occurrence!, scope } : undefined)));
  const calendar = calendars.find((c) => c.id === v.calendarId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-0 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={v.id ? t("Edit event") : t("New event")} className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-4 shadow-2xl sm:rounded-xl">
        {asking ? (
          <ScopeChoice title={asking === "save" ? t("Edit recurring event") : t("Delete recurring event")} pending={pending} onCancel={() => setAsking(null)} onPick={(s) => (asking === "save" ? save(s) : remove(s))} />
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (series) setAsking("save");
              else save();
            }}
          >
            <div className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: calendar?.color ?? "#7A869A" }} />
              <input ref={title} className="w-full border-0 border-b border-zinc-200 bg-transparent py-1 text-lg font-semibold outline-none focus:border-indigo-500 dark:border-zinc-700" placeholder={t("Add title")} value={v.title} onChange={(e) => set({ title: e.target.value })} required />
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={v.allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
              {t("All day")}
            </label>
            <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-2 text-sm">
              <span className="text-zinc-500">{t("From")}</span>
              <input type="date" className="input" value={startDay} onChange={(e) => e.target.value && setStart(e.target.value, startTime)} required />
              {!v.allDay ? <input type="time" step={300} className="input w-28" value={startTime} onChange={(e) => e.target.value && setStart(startDay, e.target.value)} required /> : <span />}
              <span className="text-zinc-500">{t("To")}</span>
              <input type="date" className="input" value={endDay} min={startDay} onChange={(e) => e.target.value && setEnd(e.target.value, endTime)} required />
              {!v.allDay ? <input type="time" step={300} className="input w-28" value={endTime} onChange={(e) => e.target.value && setEnd(endDay, e.target.value)} required /> : <span />}
            </div>
            {!v.allDay && minutes > 0 && <p className="-mt-1 pl-14 text-xs text-zinc-500">{durationText(minutes, t)}</p>}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="label">{t("Calendar")}</span>
                <select className="input" value={v.calendarId} disabled={!!v.id} onChange={(e) => set({ calendarId: Number(e.target.value) })}>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="label">{t("Repeat")}</span>
                <select
                  className="input"
                  value={custom ? "custom" : presetKey}
                  onChange={(e) => {
                    const k = e.target.value;
                    if (k === "custom") {
                      setCustom(true);
                      if (!rule) setRule({ freq: "weekly", interval: 1, byDay: [weekdayOf(local(startDay))] });
                      return;
                    }
                    setCustom(false);
                    const o = options.find((x) => x.key === k);
                    set({ recurrence: o?.rule ? { ...o.rule, ...(rule?.until ? { until: rule.until } : rule?.count ? { count: rule.count } : {}) } : null });
                  }}
                >
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                  <option value="custom">{t("Custom…")}</option>
                </select>
              </label>
            </div>

            {rule && (
              <div className="space-y-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                {custom && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-zinc-500">{t("Every")}</span>
                      <input type="number" min={1} max={99} className="input w-16" value={rule.interval} onChange={(e) => setRule({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
                      <select className="input w-auto" value={rule.freq} onChange={(e) => setRule({ freq: e.target.value as Frequency, byDay: e.target.value === "weekly" ? [weekdayOf(local(startDay))] : undefined, monthlyBy: undefined })}>
                        {FREQUENCIES.map((f) => (
                          <option key={f} value={f}>
                            {units(t)[f][rule.interval === 1 ? 0 : 1]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {rule.freq === "weekly" && (
                      <div className="flex flex-wrap gap-1" role="group" aria-label={t("On these days")}>
                        {weekdayShort(t).map((d, i) => {
                          const on = (rule.byDay ?? [weekdayOf(local(startDay))]).includes(i);
                          return (
                            <button
                              key={i}
                              type="button"
                              aria-pressed={on}
                              onClick={() => {
                                const cur = rule.byDay ?? [weekdayOf(local(startDay))];
                                const next = on ? cur.filter((x) => x !== i) : [...cur, i].sort();
                                if (next.length) setRule({ byDay: next });
                              }}
                              className={`size-8 rounded-full text-xs font-medium ${on ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}
                            >
                              {d.slice(0, 2)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {rule.freq === "monthly" && (
                      <select className="input w-auto" value={rule.monthlyBy ?? "day"} onChange={(e) => setRule({ monthlyBy: e.target.value === "weekday" ? "weekday" : "day" })}>
                        {monthlyChoices(v.start, t).map((o) => (
                          <option key={o.by} value={o.by}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-zinc-500">{t("Ends")}</span>
                  <select
                    className="input w-auto"
                    value={ends}
                    onChange={(e) => {
                      const { until: _u, count: _c, ...rest } = rule;
                      set({ recurrence: e.target.value === "on" ? { ...rest, until: addDays(startDay, 90) } : e.target.value === "after" ? { ...rest, count: 10 } : rest });
                    }}
                  >
                    <option value="never">{t("Never")}</option>
                    <option value="on">{t("On")}</option>
                    <option value="after">{t("After")}</option>
                  </select>
                  {ends === "on" && <input type="date" className="input w-auto" min={startDay} value={rule.until} onChange={(e) => e.target.value && setRule({ until: e.target.value })} />}
                  {ends === "after" && (
                    <>
                      <input type="number" min={1} max={999} className="input w-20" value={rule.count} onChange={(e) => setRule({ count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} />
                      <span className="text-zinc-500">{t("times")}</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-zinc-500">{describeRecurrence(rule, v.start, t)}</p>
              </div>
            )}

            <input className="input" placeholder={t("Add location")} value={v.location} onChange={(e) => set({ location: e.target.value })} />
            <textarea className="input min-h-20 resize-y" placeholder={t("Add description")} value={v.description} onChange={(e) => set({ description: e.target.value })} />

            {error && <p className="alert-error text-sm">{error}</p>}
            <div className="flex items-center gap-2 pt-1">
              {v.id && (
                <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" disabled={pending} onClick={() => (series ? setAsking("delete") : remove())}>
                  {t("Delete")}
                </button>
              )}
              <span className="flex-1" />
              <button type="button" className="btn btn-sm" onClick={onClose}>
                {t("Cancel")}
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !v.title.trim()}>
                {pending ? t("Saving…") : t("Save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
