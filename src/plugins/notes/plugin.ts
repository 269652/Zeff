import { definePlugin } from "../define";

/** Notes: what it is and what it brings (its manifest). Google Keep builds on it (the sync with Google's notes). */
export default definePlugin({
  id: "notes",
  order: 290,
  actionsOrder: 70,
  name: "Notes",
  description: "Notes like in Google Keep: note boards in the Workspace (New → Keep board) with notes, lists, colours, labels and pinning — in knowledge, for agents, and with its extensions in the briefing and the todos. Needs nothing; Google Keep only adds your Google notes.",
  category: "app",
  defaultInstalled: true,
  settings: { href: "/keep/settings", what: "Your own note boards" },
  routes: ["/keep", "/apps/keep"],
  extensions: [
    { key: "note-review", for: "todos", name: "Note review", description: "A step after every briefing: the AI reads new and changed notes (your boards in the briefing, Google Keep) and makes todos of what they ask of you — with the note as the source.", requires: ["llm"], defaultInstalled: true, syncSteps: ["notetodos"] },
    { key: "note-relations", for: "todos", name: "Note matching", description: "A step after every briefing: the AI attaches to each open todo the notes it is about — by content. They then show on the todo, in its context and in the agents'.", requires: ["llm"], defaultInstalled: true, syncSteps: ["noterelations"] },
    { key: "lage-context", for: "todos", name: "Notes in the briefing", description: "The notes attached to a ticket's todos or naming it go into the ticket's analysis too.", defaultInstalled: true },
    { key: "note-action", for: "auto-actions", name: "Create note", description: "Auto actions also suggest keeping something as a note on one of your Keep boards (a shopping list, ideas, credential-free info to look up) — one click creates it.", defaultInstalled: true, actions: ["keep-note"] },
  ],
});
