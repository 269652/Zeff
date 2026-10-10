"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";

/** The Kalender app: its server actions (each answers an ActionState). */

const off = async () => (!(await import("@/plugins/state")).isInstalled("calendar") ? "Der Kalender ist nicht installiert (Menü → Plugins)." : null);
const run = async (fn: () => Promise<string> | string): Promise<ActionState> => {
  try {
    const no = await off();
    if (no) return { ok: false, error: no };
    const message = await fn();
    revalidateAll();
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
};

/** A calendar shown or hidden, recoloured, renamed (Zeff's own), counted as busy, offered for booking. */
export async function updateCalendarAction(id: number, patch: { name?: string; color?: string; visible?: boolean; busy?: boolean; book?: boolean }): Promise<ActionState> {
  return run(async () => {
    const c = (await import("@/lib/calendar/ir")).updateCalendar(Number(id), {
      name: typeof patch.name === "string" ? patch.name : undefined,
      color: typeof patch.color === "string" ? patch.color : undefined,
      visible: typeof patch.visible === "boolean" ? patch.visible : undefined,
      busy: typeof patch.busy === "boolean" ? patch.busy : undefined,
      book: typeof patch.book === "boolean" ? patch.book : undefined,
    });
    return `„${c.name}“ gespeichert.`;
  });
}

/** One of Zeff's own calendars, new. */
export async function createCalendarAction(name: string, color?: string): Promise<ActionState> {
  return run(async () => `„${(await import("@/lib/calendar/ir")).createCalendar(String(name ?? ""), color ? String(color) : undefined).name}“ angelegt.`);
}

/** One of Zeff's own calendars, deleted with its appointments. */
export async function deleteCalendarAction(id: number): Promise<ActionState> {
  return run(async () => {
    (await import("@/lib/calendar/ir")).deleteCalendar(Number(id));
    return "Kalender gelöscht.";
  });
}

/** An appointment in one of Zeff's own calendars — new (no id) or changed. */
export async function saveEventAction(v: { id?: number; calendarId: number; title: string; start: string; end: string; allDay?: boolean; location?: string; description?: string }): Promise<ActionState> {
  return run(async () => {
    const ir = await import("@/lib/calendar/ir");
    const stamp = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s.slice(0, 16)) ? s.slice(0, v.allDay ? 10 : 16) : "");
    const e = { title: String(v.title ?? "").trim(), start: stamp(v.start), end: stamp(v.end), allDay: !!v.allDay, location: String(v.location ?? ""), description: String(v.description ?? "") };
    if (!e.start || !e.end || e.end < e.start) throw new Error("Beginn und Ende, bitte (das Ende nach dem Beginn).");
    if (v.id) {
      ir.updateEvent(Number(v.id), e);
      return `„${e.title}“ gespeichert.`;
    }
    ir.addEvent(Number(v.calendarId), e);
    return `„${e.title}“ eingetragen.`;
  });
}

export async function deleteEventAction(id: number): Promise<ActionState> {
  return run(async () => {
    (await import("@/lib/calendar/ir")).deleteEvent(Number(id));
    return "Termin gelöscht.";
  });
}

/** Google Calendar's account and how many weeks it reads. */
export async function saveGoogleCalendarSettingsAction(v: { account: string; weeks: number }): Promise<ActionState> {
  return run(async () => {
    const { setPref } = await import("@/lib/prefs");
    const account = String(v.account ?? "0").trim() || "0";
    const weeks = Math.max(1, Math.min(12, Math.round(Number(v.weeks) || 5)));
    setPref("plugin:google-calendar", { account, weeks });
    return "Gespeichert.";
  });
}

/** "Jetzt syncen": the calendars' sources now (Google's sync; Outlook's is read in when its own sync brought something). */
export async function syncCalendarsAction(): Promise<ActionState> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("google-calendar")) return { ok: false, error: "Google Calendar ist nicht installiert (Menü → Plugins)." };
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("gcalendar");
  revalidateAll();
  return r.lastOk ? { ok: true, message: `Google Calendar: ${r.lastMessage ?? ""}` } : { ok: false, error: r.lastMessage ?? "Fehlgeschlagen." };
}
