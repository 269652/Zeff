/**
 * Ready-made pages and databases (the Workspace plugin): a meeting, a project brief, a weekly review,
 * a decision log, tasks tied to Zeff's todos, projects with their tasks and a progress rollup. Server only.
 */
import { markdownToDoc } from "./doc";
import { createJobsDatabase } from "./jobs";
import { createRulesDatabase } from "./rules";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property, type View } from "./model";
import { createRoutine } from "./routines";
import { addRow, createPage, getDatabase, updateSchema } from "./store";

export type TemplateMeta = { key: string; name: string; icon: string; description: string; kind: "page" | "database" };

const page = (md: string) => markdownToDoc(md);

const select = (name: string, names: string[], colors?: string[]): Property => ({ ...newProperty(name, "select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: colors?.[i] ?? COLORS[(i + 1) % COLORS.length] })) });
const multi = (name: string, names: string[]): Property => ({ ...newProperty(name, "multi_select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: COLORS[(i + 3) % COLORS.length] })) });
const view = (name: string, type: View["type"], extra: Partial<View> = {}): View => ({ ...newView(name, type), ...extra });

type Template = TemplateMeta & { build: (parentId: number | null) => number };

/** A routine's page: its controls block first (run, when, what it may do …), then the blocks that are its instructions (or notes). */
function routinePage(kind: "agent" | "automation", parentId: number | null, title: string, icon: string, intro: string): number {
  const doc = { type: "doc", content: [{ type: "zeffRoutine" }, ...(markdownToDoc(intro).content ?? [])] };
  const id = createPage({ parentId, title, icon, content: doc });
  createRoutine(id, kind);
  return id;
}

const TEMPLATES: Template[] = [
  {
    key: "agent",
    name: "Agent",
    icon: "🤖",
    description: "An LLM run on the instructions you write here — by hand, on a schedule or on an event; it knows its parent and sibling pages.",
    kind: "page",
    build: (parentId) => routinePage("agent", parentId, "New agent", "🤖", "Write what the agent should do — one block per instruction.\n\n- Read the pages next to this one.\n- Write what you find as a short summary under this page.\n"),
  },
  {
    key: "automation",
    name: "Automation",
    icon: "⚙️",
    description: "Steps that run one after another, with gates, branches and conditions — no AI; on a schedule, on an event or by hand.",
    kind: "page",
    build: (parentId) => routinePage("automation", parentId, "New automation", "⚙️", "What this automation is for, in a line — its steps are above."),
  },  {
    key: "agent-jobs",
    name: "Jobs for agents",
    icon: "🤖",
    description: "Jobs a worker takes on your click — a board by status; the result comes back into the row for your check.",
    kind: "database",
    build: (parentId) => createJobsDatabase(parentId),
  },
  {
    key: "rules",
    name: "Rules",
    icon: "📏",
    description: "When / then rules a pipeline applies to its records: drop, set a field, hand to an agent — or a hint every agent gets.",
    kind: "database",
    build: (parentId) => createRulesDatabase(parentId),
  },
  {
    key: "meeting",
    name: "Meeting notes",
    icon: "🗓️",
    description: "Attendees, agenda, notes, decisions and action items.",
    kind: "page",
    build: (parentId) =>
      createPage({
        parentId,
        title: "Meeting",
        icon: "🗓️",
        content: page("**Date:** \n\n**Attendees:** \n\n## Agenda\n\n- \n\n## Notes\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n"),
      }),
  },
  {
    key: "one-on-one",
    name: "1:1",
    icon: "🤝",
    description: "A recurring conversation: wins, blockers, feedback, next steps.",
    kind: "page",
    build: (parentId) => createPage({ parentId, title: "1:1", icon: "🤝", content: page("## Since last time\n\n- \n\n## Wins\n\n- \n\n## Blockers\n\n- \n\n## Feedback\n\n\n## Next steps\n\n- [ ] \n") }),
  },
  {
    key: "project-brief",
    name: "Project brief",
    icon: "🎯",
    description: "Goal, scope, stakeholders, milestones, risks.",
    kind: "page",
    build: (parentId) => createPage({ parentId, title: "Project brief", icon: "🎯", content: page("> 🎯 One sentence: what are we doing, for whom, and why now?\n\n## Goal\n\n\n## Scope\n\n**In:**\n\n- \n\n**Out:**\n\n- \n\n## People\n\n\n## Milestones\n\n- [ ] \n\n## Risks\n\n| Risk | Impact | What we do |\n| --- | --- | --- |\n|  |  |  |\n") }),
  },
  {
    key: "weekly-review",
    name: "Weekly review",
    icon: "🔁",
    description: "What got done, what didn't, what's next — and what to change.",
    kind: "page",
    build: (parentId) => createPage({ parentId, title: "Weekly review", icon: "🔁", content: page("## Done\n\n- \n\n## Not done — and why\n\n- \n\n## Next week\n\n- [ ] \n\n## One thing to change\n\n") }),
  },
  {
    key: "wiki-home",
    name: "Team wiki home",
    icon: "📚",
    description: "A start page with sections to link your pages from.",
    kind: "page",
    build: (parentId) => createPage({ parentId, title: "Wiki", icon: "📚", content: page("Welcome. Type **@** to link a page, a person, a todo or a ticket.\n\n## Start here\n\n- \n\n## Processes\n\n- \n\n## Who to ask\n\n- \n\n## Decisions\n\n- \n") }),
  },
  {
    key: "tasks",
    name: "Tasks",
    icon: "✅",
    description: "A task database with status, due date, priority, owner — tied to your Zeff todos and Jira tickets. Table, board and calendar views.",
    kind: "database",
    build: (parentId) => {
      const status = newProperty("Status", "status");
      const due = newProperty("Due", "date");
      const priority = select("Priority", ["Low", "Medium", "High"], ["gray", "yellow", "red"]);
      const owner = newProperty("Owner", "person");
      const todo = newProperty("Zeff todo", "todo");
      const ticket = newProperty("Ticket", "ticket");
      const schema: DbSchema = {
        titleName: "Task",
        properties: [status, due, priority, owner, todo, ticket],
        views: [
          view("Table", "table", { sorts: [{ prop: due.id, dir: "asc" }] }),
          view("Board", "board", { groupBy: status.id, hidden: [todo.id, ticket.id] }),
          view("Calendar", "calendar", { dateProp: due.id }),
          view("Open", "table", { filter: { op: "and", rules: [{ prop: status.id, cond: "is_not", value: status.options![2].id }] } }),
        ],
      };
      const id = createPage({ parentId, title: "Tasks", icon: "✅", kind: "database", schema });
      addRow(id, { title: "Try the board view", cells: { [status.id]: status.options![1].id, [priority.id]: priority.options![1].id } });
      return id;
    },
  },
  {
    key: "decisions",
    name: "Decision log",
    icon: "⚖️",
    description: "What was decided, by whom, when — so nobody asks twice.",
    kind: "database",
    build: (parentId) => {
      const status = { ...newProperty("Status", "status"), options: [{ id: newId("o"), name: "Proposed", color: "yellow", group: "todo" as const }, { id: newId("o"), name: "Decided", color: "green", group: "done" as const }, { id: newId("o"), name: "Superseded", color: "gray", group: "done" as const }] };
      const decided = newProperty("Decided on", "date");
      const who = newProperty("Deciders", "person");
      const ticket = newProperty("Ticket", "ticket");
      const area = multi("Area", ["Frontend", "Backend", "Process", "Design"]);
      const schema: DbSchema = { titleName: "Decision", properties: [status, decided, who, area, ticket], views: [view("Table", "table", { sorts: [{ prop: decided.id, dir: "desc" }] }), view("By status", "board", { groupBy: status.id })] };
      return createPage({ parentId, title: "Decisions", icon: "⚖️", kind: "database", schema });
    },
  },
  {
    key: "reading-list",
    name: "Reading list",
    icon: "📖",
    description: "Articles and books: status, rating, tags, link — in a gallery too.",
    kind: "database",
    build: (parentId) => {
      const status = { ...newProperty("Status", "status"), options: [{ id: newId("o"), name: "To read", color: "gray", group: "todo" as const }, { id: newId("o"), name: "Reading", color: "blue", group: "doing" as const }, { id: newId("o"), name: "Read", color: "green", group: "done" as const }] };
      const rating = { ...newProperty("Rating", "number") };
      const tags = multi("Tags", ["Tech", "Design", "Business", "Fiction"]);
      const url = newProperty("Link", "url");
      const schema: DbSchema = { titleName: "Title", properties: [status, rating, tags, url], views: [view("List", "table"), view("Board", "board", { groupBy: status.id }), view("Gallery", "gallery")] };
      return createPage({ parentId, title: "Reading list", icon: "📖", kind: "database", schema });
    },
  },
  {
    key: "projects",
    name: "Projects with tasks",
    icon: "🗂️",
    description: "Two linked databases: projects and their tasks — each project rolls up its tasks' progress and hours.",
    kind: "database",
    build: (parentId) => {
      const projects = createPage({ parentId, title: "Projects", icon: "🗂️", kind: "database", schema: { titleName: "Project", properties: [], views: [view("Table", "table")] } });
      const tasks = createPage({ parentId, title: "Project tasks", icon: "☑️", kind: "database", schema: { titleName: "Task", properties: [], views: [view("Table", "table")] } });
      const status = newProperty("Status", "status");
      const hours = newProperty("Hours", "number");
      const project = { ...newProperty("Project", "relation"), relationDb: projects };
      const taskSchema: DbSchema = { titleName: "Task", properties: [project, status, hours, newProperty("Due", "date")], views: [view("Table", "table"), view("Board", "board", { groupBy: status.id })] };
      updateSchema(tasks, taskSchema);
      const back = { ...newProperty("Tasks", "relation"), relationDb: tasks, backOf: project.id };
      const done = { ...newProperty("Progress", "rollup"), format: "percent" as const, rollup: { relation: back.id, property: status.id, fn: "percent_done" as const } };
      const total = { ...newProperty("Total hours", "rollup"), rollup: { relation: back.id, property: hours.id, fn: "sum" as const } };
      const owner = newProperty("Owner", "person");
      const projSchema: DbSchema = { titleName: "Project", properties: [owner, newProperty("Due", "date"), back, done, total], views: [view("Table", "table")] };
      updateSchema(projects, projSchema);
      void getDatabase;
      return projects;
    },
  },
];

export const templateMetas = (): TemplateMeta[] => TEMPLATES.map(({ key, name, icon, description, kind }) => ({ key, name, icon, description, kind }));

/** A template made as a new page (a database: with what belongs to it). Returns the new page's id. */
export function fromTemplate(key: string, parentId: number | null): number {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error("No such template.");
  return t.build(parentId);
}
