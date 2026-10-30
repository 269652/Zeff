import { definePlugin } from "../define";

/** Workspace: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "workspace",
  order: 195,
  name: "Workspace",
  description: "Pages and databases, like Notion — and wired into Zeff: a block editor (headings, lists, to-dos, tables, callouts, toggles, code, pictures; type / for blocks), pages in a tree with backlinks, history and a trash, databases with table, board, list, gallery and calendar views, filters, sorts, formulas and relations — and what Notion can't do: @-mention your people, todos and tickets, AI that writes, summarises and turns a page into todos, notes that agents can read and write through the MCP, and everything searchable in Zeff.",
  category: "app",
  // The place for pages, boards, notes and the data sources (Jira, Google Keep) — Kanban's and Keep's tabs are its now.
  defaultInstalled: true,
  // Its own settings (under its own name — not only through the Google Keep part).
  settings: { href: "/workspace/settings/sources", what: "Data sources, outputs, pipelines, the apps that show its databases" },
  tabs: [{ href: "/workspace", label: "Workspace", short: "Space", also: ["/kanban", "/keep"] }],
  routes: ["/workspace", "/api/workspace"],
  actionsOrder: 70,
  // Notes were a plugin of their own (their boards are databases here now): what they brought to the todos and the
  // auto actions keeps its ids, so what you set stays.
  extensions: [
    { key: "note-review", id: "notes:note-review", for: "todos", name: "Note review", description: "A step after every briefing: the AI reads new and changed notes (your boards in the briefing, Google Keep) and makes todos of what they ask of you — with the note as the source.", requires: ["llm"], defaultInstalled: true, syncSteps: ["notetodos"] },
    { key: "note-relations", id: "notes:note-relations", for: "todos", name: "Note matching", description: "A step after every briefing: the AI attaches to each open todo the notes it is about — by content. They then show on the todo, in its context and in the agents'.", requires: ["llm"], defaultInstalled: true, syncSteps: ["noterelations"] },
    { key: "lage-context", id: "notes:lage-context", for: "todos", name: "Notes in the briefing", description: "The notes attached to a ticket's todos or naming it go into the ticket's analysis too.", defaultInstalled: true },
    { key: "note-action", id: "notes:note-action", for: "auto-actions", name: "Create note", description: "Auto actions also suggest keeping something as a note on one of your Keep boards (a shopping list, ideas, credential-free info to look up) — one click creates it.", defaultInstalled: true, actions: ["keep-note"] },
  ],
  // Google Keep was a plugin of its own: now the Workspace's Keep source, under its old id (and what you set for it).
  features: [
    {
      id: "keep",
      order: 300,
      name: "Google Keep Sync",
      description: "Your Google Keep notes in Zeff, read in the account's automation Chrome (Keep opened in a new tab, what Keep loads taken over, tab closed; nothing changes in Keep) into a Workspace database. The note boards and what is done with notes (knowledge, agents, briefing, todos) are the Notes plugin's.",
      defaultInstalled: false,
      experimental: "Zeff reads Google Keep through its web page in the automation Chrome — Google offers no API for personal Keep notes. If Google changes the page, the sync can fail or miss notes, and Google can object to automated access to your account.",
      requires: "For Google Keep: the account's automation Chrome, signed in to Google (keep.google.com).",
      settings: { href: "/workspace/settings/sources", what: "The Google account" },
      syncSteps: ["keep"],
      services: ["keep"],
    },
  ],
});
