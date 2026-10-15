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
  settings: { href: "/repos", what: "The repos the workers work in" },
  tabs: [
    { href: "/work", label: "Code", short: "Code" },
  ],
  nav: [
    { href: "/repos", label: "Repos", hint: "Where workers implement" },
  ],
  routes: ["/work", "/api/work", "/repos"],
});
