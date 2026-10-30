import { definePlugin } from "../define";

/** Tickets: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "tickets",
  order: 50,
  name: "Tickets",
  description: "The Tickets tab: the briefing per ticket — where it stands, what happened, its todos, comments, mails, merge requests and suggested actions — filterable by state. Builds on Todos (the same briefing run).",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["todos"],
  // No tab of its own: a toggle inside Todos (/todos?part=tickets; /tickets redirects there).
  routes: ["/tickets"],
});
