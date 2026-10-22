import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** The documents app's view as a template (the Workspace's view templates): its parts, its own actions, what it reads as app.*, its default. Client-safe. */
export const DOCUMENTS_VIEW: ViewAppMeta = {
  app: "documents",
  label: "Documents",
  parts: [{ name: "documents.view", description: "The whole documents view as before (grid, preview, upload)" }],
  actions: [],
  appData: "",
  defaultTemplate: '<part name="documents.view"/>',
};
