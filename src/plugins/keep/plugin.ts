import { definePlugin } from "../define";

/** Google Keep: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "keep",
  order: 300,
  actionsOrder: 70,
  name: "Google Keep",
  description: "Notes like in Google Keep: your own note boards in Zeff (Private, Ideas, Shopping …) with notes, lists, colours, labels — and your Google Keep notes, read in the account's automation Chrome (Keep opened in a new tab, what Keep loads taken over, tab closed; nothing changes in Keep). Everything is in the Keep app, in knowledge (also as a source of its own for the knowledge server), for agents — and with its extensions in the briefing and the todos.",
  category: "connector",
  defaultInstalled: false,
  experimental: "Zeff reads Google Keep through its web page in the automation Chrome — Google offers no API for personal Keep notes. If Google changes the page, the sync can fail or miss notes, and Google can object to automated access to your account.",
  requires: "For Google Keep: the account's automation Chrome, signed in to Google (keep.google.com). Your own boards need nothing.",
  settings: { href: "/keep/settings", what: "Your own note boards, the Google account" },
  // No tab of its own any more: the notes are the Workspace's (Google Keep a database its sync keeps; /keep leads there).
  routes: ["/keep", "/apps/keep"],
  syncSteps: ["keep"],
  services: ["keep"],
  extensions: [
    { key: "note-review", for: "todos", name: "Note review", description: "A step after every briefing: the AI reads new and changed notes (your boards in the briefing, Google Keep) and makes todos of what they ask of you — with the note as the source.", requires: ["llm"], defaultInstalled: true, syncSteps: ["notetodos"] },
    { key: "note-relations", for: "todos", name: "Note matching", description: "A step after every briefing: the AI attaches to each open todo the notes it is about — by content. They then show on the todo, in its context and in the agents'.", requires: ["llm"], defaultInstalled: true, syncSteps: ["noterelations"] },
    { key: "lage-context", for: "todos", name: "Notes in the briefing", description: "The notes attached to a ticket's todos or naming it go into the ticket's analysis too.", defaultInstalled: true },
    { key: "note-action", for: "auto-actions", name: "Create note", description: "Auto actions also suggest keeping something as a note on one of your Keep boards (a shopping list, ideas, credential-free info to look up) — one click creates it.", defaultInstalled: true, actions: ["keep-note"] },
  ],
});
