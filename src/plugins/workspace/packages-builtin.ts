import type { WorkspacePackage } from "./packages";

/** The packages that come with Zeff. Inside a package, databases and pages are named by a local id (a string, never a real id). */
const local = (id: string) => id as unknown as number;
const table = { id: "v1", name: "Table", type: "table" as const, filter: { op: "and" as const, rules: [] }, sorts: [], hidden: [] };

export const BUILTIN_PACKAGES: { id: string; pkg: WorkspacePackage }[] = [
  {
    id: "projects-tasks",
    pkg: {
      format: 1,
      name: "Projects & tasks",
      icon: "🗂",
      description: "Projects with their tasks, a cockpit with a form to add tasks, and an automation that tells you when a task is done (switched off until you want it).",
      items: [
        { id: "root", kind: "page", title: "Projects & tasks", icon: "🗂" },
        {
          id: "projects",
          parent: "root",
          kind: "database",
          title: "Projects",
          icon: "📁",
          schema: {
            titleName: "Project",
            properties: [
              { id: "phase", name: "Phase", type: "select", options: [{ id: "o1", name: "Idea", color: "gray" }, { id: "o2", name: "Running", color: "blue" }, { id: "o3", name: "Done", color: "green" }] },
              { id: "due", name: "Due", type: "date" },
            ],
            views: [table],
          },
        },
        {
          id: "tasks",
          parent: "root",
          kind: "database",
          title: "Tasks",
          icon: "✅",
          schema: {
            titleName: "Task",
            properties: [
              { id: "project", name: "Project", type: "relation", relationDb: local("projects") },
              { id: "status", name: "Status", type: "select", options: [{ id: "s1", name: "Open", color: "gray" }, { id: "s2", name: "Doing", color: "blue" }, { id: "s3", name: "Done", color: "green" }] },
              { id: "due", name: "Due", type: "date" },
            ],
            views: [{ id: "v1", name: "Board", type: "board", filter: { op: "and", rules: [] }, sorts: [], hidden: [], groupBy: "status" }, { ...table, id: "v2" }],
          },
        },
        {
          id: "cockpit",
          parent: "root",
          kind: "page",
          title: "Cockpit",
          icon: "🧭",
          content: {
            type: "doc",
            content: [
              { type: "zeffForm", attrs: { dbId: "tasks", fields: JSON.stringify(["status", "due"]), label: "Add task" } },
              { type: "databaseView", attrs: { dbId: "tasks", viewId: "", title: "Tasks" } },
            ],
          },
        },
        {
          id: "done",
          parent: "root",
          kind: "page",
          title: "When a task is done",
          icon: "⚡",
          content: { type: "doc", content: [{ type: "zeffRoutine" }, { type: "paragraph", content: [{ type: "text", text: "Tells you when a task is done. Switch it on above." }] }] },
          routine: {
            kind: "automation",
            permissions: { scope: "self" },
            triggers: [{ kind: "event", event: "row.changed", db: local("tasks"), field: "Status" }],
            steps: [{ id: "n", kind: "if", when: { match: "all", rules: [{ field: "Status", op: "is", value: "Done" }] }, then: [{ id: "m", kind: "notify", text: "Done: {{title}}" }], else: [] }],
          },
        },
      ],
    },
  },
];
