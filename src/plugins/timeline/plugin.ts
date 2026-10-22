import { definePlugin } from "../define";

/** Timeline: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "timeline",
  order: 172,
  name: "Timeline",
  description: "Time as an axis: one log of what happened across your sources — mails, chats (Teams, WhatsApp, Signal), tickets opened, moved and commented, merge requests, appointments, time booked, todos made and done, Workspace rows added and changed, bank transfers, documents — each tied to the people, tickets, pages and projects it concerns. A timeline on a person's page, on a case's and a ticket's row, as a block for any page, and the Timeline page with filters and a marker for what is new since you last looked. Agents ask it too (MCP: timeline_for, timeline_since). Read by rule after every sync — no AI.",
  category: "app",
  defaultInstalled: true,
  apps: [{ href: "/timeline", label: "Timeline", short: "Timeline", hint: "What happened, and with whom" }],
  routes: ["/timeline"],
});
