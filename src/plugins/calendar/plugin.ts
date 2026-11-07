import { definePlugin } from "../define";

/** Calendar: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "calendar",
  order: 320,
  actionsOrder: 110,
  name: "Calendar",
  description: "One calendar for everything: your own calendars in Zeff and those of your sources (Outlook, Google Calendar) in one week view, each with a colour, to show or hide. Zeff reads every source into its own calendar model — that's where the free slots for meeting suggestions and the meetings to book come from. Your todos' suggested meetings show dashed.",
  category: "app",
  defaultInstalled: true,
  settings: { href: "/settings/calendar", what: "Your calendars, their colours, which count as busy and get booked" },
  // The calendar is an app of its own (this tab) — with the Workspace it is a database there (in its favorites) and the tab gives way.
  tabs: [{ href: "/kalender", label: "Calendar", short: "Cal.", unless: "workspace" }],
  routes: ["/kalender"],
  // The step after every briefing that matches appointments to the open todos (Calendar matching).
  syncSteps: ["calendarrelations", "calendartodos"],
  extensions: [
    { key: "entry-action", for: "auto-actions", name: "Event in the Zeff calendar", description: "Auto actions suggest meetings, time blocks and reminders for todos — in a free slot; one click puts them into your Zeff calendar.", defaultInstalled: true, actions: ["calendar-entry"] },
  ],
});
