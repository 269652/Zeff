import { definePlugin } from "../define";

/** Google Calendar: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "google-calendar",
  order: 330,
  name: "Google Calendar",
  description: "Reads your Google calendars in the account's automation Chrome — the week view in a new tab, week by week (last week, this one and the next three), then closed again; nothing changes in Google. Every Google calendar (yours, family, birthdays …) shows in the Calendar app, its events count for free slots.",
  category: "connector",
  defaultInstalled: false,
  requires: "The account's automation Chrome, signed in to Google (calendar.google.com).",
  dependsOn: ["calendar"],
  syncSteps: ["gcalendar"],
  services: ["gcalendar"],
  extensions: [
    { key: "event-action", for: "auto-actions", name: "Event in Google Calendar", description: "Auto actions suggest Google Calendar events for todos — in a free slot; one click opens Google's form, filled in; you save it yourself.", defaultInstalled: true, actions: ["gcal-event"] },
  ],
});
