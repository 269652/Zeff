import { redirect } from "next/navigation";

/** The calendar's settings are under Settings → Calendar (this address of old links takes you there). */
export default function KalenderSettingsRedirect() {
  redirect("/settings/calendar");
}
