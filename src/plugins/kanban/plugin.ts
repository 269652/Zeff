import { definePlugin } from "../define";

/** Kanban: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "kanban",
  order: 60,
  name: "Kanban",
  description: "Your own boards like in Jira — for private projects or your own work boards: columns, cards (K-1, K-2 …) with description, labels, priority and due date, by drag & drop. Other plugins add their boards (Jira briefing).",
  category: "app",
  defaultInstalled: false,
  settings: { href: "/kanban/settings", what: "Create your own boards, columns, in the briefing" },
  // No tab of its own any more: its boards are the Workspace's (old /kanban links lead there).
  routes: ["/kanban"],
});
