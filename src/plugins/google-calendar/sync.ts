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
import { getPref } from "@/lib/prefs";
import { automationEnv, automationUp, driverPath } from "@/plugins/drivers";

export type GoogleCalendarSettings = { account: string; weeks: number };
export const googleCalendarSettings = (): GoogleCalendarSettings => ({ account: "0", weeks: 5, ...getPref<Partial<GoogleCalendarSettings>>("plugin:google-calendar", {}) });

/** One Google sync at a time across the whole server. */
const flag = globalThis as { __zeffGcalSyncing?: boolean };
export const gcalSyncing = () => !!flag.__zeffGcalSyncing;

type Read = {
  calendars: { id: string; name: string; color: string; shown: boolean }[];
  events: (Omit<EventInput, "key"> & { key: string; calendarId: string })[];
  unparsed: number;
  from: string;
};

/** Calendars that don't block time by themselves: birthdays, tasks, holidays. */
const NOT_BUSY = /birthdays@|tasks@|holiday@|#holiday@|#contacts@|\.v\.calendar\.google\.com$/i;

async function chromeUp(): Promise<boolean> {
  return automationUp();
}

export async function syncGoogleCalendar({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (flag.__zeffGcalSyncing) return { ok: false, message: t("A Google Calendar sync is already running.") };
  flag.__zeffGcalSyncing = true;
  try {
    const viaApi = driverOf("gcalendar") === "api";
    if (!viaApi && background && !(await chromeUp())) return { ok: false, message: t("The automation Chrome isn't running. Not synced.") };
    const s = googleCalendarSettings();
    let data: Read | null;
    if (viaApi) data = await (await import("@/lib/google/calendar-api")).readCalendar({ weeks: s.weeks });
    else {
      const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
      const out = await runStdioSession(
        { command: process.execPath, args: [driverPath("google-calendar")], env: automationEnv(), label: "Google Calendar sync" },
        async (call) => resultToPayload(await call("gcal_events", { account: s.account, weeks: s.weeks, launch: !background })),
        300000,
      );
      data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as Read | null;
      if (!data || !Array.isArray(data.calendars) || !Array.isArray(data.events)) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : t("Google Calendar returned nothing readable."));
    }
    // The weeks read: from their Monday, so many weeks on.
    const to = new Date(`${data.from}T00:00:00`);
    to.setDate(to.getDate() + 7 * s.weeks);
    const range = { from: data.from, to: isoDay(to) };
    let events = 0;
    for (const c of data.calendars) {
      const cal = ensureCalendar(`google:${c.id}`, { source: "google", name: c.name, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : undefined, visible: c.shown, busy: !NOT_BUSY.test(c.id) });
      // A calendar hidden in Google shows nothing there: what Zeff has of it stays.
      if (!c.shown) continue;
      events += replaceEvents(
        cal.id,
        data.events.filter((e) => e.calendarId === c.id).map(({ calendarId: _c, ...e }) => e),
        range,
      );
    }
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
    flag.__zeffGcalSyncing = false;
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
