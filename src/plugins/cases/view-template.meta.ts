import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** The cases app's view as a template (the Workspace's view templates): its parts, its own actions, what it reads as app.*, its default. Client-safe. */
export const CASES_VIEW: ViewAppMeta = {
  app: "cases",
  label: "Cases",
  parts: [{ name: "cases.view", description: "The whole cases overview as before (bank bar, figures, the cases)" }],
  actions: [],
  appData: "",
  defaultTemplate: '<part name="cases.view"/>',
};
