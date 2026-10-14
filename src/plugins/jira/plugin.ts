import { definePlugin } from "../define";

/** Jira: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "jira",
  order: 210,
  name: "Jira",
  description: "Your tickets and those of the chosen boards — the basis of the todos, the context sync and the entries per ticket.",
  category: "connector",
  defaultInstalled: false,
  requires: "The Jira MCP server (mcp-atlassian) with your access.",
  settings: { href: "/jira", what: "Address, access, chosen boards" },
  nav: [
    { href: "/jira", label: "Jira", hint: "Boards, tickets & sync" },
  ],
  routes: ["/jira"],
  syncSteps: ["jira"],
  services: ["jira"],
});
