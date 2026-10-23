/**
 * What Zeff may write to Google now, as the pages are told (the buttons that send a mail or enter an event through the API show
 * only then): "gmail-send" — the sign-in holds Gmail's write access and Gmail is installed; "gcal-write" — it holds Google
 * Calendar's and Google Calendar is installed. Without, the actions open Gmail's / Google's window, filled in, as before. Server only.
 */
import { getConnector } from "@/lib/connectors/store";
import { isInstalled } from "@/plugins/state";

export type GoogleGrant = "gmail-send" | "gcal-write";

export function googleGrants(): GoogleGrant[] {
  try {
    const scope = getConnector("google").scope.split(/\s+/);
    const out: GoogleGrant[] = [];
    if (scope.includes("https://www.googleapis.com/auth/gmail.modify") && isInstalled("gmail")) out.push("gmail-send");
    if (scope.some((s) => s === "https://www.googleapis.com/auth/calendar.events" || s === "https://www.googleapis.com/auth/calendar") && isInstalled("google-calendar")) out.push("gcal-write");
    return out;
  } catch {
    return [];
  }
}
