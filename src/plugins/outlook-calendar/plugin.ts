import { definePlugin } from "../define";

/** Outlook Calendar: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "outlook-calendar",
  order: 340,
  actionsOrder: 50,
  name: "Outlook Calendar",
  description: "Reads your meetings from Outlook (automation Chrome, bookmarklet or Microsoft sign-in) — meetings to book, with job and exclusion rules.",
  category: "connector",
  defaultInstalled: true,
  requires: "The automation Chrome with Outlook Web, signed in — or Microsoft's API with your own sign-in (Connections page).",
  settings: { href: "/connections", what: "How it is reached: the automation Chrome or its API" },
  apps: [
    { href: "/calendar", label: "Book meetings", short: "Book", hint: "The calendars' meetings, taken over as entries" },
  ],
  routes: ["/calendar", "/import", "/api/calendar"],
  syncSteps: ["calendar"],
  services: ["outlook"],
});
