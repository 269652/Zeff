import fs from "node:fs";
import path from "node:path";
import { addDays } from "date-fns";
import type { WeekInfo } from "@/lib/week";
import { getCalendarFixturePath, getMicrosoftConfig, hasCustomApp, localTimeZone } from "./config";
import { inboxCount, readInbox } from "./inbox";
import type { GraphEvent } from "./meetings";
import { fetchCalendarView, getConnection, getValidAccessToken } from "./microsoft";

export type CalendarSource = "fixture" | "inbox" | "graph" | "none";

export type CalendarStatus = {
  /** A custom app registration is configured, so the redirect flow is available. */
  configured: boolean;
  /** Device-code sign-in is available (always — it uses the shared public client). */
  deviceCodeAvailable: boolean;
  /** Events come from ZEFF_CALENDAR_FIXTURE instead of Graph. */
  fixture: boolean;
  /** Number of events the browser bookmarklet has pushed into the server inbox. */
  inboxCount: number;
  /** A connected Microsoft account, if any. */
  account?: { name: string | null; email: string | null };
  /** Which source the import preview will read from for the current request. */
  source: CalendarSource;
};

export function getCalendarStatus(): CalendarStatus {
  const conn = getConnection();
  const fixture = getCalendarFixturePath() !== undefined;
  const inbox = inboxCount();
  const source: CalendarSource = fixture
    ? "fixture"
    : inbox > 0
      ? "inbox"
      : conn
        ? "graph"
        : "none";
  return {
    configured: hasCustomApp(),
    deviceCodeAvailable: true,
    fixture,
    inboxCount: inbox,
    account: conn ? { name: conn.accountName, email: conn.accountEmail } : undefined,
    source,
  };
}

/**
 * Raw events overlapping the week (Monday 00:00 to next Monday 00:00, local time).
 * Precedence: an explicit dev fixture, then the bookmarklet inbox, then live Graph.
 */
export async function getWeekEvents(week: WeekInfo): Promise<GraphEvent[]> {
  const fixture = getCalendarFixturePath();
  if (fixture) return readFixture(fixture);

  if (inboxCount() > 0) return readInbox();

  const token = await getValidAccessToken(getMicrosoftConfig());
  return fetchCalendarView(token, week.start, addDays(week.start, 7), localTimeZone());
}

function readFixture(file: string): GraphEvent[] {
  // Dev-only fixture; the ignore keeps Turbopack from tracing the whole project for output file tracing.
  const raw = fs.readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), file), "utf8");
  const json = JSON.parse(raw) as GraphEvent[] | { value: GraphEvent[] };
  return Array.isArray(json) ? json : (json.value ?? []);
}
