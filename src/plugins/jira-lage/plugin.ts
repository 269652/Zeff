import { definePlugin } from "../define";

/** Jira briefing: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "jira-lage",
  order: 70,
  name: "Jira briefing",
  description: "Your Jira boards as Workspace boards — the columns as in Jira, each card with its ticket's briefing from the briefing run: where it stands, what happened last, open todos, flags and suggested actions. Plus “My briefing”: the run's tickets.",
  category: "app",
  defaultInstalled: false,
  dependsOn: ["workspace", "todos", "jira"],
  syncSteps: ["boardlage"],
});
