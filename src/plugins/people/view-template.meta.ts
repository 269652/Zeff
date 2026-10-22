import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** The people app's view as a template (the Workspace's view templates): its parts, its own actions, what it reads as app.*, its default. Client-safe. */
export const PEOPLE_VIEW: ViewAppMeta = {
  app: "people",
  label: "People",
  parts: [{ name: "people.view", description: "The whole people overview as before (cards, meetings, to check)" }],
  actions: [],
  appData: "",
  defaultTemplate: () => '<part name="people.view"/>',
};
