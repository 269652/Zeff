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
    { href: "/todos", label: "Todos", short: "Todos", also: ["/tickets"] },
  ],
  // The review queue is everyone's (each plugin brings its items) — its entry is here, with the todos it starts from.
  nav: [{ href: "/review", label: "Review", hint: "Everything waiting for your yes or no" }],
  routes: ["/heute", "/todos", "/t", "/api/boards"],
  syncSteps: ["boards", "recap"],
});
