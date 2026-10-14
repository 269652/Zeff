import { definePlugin } from "../define";

/** Todos: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "todos",
  order: 40,
  name: "Todos",
  description: "The briefing: your tickets read by the AI — what happened, what to do — and the todos with their context, activity and recap.",
  category: "app",
  defaultInstalled: true,
  settings: { href: "/preferences", what: "The briefing's JQL filter" },
  tabs: [
    { href: "/heute", label: "Today", short: "Today" },
    { href: "/todos", label: "Todos", short: "Todos" },
  ],
  routes: ["/heute", "/todos", "/t", "/api/boards"],
  syncSteps: ["boards", "recap"],
});
