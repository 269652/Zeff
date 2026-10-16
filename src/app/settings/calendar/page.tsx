import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listCalendars } from "@/lib/calendar/ir";
import { t } from "@/lib/i18n/server";
import { CalendarSettings } from "@/plugins/calendar/CalendarSettings";
import { googleCalendarSettings, signedInGoogleAccounts } from "@/plugins/google-calendar/sync";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Calendar settings") };
}

/** Settings → Calendar: the calendars: Zeff's own (new, renamed, deleted), the sources' — colour, shown, busy, booked — and Google's account. */
export default async function CalendarSettingsPage() {
  await connection();
  if (!isInstalled("calendar")) return <PluginNotInstalled id="calendar" />;
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Calendar")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "Zeff reads every source into its own calendar model: Outlook (through its calendar sync), Google Calendar (plugin), and your own calendars. “Busy”: its events count for free slots and meeting suggestions. “Book”: its meetings show under Book meetings.",
          )}
        </p>
        <Link href="/kalender" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← {t("Back to the calendar")}
        </Link>
        <Link href="/settings/all" className="block text-sm text-zinc-500 hover:underline">
          {t("All settings")}
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
