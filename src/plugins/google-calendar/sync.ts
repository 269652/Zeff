/**
 * Google Calendar's adapter: its calendars and appointments read (the driver, read-only, in the
 * account's automation Chrome) and written into Zeff's calendar model — each Google calendar one of
 * Zeff's, the weeks read replacing what was there (moved and deleted ones go). Server only.
 */
import { isoDay } from "@/lib/text";
import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { ensureCalendar, replaceEvents, type EventInput } from "@/lib/calendar/ir";
import { driverOf } from "@/lib/connectors/store";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { automationEnv, automationUp, driverPath } from "@/plugins/drivers";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";

/** `weeks`: how far ahead it reads; `pastMonths`: how far back (the API — from the 1st of that month). */
export type GoogleCalendarSettings = { account: string; weeks: number; pastMonths: number };
export const googleCalendarSettings = (): GoogleCalendarSettings => ({ account: "0", weeks: 13, pastMonths: 3, ...getPref<Partial<GoogleCalendarSettings>>("plugin:google-calendar", {}) });

export type DayRange = { from: string; to: string };

/** What a sync reads: from the 1st of the month `pastMonths` back (at least the Monday of last week), up to `weeks` weeks from that Monday. */
export function syncWindow(s: Pick<GoogleCalendarSettings, "weeks" | "pastMonths">, now = new Date()): DayRange {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7);
  const back = new Date(now.getFullYear(), now.getMonth() - Math.max(0, s.pastMonths), 1);
  const to = new Date(monday);
  to.setDate(to.getDate() + 7 * Math.max(1, s.weeks));
  return { from: isoDay(back < monday ? back : monday), to: isoDay(to) };
}

/** The ranges to read: the window, and a range asked for (the month shown) — joined when they touch, else both. */
export function rangesToRead(window: DayRange, asked?: DayRange): DayRange[] {
  if (!asked || asked.to <= asked.from) return [window];
  if (asked.from <= window.to && asked.to >= window.from) return [{ from: asked.from < window.from ? asked.from : window.from, to: asked.to > window.to ? asked.to : window.to }];
  return [window, asked];
}

type Read = {
  calendars: { id: string; name: string; color: string; shown: boolean; role?: string }[];
  events: (Omit<EventInput, "key"> & { key: string; calendarId: string })[];
  unparsed: number;
  from: string;
};

/** Calendars that don't block time by themselves: birthdays, tasks, holidays. */
const NOT_BUSY = /birthdays@|tasks@|holiday@|#holiday@|#contacts@|\.v\.calendar\.google\.com$/i;

async function chromeUp(): Promise<boolean> {
  return automationUp();
}

/** The Google calendars you may write to (owner or writer — as the API's last read said), by their Google id. */
export const writableGoogleCalendars = (): string[] => getPref<string[]>("google-calendar:writable", []);

/**
 * Which Google calendars you may write to, asked of Google once when nobody has yet (Calendar read through the automation
 * Chrome, which doesn't say) — one read of the calendar list. Quietly nothing when it can't be read.
 */
export async function learnWritableGoogleCalendars(): Promise<void> {
  if (getPref<string[] | null>("google-calendar:writable", null) !== null) return;
  try {
    const { apiGet } = await import("@/lib/connectors/http");
    const r = await apiGet<{ items?: { id: string; accessRole?: string }[] }>("google", "/calendar/v3/users/me/calendarList?maxResults=250&minAccessRole=writer");
    setPref("google-calendar:writable", (r.items ?? []).filter((c) => c.accessRole === "owner" || c.accessRole === "writer").map((c) => c.id));
  } catch {
    // (not signed in through the API, offline …: the next sync or write learns it)
  }
}

/**
 * What was read, into Zeff's calendars: each Google calendar one of Zeff's, the appointments of the days read replacing what was
 * there; the calendars you may write to remembered (the API says so; the Chrome driver doesn't). How many appointments.
 */
