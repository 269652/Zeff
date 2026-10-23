/**
 * The calendars' actions for Auto-Aktionen: an appointment for a todo — in one of Zeff's own
 * calendars (Kalender's extension: entered on your click) or in Google Calendar (its extension: the
 * click opens Google's form, filled in; you save it). Client-safe.
 */
import { pad2 as two } from "@/lib/text";
import { formatDayTime } from "@/lib/format";
import type { T } from "@/lib/i18n/shared";
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/boards/shared" {
  interface TodoOpMap {
  /** An appointment entered in one of Zeff's own calendars (by name; "": the first) — local start "YYYY-MM-DDTHH:MM". */
  "calendar-entry": { calendar: string; title: string; start: string; minutes: number; body: string };
  /** An appointment opened in Google Calendar, filled in (you save it) — local start "YYYY-MM-DDTHH:MM". */
  "gcal-event": { title: string; start: string; minutes: number; body: string };
  }
}

/** "2026-10-13 10:00" / "2026-10-13T10:00" → local "2026-10-13T10:00" (null: not a time); plus minutes. */
export const localStamp = (v: string, plus = 0): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + plus);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};
const minutesOf = (v: unknown) => Math.min(600, Math.max(15, Math.round(Number(str(v)) || 30)));
const when = (start: string, minutes: number, t: T) => `${formatDayTime(start)} · ${t("{n} min", { n: minutes })}`;
/** Google's form takes times as "20261013T100000" (local, in the time zone given). */
const gdate = (stamp: string) => stamp.replace(/[-:]/g, "") + "00";

const FIELDS = {
  title: "der Titel des Termins — was dann zu tun ist (mit Ticket-Key, wenn es einen gibt)",
  start: "Beginn als JJJJ-MM-TT HH:MM — eine freie Zeit, nicht in der Vergangenheit; Privates abends oder am Wochenende, Behörden, Ärzte, Geschäfte zu ihren Zeiten",
  minutes: "die Dauer in Minuten (15–600)",
  body: "worum es geht, 1–3 Sätze",
};

export const CALENDAR_ACTIONS = [
  action({
    type: "calendar-entry",
    plugin: "calendar",
    label: "Event in the Zeff calendar",
    verb: "Add",
    offer: {
      when: "Ein Zeitblock, eine Erinnerung oder ein Termin für mich selbst (etwas erledigen, besorgen, vorbereiten; ein Datum, an dem es weitergeht) — eingetragen in meinen Zeff-Kalender (calendar: sein Name, leer: der erste).",
      fields: { calendar: "der Name des Zeff-Kalenders (leer: der erste)", ...FIELDS },
      example: { type: "calendar-entry", calendar: "", title: "Geschenk für Paula besorgen", start: "2026-10-14 18:00", minutes: "60", body: "Paula hat am 16.10. Geburtstag — Geschenk besorgen." },
    },
    clean: (o) => {
      const start = localStamp(str(o.start));
      return str(o.title) && start ? { type: "calendar-entry", calendar: str(o.calendar).slice(0, 80), title: str(o.title).slice(0, 250), start, minutes: minutesOf(o.minutes), body: str(o.body).slice(0, 4000) } : null;
    },
    title: (op, t = EN) => t("Event: {title}", { title: op.title }),
    note: (op, t = EN) => ({
      heading: op.calendar ? t("Event in the Zeff calendar “{calendar}”", { calendar: op.calendar }) : t("Event in the Zeff calendar"),
      detail: `${when(op.start, op.minutes, t)} · “${op.title}”`,
      body: op.body || null,
    }),
  }),
  action({
    type: "gcal-event",
    plugin: "google-calendar",
    label: "Event in Google Calendar",
    verb: "Open in Google",
    offer: {
      when: "Ein Termin, Zeitblock oder eine Erinnerung in meinem Google-Kalender (Privates, Verabredungen, Besorgungen, Fristen) — Google Calendar öffnet sich mit dem fertigen Termin; ich speichere ihn selbst.",
      fields: FIELDS,
      example: { type: "gcal-event", title: "Geschenk für Paula besorgen", start: "2026-10-14 18:00", minutes: "60", body: "Paula hat am 16.10. Geburtstag — Geschenk besorgen." },
    },
    clean: (o) => {
      const start = localStamp(str(o.start));
      return str(o.title) && start ? { type: "gcal-event", title: str(o.title).slice(0, 250), start, minutes: minutesOf(o.minutes), body: str(o.body).slice(0, 4000) } : null;
    },
    title: (op, t = EN) => t("Event: {title}", { title: op.title }),
    note: (op, t = EN) => ({ heading: t("Event in Google Calendar"), detail: `${when(op.start, op.minutes, t)} · “${op.title}”`, body: op.body || null }),
    // Google Calendar's "new appointment" form, filled in (times local, in this time zone) — saved by you.
    href: (op) =>
      `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(op.title)}&dates=${gdate(op.start)}/${gdate(localStamp(op.start, op.minutes) ?? op.start)}&details=${encodeURIComponent(op.body)}&ctz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
  }),
];
