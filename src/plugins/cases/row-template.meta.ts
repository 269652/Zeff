import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** A case's own page as a template (the Workspace's view templates): its parts, what it reads as app.*, its default. Client-safe. */
export const CASE_PAGE: ViewAppMeta = {
  app: "case",
  label: "Case",
  parts: [{ name: "case.page", description: "The whole case page as before (summary, money, payment, sources)" }],
  actions: [],
  appData: "",
  defaultTemplate: () => '<part name="case.page"/>',
};
