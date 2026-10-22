import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** The calendar app's view as a template (the Workspace's view templates): its parts, its own actions, what it reads as app.*, its default. Client-safe. */
export const CALENDAR_VIEW: ViewAppMeta = {
  app: "calendar",
  label: "Calendar",
  parts: [{ name: "calendar.view", description: "The whole calendar as before (day, week, month)" }],
  actions: [],
  appData: "",
  defaultTemplate: '<part name="calendar.view"/>',
};
