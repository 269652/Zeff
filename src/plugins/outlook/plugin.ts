import { definePlugin } from "../define";

/** Outlook: mail and calendar from Outlook (its manifest) — each part on or off by itself, under the ids they had as plugins of their own. */
export default definePlugin({
  id: "outlook",
  order: 255,
  name: "Outlook",
  description: "Your work Outlook: the inbox and the calendar, read through the automation Chrome with Outlook Web or Microsoft's API with your own sign-in. Mail and calendar are switched on or off each by itself.",
  category: "connector",
  defaultInstalled: true,
  requires: "The automation Chrome with Outlook Web, signed in — or Microsoft's API with your own sign-in (Connections page).",
  settings: { href: "/settings/connections", what: "How it is reached: the automation Chrome or its API" },
  features: [
    {
      id: "outlook-mail",
      order: 260,
      actionsOrder: 40,
      name: "Outlook Mail",
      description: "Reads your inbox in Outlook Web (only the list, nothing is opened) — mails as context for todos, the mail review and mail matching.",
      defaultInstalled: true,
      settings: { href: "/settings/mail", what: "Mail accounts: add one, its servers, password and folders" },
      apps: [{ href: "/mail", label: "Inbox", short: "Inbox", hint: "All your mails and chats in one place, a filter per channel" }],
      routes: ["/mail", "/api/boards/mail-relations"],
      syncSteps: ["mail", "mailtodos", "relations"],
      services: ["outlook"],
    },
    {
      id: "outlook-calendar",
      order: 340,
      actionsOrder: 50,
      name: "Outlook Calendar",
      description: "Reads your meetings from Outlook (automation Chrome, bookmarklet or Microsoft sign-in) — meetings to book, with job and exclusion rules.",
      defaultInstalled: true,
      apps: [{ href: "/calendar", label: "Book meetings", short: "Book", hint: "The calendars' meetings, taken over as entries" }],
      routes: ["/calendar", "/import", "/api/calendar"],
      syncSteps: ["calendar"],
      services: ["outlook"],
    },
  ],
});
