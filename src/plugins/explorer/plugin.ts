import { definePlugin } from "../define";

/** Explorer: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "explorer",
  order: 192,
  name: "Explorer",
  description:
    "The files of this computer in the Workspace, like Windows Explorer: drives, folders and files with their dates and sizes. Import files or whole folders into Documents, watch a folder so what changes in it comes into Documents by itself (right away, not only on the schedule), and open text, Markdown, CSV, pictures, PDFs, Office files, audio and video in a viewer — text files you can edit and save right there.",
  category: "app",
  defaultInstalled: false,
  dependsOn: ["workspace", "documents"],
  requires: "Zeff running on the computer whose files you want to see (in Docker: only the folders mounted into it).",
  apps: [{ href: "/explorer", label: "Explorer", short: "Files", hint: "The files of this computer, in the Workspace" }],
  routes: ["/explorer", "/api/explorer"],
});
