import type { Metadata } from "next";
import { redirect } from "@/lib/redirect";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { CalendarApp } from "@/plugins/calendar/CalendarApp";
import { calendarViewData } from "@/plugins/calendar/view-data";
import { isView } from "@/plugins/calendar/view-shared";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Calendar") };
}

/**
 * Kalender: the calendar lives in the Workspace (a database "Calendar" shown by the calendar app) — this address takes you there
 * (old links, the menu). Without the Workspace, or its database not made yet, the app itself (?v=…&d=YYYY-MM-DD; ?w= of old links).
 */
export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ v?: string; d?: string; w?: string }> }) {
  await connection();
  if (!isInstalled("calendar")) return <PluginNotInstalled id="calendar" />;
  const sp = await searchParams;
  if (isInstalled("workspace")) {
    const home = (await import("@/plugins/workspace/calendar-database")).calendarDatabase();
    if (home) redirect(`/workspace/${home}${sp.v || sp.d || sp.w ? `?${new URLSearchParams({ ...(sp.v ? { v: sp.v } : {}), ...((sp.d ?? sp.w) ? { d: (sp.d ?? sp.w)! } : {}) })}` : ""}`);
  }
  const d = await calendarViewData(sp.v, sp.d ?? sp.w);
  return <CalendarApp view={d.view} day={d.day} explicitView={isView(sp.v)} calendars={d.calendars} events={d.events} proposed={d.proposed} now={d.now} canSync={d.canSync} />;
}
