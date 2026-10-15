import { definePlugin } from "../define";

/** Workspace: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "workspace",
  order: 195,
  name: "Workspace",
  description: "Pages and databases, like Notion — and wired into Zeff: a block editor (headings, lists, to-dos, tables, callouts, toggles, code, pictures; type / for blocks), pages in a tree with backlinks, history and a trash, databases with table, board, list, gallery and calendar views, filters, sorts, formulas and relations — and what Notion can't do: @-mention your people, todos and tickets, AI that writes, summarises and turns a page into todos, notes that agents can read and write through the MCP, and everything searchable in Zeff.",
  category: "app",
  defaultInstalled: false,
  apps: [
    { href: "/workspace", label: "Workspace", short: "Space", hint: "Pages and databases" },
  ],
  routes: ["/workspace", "/api/workspace"],
});
