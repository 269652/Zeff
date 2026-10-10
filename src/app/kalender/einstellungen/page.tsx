import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listCalendars } from "@/lib/calendar/ir";
import { CalendarSettings } from "@/plugins/calendar/CalendarSettings";
import { googleCalendarSettings, signedInGoogleAccounts } from "@/plugins/google-calendar/sync";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Kalender-Einstellungen" };

/** The calendars: Zeff's own (new, renamed, deleted), the sources' — colour, shown, busy, booked — and Google's account. */
export default async function KalenderSettingsPage() {
  await connection();
  if (!isInstalled("calendar")) return <PluginNotInstalled id="calendar" />;
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Kalender</h1>
        <p className="text-sm text-zinc-500">
          Zeff liest jede Quelle in sein eigenes Kalender-Modell: Outlook (über seinen Kalender-Sync), Google Calendar (Plugin), dazu deine eigenen Kalender. „Belegt“: seine Termine zählen
          für freie Zeiten und Terminvorschläge. „Buchen“: seine Meetings erscheinen unter Termine buchen.
        </p>
        <Link href="/kalender" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Zum Kalender
        </Link>
      </div>
      <CalendarSettings
        calendars={listCalendars()}
        google={isInstalled("google-calendar") ? googleCalendarSettings() : null}
        signedIn={isInstalled("google-calendar") ? await signedInGoogleAccounts() : null}
        outlook={isInstalled("outlook-calendar")}
      />
    </div>
  );
}