export function applyRead(data: Read, days: DayRange): number {
  let events = 0;
  for (const c of data.calendars) {
    const cal = ensureCalendar(`google:${c.id}`, { source: "google", name: c.name, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : undefined, visible: c.shown, busy: !NOT_BUSY.test(c.id) });
    // A calendar hidden in Google shows nothing there: what Zeff has of it stays.
    if (!c.shown) continue;
    events += replaceEvents(
      cal.id,
      data.events.filter((e) => e.calendarId === c.id).map(({ calendarId: _c, ...e }) => e),
      days,
    );
  }
  const roles = data.calendars.filter((c) => c.role);
  if (roles.length) {
    const writable = new Set(writableGoogleCalendars());
    for (const c of roles) {
      if (c.role === "owner" || c.role === "writer") writable.add(c.id);
      else writable.delete(c.id);
    }
    setPref("google-calendar:writable", [...writable]);
  }
  return events;
}

/** `range`: the days shown (a month gone by) — read too, besides the window of the settings (the API only). */
export async function syncGoogleCalendar({ background = false, range }: { background?: boolean; range?: DayRange } = {}): Promise<{ ok: boolean; message: string }> {
  if (accountFlag("__zeffGcalSyncing")) return { ok: false, message: t("A Google Calendar sync is already running.") };
  setAccountFlag("__zeffGcalSyncing", true);
  try {
    const viaApi = driverOf("gcalendar") === "api";
    if (!viaApi && background && !(await chromeUp())) return { ok: false, message: t("The automation Chrome isn't running. Not synced.") };
    const s = googleCalendarSettings();
    // What was read, each with the days it covers (what Zeff has of those days is replaced by it).
    const reads: { data: Read; range: DayRange }[] = [];
    if (viaApi) {
      const { readCalendar } = await import("@/lib/google/calendar-api");
      for (const r of rangesToRead(syncWindow(s), range)) reads.push({ data: await readCalendar(r), range: r });
    } else {
      const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
      const out = await runStdioSession(
        { command: process.execPath, args: [driverPath("google-calendar")], env: automationEnv(), label: "Google Calendar sync" },
        async (call) => resultToPayload(await call("gcal_events", { account: s.account, weeks: s.weeks, launch: !background })),
        300000,
      );
      const data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as Read | null;
      if (!data || !Array.isArray(data.calendars) || !Array.isArray(data.events)) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : t("Google Calendar returned nothing readable."));
      // The weeks read: from their Monday, so many weeks on.
      const to = new Date(`${data.from}T00:00:00`);
      to.setDate(to.getDate() + 7 * s.weeks);
      reads.push({ data, range: { from: data.from, to: isoDay(to) } });
    }
    let events = 0;
    for (const { data, range: days } of reads) events += applyRead(data, days);
    const data = reads[0].data;
    clearAttention("login:gcalendar");
    return {
      ok: true,
      message: `${t("{events} events in {calendars} calendars", { events, calendars: data.calendars.length })}${data.unparsed ? ` · ${t("{n} unreadable", { n: data.unparsed })}` : ""}`,
    };
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    // (An API sign-in that fails is told in the result: connect again on the Connections page — no Chrome login to raise.)
    if (driverOf("gcalendar") === "cdp" && (needsSignIn(message) || /sign[- ]in|anmeld|not signed/i.test(message))) raiseLogin("gcalendar", message);
    return { ok: false, message };
  } finally {
    setAccountFlag("__zeffGcalSyncing", false);
  }
}

/** A Google account signed in in the automation Chrome (Google's account list). */
export type SignedInGoogle = { email: string; name: string; number: number };

/** The Google accounts signed in in the account's automation Chrome — null: Chrome isn't running (or didn't answer). */
export async function signedInGoogleAccounts(): Promise<SignedInGoogle[] | null> {
  if (!(await chromeUp())) return null;
  try {
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("google-calendar")], env: automationEnv(), label: "Google accounts" },
      async (call) => resultToPayload(await call("gcal_accounts", {})),
      30000,
    );
    const data = (typeof out === "string" ? JSON.parse(out) : out) as { accounts?: SignedInGoogle[] };
    return Array.isArray(data.accounts) ? data.accounts : null;
  } catch {
    return null;
  }
}
