import { useState } from "react";
import type { REvent } from "@/lib/replica/shared";
import { expand, parseRecurrence, addDays } from "@/lib/calendar/recurrence";
import { useReplica } from "./main";
import { fmtDay, today, tr } from "./words";

type Shown = { ev: REvent; start: string; end: string; series: boolean };

/** The calendar from the phone's copy: a week back, two months ahead, day by day; Zeff's own events editable. */
export function CalendarView() {
  const { engine } = useReplica();
  const [open, setOpen] = useState<string | "new" | null>(null);
  const cals = engine.list("calendar");
  const visible = new Set(cals.filter((c) => c.visible).map((c) => c.id));
  const from = addDays(today(), -7);
  const to = addDays(today(), 60);
  const shown: Shown[] = [];
  for (const ev of engine.list("event")) {
    if (ev.cancelled || (cals.length && !visible.has(ev.calendarId))) continue;
    const rule = ev.recurrence ? parseRecurrence(ev.recurrence) : null;
    if (rule) for (const o of expand(ev, rule, ev.exdates, from, to)) shown.push({ ev, start: o.start, end: o.end, series: true });
    else if (ev.start < to && ev.end >= from) shown.push({ ev, start: ev.start, end: ev.end, series: false });
  }
  shown.sort((a, b) => a.start.localeCompare(b.start));
  const days = new Map<string, Shown[]>();
  for (const s of shown) days.set(s.start.slice(0, 10), [...(days.get(s.start.slice(0, 10)) ?? []), s]);
  const color = (id: number) => cals.find((c) => c.id === id)?.color ?? "gray";

  const ev = open && open !== "new" ? engine.list("event").find((e) => e.ref === open) : undefined;
  if (open === "new" || ev) return <EventForm ev={ev} onBack={() => setOpen(null)} />;

  return (
    <div className="zo-page">
      <button type="button" className="zo-btn" onClick={() => setOpen("new")}>
        + {tr("New event")}
      </button>
      {!days.size && <p className="zo-muted">{tr("noEvents")}</p>}
      {[...days].map(([day, list]) => (
        <section key={day}>
          <h2 className={`zo-h ${day === today() ? "zo-today" : ""}`}>{fmtDay(day)}</h2>
          <ul className="zo-list">
            {list.map((s) => (
              <li key={`${s.ev.ref}@${s.start}`}>
                <button type="button" className="zo-row" onClick={() => setOpen(s.ev.ref)}>
                  <span className={`zo-swatch c-${color(s.ev.calendarId)}`} aria-hidden />
                  <strong>{s.ev.title}</strong>
                  <small>
                    {[s.ev.allDay ? tr("All day") : `${s.start.slice(11, 16)}–${s.end.slice(11, 16)}`, s.ev.location, s.series ? "↻" : null].filter(Boolean).join(" · ")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EventForm({ ev, onBack }: { ev?: REvent; onBack: () => void }) {
  const { engine, edit } = useReplica();
  const own = engine.list("calendar").filter((c) => c.editable);
  const cal = ev ? engine.list("calendar").find((c) => c.id === ev.calendarId) : own[0];
  const series = !!ev?.recurrence;
  const editable = !!cal?.editable && !series;
  const day = today();
  const [v, setV] = useState({
    calendarId: ev?.calendarId ?? own[0]?.id ?? 0,
    title: ev?.title ?? "",
    allDay: ev?.allDay ?? false,
    start: ev?.start ?? `${day}T09:00`,
    end: ev?.end ?? `${day}T10:00`,
    location: ev?.location ?? "",
    description: ev?.description ?? "",
  });
  const stamp = (s: string) => (v.allDay ? s.slice(0, 10) : s.length === 10 ? `${s}T09:00` : s.slice(0, 16));
  const save = async () => {
    const start = stamp(v.start);
    const end = stamp(v.end) < start ? start : stamp(v.end);
    if (!v.title.trim()) return;
    if (!ev) await edit({ kind: "event.add", calendarId: v.calendarId, title: v.title.trim(), start, end, allDay: v.allDay, location: v.location, description: v.description });
    else
      for (const [field, value] of [["title", v.title.trim()], ["start", start], ["end", end], ["allDay", v.allDay], ["location", v.location], ["description", v.description]] as const)
        if ((ev as Record<string, unknown>)[field] !== value) await edit({ kind: "event.set", event: ev.ref, field, value });
    onBack();
  };
  if (!ev && !own.length)
    return (
      <div className="zo-page">
        <button type="button" className="zo-back" onClick={onBack}>
          ← {tr("Back")}
        </button>
        <p className="zo-muted">{tr("noOwnCalendar")}</p>
      </div>
    );
  return (
    <div className="zo-page">
      <button type="button" className="zo-back" onClick={onBack}>
        ← {tr("Back")}
      </button>
      {!editable && <p className="zo-muted">{series ? tr("series") : tr("notEditable")}</p>}
      <fieldset disabled={!editable} className="zo-form">
        {!ev && own.length > 1 && (
          <label className="zo-field">
            <span>{tr("Calendar2")}</span>
            <select value={v.calendarId} onChange={(e) => setV({ ...v, calendarId: Number(e.target.value) })}>
              {own.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="zo-field">
          <span>{tr("Title")}</span>
          <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </label>
        <label className="zo-check">
          <input type="checkbox" checked={v.allDay} onChange={(e) => setV({ ...v, allDay: e.target.checked })} /> {tr("All day")}
        </label>
        <label className="zo-field">
          <span>{tr("Start")}</span>
          <input type={v.allDay ? "date" : "datetime-local"} value={v.allDay ? v.start.slice(0, 10) : stamp(v.start)} onChange={(e) => setV({ ...v, start: e.target.value })} />
        </label>
        <label className="zo-field">
          <span>{tr("End")}</span>
          <input type={v.allDay ? "date" : "datetime-local"} value={v.allDay ? v.end.slice(0, 10) : stamp(v.end)} onChange={(e) => setV({ ...v, end: e.target.value })} />
        </label>
        <label className="zo-field">
          <span>{tr("Location")}</span>
          <input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
        </label>
        <label className="zo-field">
          <span>{tr("Description")}</span>
          <textarea rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </label>
      </fieldset>
      {editable && (
        <div className="zo-actions">
          <button type="button" className="zo-btn primary" onClick={() => void save()} disabled={!v.title.trim()}>
            {tr("Save")}
          </button>
          {ev && (
            <button
              type="button"
              className="zo-btn zo-danger"
              onClick={() => {
                if (!confirm(`${tr("Delete")}: ${ev.title}?`)) return;
                void edit({ kind: "event.delete", event: ev.ref });
                onBack();
              }}
            >
              {tr("Delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
