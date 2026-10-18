import { definePlugin } from "../define";

/** Google Keep: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "keep",
  order: 300,
  name: "Google Keep Sync",
  description: "Your Google Keep notes in Zeff, read in the account's automation Chrome (Keep opened in a new tab, what Keep loads taken over, tab closed; nothing changes in Keep) into a Workspace database. The note boards and what is done with notes (knowledge, agents, briefing, todos) are the Notes plugin's.",
  dependsOn: ["notes"],
  category: "connector",
  defaultInstalled: false,
  experimental: "Zeff reads Google Keep through its web page in the automation Chrome — Google offers no API for personal Keep notes. If Google changes the page, the sync can fail or miss notes, and Google can object to automated access to your account.",
  requires: "For Google Keep: the account's automation Chrome, signed in to Google (keep.google.com).",
  settings: { href: "/keep/settings", what: "The Google account" },
  routes: ["/keep/google"],
  syncSteps: ["keep"],
  services: ["keep"],
});
