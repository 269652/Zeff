import { definePlugin } from "../define";

/** Code: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "work",
  order: 80,
  actionsOrder: 60,
  name: "Code",
  description: "Workers and agents on your todos: runs, live sessions, branches and repos, delivery — and the MCP tools for agents.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["todos", "llm"],
  // One settings entry: the Code section of the settings (the repos are a page of its own, in the menu).
  settings: { href: "/settings/time#work", what: "How the sessions and workers run: permission modes, limits, model, house rules" },
  tabs: [
    { href: "/work", label: "Code", short: "Code" },
  ],
  nav: [
    { href: "/repos", label: "Repos", hint: "Where workers implement" },
  ],
  routes: ["/work", "/api/work", "/repos"],
});
