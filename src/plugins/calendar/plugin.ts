import { definePlugin } from "../define";

/** Calendar: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "calendar",
  order: 320,
  actionsOrder: 110,
  name: "Calendar",
  description: "One calendar for everything: your own calendars in Zeff and those of your sources (Outlook, Google Calendar) in one week view, each with a colour, to show or hide. Zeff reads every source into its own calendar model — that's where the free slots for meeting suggestions and the meetings to book come from. Your todos' suggested meetings show dashed.",
  category: "app",
  defaultInstalled: false,
  settings: { href: "/kalender/einstellungen", what: "Your calendars, their colours, which count as busy and get booked" },
  tabs: [
    { href: "/kalender", label: "Calendar", short: "Cal." },
  ],
  routes: ["/kalender"],
  extensions: [
    { key: "entry-action", for: "auto-actions", name: "Event in the Zeff calendar", description: "Auto actions suggest meetings, time blocks and reminders for todos — in a free slot; one click puts them into your Zeff calendar.", defaultInstalled: true, actions: ["calendar-entry"] },
  ],
});
