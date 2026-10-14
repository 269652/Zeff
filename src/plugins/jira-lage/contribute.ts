import { boardProviders } from "@/plugins/kanban/board-providers";

/** What Jira Lage brings to other plugins. */

// Kanban: "Meine Lage" and your Jira boards, each ticket with its Lage.
boardProviders.contribute("jira-lage", {
  idPrefix: "jira-",
  list: async () => (await import("./board")).lageBoards(),
  get: async (id) => (await import("./board")).lageBoard(id),
});
