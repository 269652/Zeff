/**
 * Outlook's calendars from the Outlook installed on this PC (the "com" driver of Outlook Calendar,
 * Windows, classic Outlook): scripts/outlook-calendar-com.ps1 reads every calendar there — mailboxes'
 * and iCloud / subscribed ones — through Outlook's COM interface, read-only, and answers Graph-shaped
 * events in local time. They go into the meeting inbox (replaceInboxWeeks) like the other drivers'.
 * Server only.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { getPref, setPref } from "@/lib/prefs";
import { localTimeZone } from "@/lib/calendar/config";
import { weekFromDate } from "@/lib/week";

const EXCLUDE_PREF = "outlookCom:exclude";
/** Holiday calendars are left out unless you say otherwise. */
const DEFAULT_EXCLUDE = "Feiertage;Holidays";

/** The calendars left out: words of their "<store> / <calendar>" name, separated by ";". */
export const comExclude = (): string => getPref<string>(EXCLUDE_PREF, DEFAULT_EXCLUDE);
export const setComExclude = (v: string): void => setPref(EXCLUDE_PREF, v.replace(/\s*;\s*/g, ";").replace(/^;+|;+$/g, "").trim());

type Read = { events: Record<string, unknown>[]; calendars: { name: string; count: number; excluded: boolean }[] };

function run(args: string[]): Promise<Read> {
  if (process.platform !== "win32") return Promise.reject(new Error("Outlook on this PC can only be read on Windows."));
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "outlook-calendar-com.ps1");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      { windowsHide: true, timeout: 5 * 60000, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((String(stderr).trim() || err.message).split("\n")[0].slice(0, 300) || "Outlook could not be read."));
        try {
          const j = JSON.parse(String(stdout)) as Partial<Read>;
          resolve({ events: j.events ?? [], calendars: j.calendars ?? [] });
        } catch {
          reject(new Error(String(stdout).slice(0, 300) || "Outlook answered something unreadable."));
        }
      },
    );
  });
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Each of these weeks (Monday ISO dates) with its events (by the day they start), from every Outlook calendar not left out. */
export async function readWeeksCom(weekStartIsos: string[]): Promise<{ weekStartIso: string; events: unknown[] }[]> {
  const weeks = [...new Set(weekStartIsos)].sort();
  if (!weeks.length) return [];
  const [y, m, d] = weeks[weeks.length - 1].split("-").map(Number);
  const last = new Date(y, m - 1, d + 6);
  const r = await run(["-From", weeks[0], "-To", iso(last), "-Exclude", comExclude(), "-TimeZone", localTimeZone()]);
  const byWeek = new Map<string, unknown[]>(weeks.map((w) => [w, []]));
  for (const e of r.events) {
    const start = String((e.start as { dateTime?: string } | undefined)?.dateTime ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const [sy, sm, sd] = start.split("-").map(Number);
    byWeek.get(weekFromDate(new Date(sy, sm - 1, sd)).startIso)?.push(e);
  }
  return weeks.map((weekStartIso) => ({ weekStartIso, events: byWeek.get(weekStartIso) ?? [] }));
}

/** The calendars Outlook has here (names only), and whether each is left out. */
export async function listCalendarsCom(): Promise<{ name: string; excluded: boolean }[]> {
  const r = await run(["-ListOnly", "-Exclude", comExclude()]);
  return r.calendars.map((c) => ({ name: c.name, excluded: c.excluded }));
}
