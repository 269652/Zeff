import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** A person's own page as a template (the Workspace's view templates): its parts, what it reads as app.*, its default. Client-safe. */
export const PERSON_PAGE: ViewAppMeta = {
  app: "person",
  label: "Person",
  parts: [{ name: "person.page", description: "The whole person page as before (facts, details, knowledge, to check, done)" }],
  actions: [],
  appData: "",
  defaultTemplate: () => '<part name="person.page"/>',
};
