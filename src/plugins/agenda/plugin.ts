import { definePlugin } from "../define";

/** Agenda: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "agenda",
  order: 268,
  name: "Agenda",
  description:
    "Notes on a timeline, in projects, as in the app Agenda: a note has a date or a range, can be put on the agenda, pinned and marked done, has tags and people; its text, checklists, tables and pictures are its page. A template in the Workspace (New → from a template → Agenda), its own screen, and a form for a new note.",
  category: "app",
  defaultInstalled: false,
  dependsOn: ["workspace"],
});
