import { definePlugin } from "../define";

/** Google Keep write: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "keep-write",
  order: 310,
  name: "Google Keep write",
  description: "Makes your Google Keep notes editable in Zeff: new notes and lists, title and text, ticks, colours, labels, pinning, archiving, moving to the bin — every change saved in Google Keep right away, and Zeff shows the note as Keep confirmed it.",
  category: "connector",
  defaultInstalled: false,
  beta: "Zeff writes through Keep's own web interface — as if by hand, in a tab of the automation Chrome. If Google changes that interface, a write can fail or only partly succeed. Each change takes about half a minute. For anything important: check in Keep.",
  requires: "The account's automation Chrome, signed in to Google (keep.google.com).",
  dependsOn: ["keep"],
});
