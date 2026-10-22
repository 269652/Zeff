import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** The debts app's view as a template (the Workspace's view templates): its parts, its own actions, what it reads as app.*, its default. Client-safe. */
export const DEBTS_VIEW: ViewAppMeta = {
  app: "debts",
  label: "Debts and claims",
  parts: [{ name: "debts.view", description: "The whole debts overview as before (tabs, figures, table, charts)" }],
  actions: [],
  appData: "",
  defaultTemplate: '<part name="debts.view"/>',
};
