/**
 * Ready-made pages and databases (the Workspace plugin): a meeting, a project brief, a weekly review,
 * a decision log, tasks tied to Zeff's todos, projects with their tasks and a progress rollup. Server only.
 */
import { t } from "@/lib/i18n/server";
import { markdownToDoc, type DocNode } from "./doc";
import { createJobsDatabase } from "./jobs";
import { createRulesDatabase } from "./rules";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property, type View } from "./model";
import { createNotesBoard } from "./notes-board";
import { newsDatabaseTitle } from "./news-database";
import { installPackage, listPackages } from "./packages";
import { widgetCatalog } from "./widgets";
import { createRoutine } from "./routines";
import { createTicketCockpit } from "./ticket-cockpit";
import { authorityPage, financesPage, meetingPage, oneOnOnePage, projectBriefPage, weeklyReviewPage, whoOwesPage, wikiHomePage } from "./templates-pages";
import { addRow, createPage, getDatabase, updatePage, updateSchema } from "./store";

/** The group a template is shown in (the gallery's tabs). */
export type TemplateCategory = "overview" | "work" | "notes" | "automation" | "packages";
export type TemplateMeta = { key: string; name: string; icon: string; description: string; kind: "page" | "database"; category: TemplateCategory };


const select = (name: string, names: string[], colors?: string[]): Property => ({ ...newProperty(name, "select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: colors?.[i] ?? COLORS[(i + 1) % COLORS.length] })) });
const multi = (name: string, names: string[]): Property => ({ ...newProperty(name, "multi_select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: COLORS[(i + 3) % COLORS.length] })) });
const view = (name: string, type: View["type"], extra: Partial<View> = {}): View => ({ ...newView(name, type), ...extra });

/** How the cards of the template databases look (card-template.ts): the title, then what tells them apart at a glance. */
const TASK_CARD = `<b>{{ title }}</b>
<row gap=1>{{ Priority | chip }}<grow/>{{ Due | relative | muted }}</row>
{{ Owner | muted }}`;
const READING_CARD = `<b>{{ title }}</b>
<row gap=1>{{ Status | chip }} {{ Tags | chip }}</row>
<row>{{#if Rating}}{{ Rating }} ★{{/if}}<grow/>{{ Link | link }}</row>`;
const DECISION_CARD = `<b>{{ title }}</b>
<row gap=1>{{ Area | chip }}<grow/>{{ [Decided on] | date | muted }}</row>`;
const PROJECT_CARD = `<row><b>{{ title }}</b><grow/>{{ Progress | percent }}</row>
{{ Progress | bar }}
<row>{{ Owner | muted }}<grow/>{{ [Total hours] | hours | muted }}</row>`;

type Template = TemplateMeta & { build: (parentId: number | null) => number };

/** A routine's page: its controls block first (run, when, what it may do …), then the blocks that are its instructions (or notes). */
function routinePage(kind: "agent" | "automation", parentId: number | null, title: string, icon: string, intro: string): number {
  const doc = { type: "doc", content: [{ type: "zeffRoutine" }, ...(markdownToDoc(intro).content ?? [])] };
  const id = createPage({ parentId, title, icon, content: doc });
  createRoutine(id, kind);
  return id;
}

/**
 * The dashboard, full width: your day in figures across the top, then three columns — what needs you and the news (the wide one), the
 * calendar and what is unread, the workers, dates and routines. Only the widgets of installed plugins.
 */
function dashboardPage(parentId: number | null): number {
  const have = new Set(widgetCatalog().map((w) => w.id));
  const widget = (id: string, config: Record<string, unknown> = {}): DocNode[] => (have.has(id) ? [{ type: "zeffWidget", attrs: { widget: id, config: JSON.stringify(config), title: "" } }] : []);
  const col = (span: number | null, ...parts: DocNode[][]): DocNode[] => {
    const content = parts.flat();
    return content.length ? [{ type: "flexBox", attrs: { dir: "col", gap: "md", span }, content }] : [];
  };
  const columns = [
    ...col(2, widget("workspace.attention", { limit: 8 }), widget("news.top", { limit: 6 })),
    ...col(null, widget("calendar.agenda"), widget("mail.unread", { limit: 6 })),
    ...col(null, widget("work.runs"), widget("people.upcoming"), widget("workspace.routines")),
  ];
  const doc = {
    type: "doc",
    content: [...widget("workspace.overview"), ...(columns.length ? [{ type: "flexBox", attrs: { dir: "row", gap: "md" }, content: columns }] : []), { type: "paragraph" }],
  };
  const id = createPage({ parentId, title: t("Dashboard"), icon: "🧭", content: doc });
  updatePage(id, { fullWidth: true });
  return id;
}

const TEMPLATES: Template[] = [
  {
    key: "ticket-cockpit",
    category: "overview",
    get name() {
      return t("Ticket cockpit");
    },
    icon: "🧭",
    get description() {
      return t("Your tickets as cards with hours booked, open merge requests and todos, worker runs and the days since the last comment — joined live, nothing copied.");
    },
    kind: "database",
    build: (parentId) => createTicketCockpit(parentId),
  },
  {
    key: "dashboard",
    category: "overview",
    get name() {
      return t("Dashboard");
    },
    icon: "🧭",
    get description() {
      return t("Your day at a glance, live: the figures, what needs you, the calendar, unread mail, the news, the workers.");
    },
    kind: "page",
    build: (parentId) => dashboardPage(parentId),
  },
  {
    key: "agent",
    category: "automation",
    get name() {
      return t("Agent");
    },
    icon: "🤖",
    get description() {
      return t("An LLM run on the instructions you write here — by hand, on a schedule or on an event; it knows its parent and sibling pages.");
    },
    kind: "page",
    build: (parentId) => routinePage("agent", parentId, "New agent", "🤖", "Write what the agent should do — one block per instruction.\n\n- Read the pages next to this one.\n- Write what you find as a short summary under this page.\n"),
  },
  {
    key: "news-summary",
    category: "automation",
    get name() {
      return t("News summary (agent)");
    },
    icon: "📰",
    get description() {
      return t("An agent that reads the news you saved or liked and writes a summary for you — start it by hand or on a schedule.");
    },
    kind: "page",
    build: (parentId) =>
      routinePage(
        "agent",
        parentId,
        "News summary",
        "📰",
        `Read the database “${newsDatabaseTitle()}” (the news I saved or liked — find it with workspace_search, read it with workspace_read_page).

- Group the items by topic and write a short summary per topic, with the headlines as links.
- Say what is new since your last summary (look at the sub pages of this page).
- Write the result as a new sub page of this page, titled with today's date.
`,
      ),
  },
  {
    key: "automation",
    category: "automation",
    get name() {
      return t("Automation");
    },
    icon: "⚙️",
    get description() {
      return t("Steps that run one after another, with gates, branches and conditions — no AI; on a schedule, on an event or by hand.");
    },
    kind: "page",
    build: (parentId) => routinePage("automation", parentId, "New automation", "⚙️", "What this automation is for, in a line — its steps are above."),
  },  {
    key: "agent-jobs",
    category: "automation",
    get name() {
      return t("Jobs for agents");
    },
    icon: "🤖",
    get description() {
      return t("Jobs a worker takes on your click — a board by status; the result comes back into the row for your check.");
    },
    kind: "database",
    build: (parentId) => createJobsDatabase(parentId),
  },
  {
    key: "rules",
    category: "automation",
    get name() {
      return t("Rules");
    },
    icon: "📏",
    get description() {
      return t("When / then rules a pipeline applies to its records: drop, set a field, hand to an agent — or a hint every agent gets.");
    },
    kind: "database",
    build: (parentId) => createRulesDatabase(parentId),
  },
  {
    key: "meeting",
    category: "notes",
    get name() {
      return t("Meeting notes");
    },
    icon: "🗓️",
    get description() {
      return t("Attendees, agenda, notes, decisions and action items.");
    },
    kind: "page",
    build: (parentId) => meetingPage(parentId),
  },
  {
    key: "one-on-one",
    category: "notes",
    get name() {
      return t("1:1");
    },
    icon: "🤝",
    get description() {
      return t("A recurring conversation: wins, blockers, feedback, next steps.");
    },
    kind: "page",
    build: (parentId) => oneOnOnePage(parentId),
  },
  {
    key: "project-brief",
    category: "work",
    get name() {
      return t("Project brief");
    },
    icon: "🎯",
    get description() {
      return t("Goal, scope, stakeholders, milestones, risks.");
    },
    kind: "page",
    build: (parentId) => projectBriefPage(parentId),
  },
  {
    key: "weekly-review",
    category: "notes",
    get name() {
      return t("Weekly review");
    },
    icon: "🔁",
    get description() {
      return t("What got done, what didn't, what's next — and what to change.");
    },
    kind: "page",
    build: (parentId) => weeklyReviewPage(parentId),
  },
  {
    key: "wiki-home",
    category: "notes",
    get name() {
      return t("Team wiki home");
    },
    icon: "📚",
    get description() {
      return t("A start page with sections to link your pages from.");
    },
    kind: "page",
    build: (parentId) => wikiHomePage(parentId),
  },
  {
    key: "tasks",
    category: "work",
    get name() {
      return t("Tasks");
    },
    icon: "✅",
    get description() {
      return t("A task database with status, due date, priority, owner — tied to your Zeff todos and Jira tickets. Table, board and calendar views.");
    },
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
          view("Board", "board", { groupBy: status.id, hidden: [todo.id, ticket.id], card: TASK_CARD }),
          view("Calendar", "calendar", { dateProp: due.id }),
          view("Open", "table", { filter: { op: "and", rules: [{ prop: status.id, cond: "is_not", value: status.options![2].id }] } }),
        ],
      };
      const id = createPage({ parentId, title: "Tasks", icon: "✅", kind: "database", schema });
      addRow(id, { title: t("Try the board view"), cells: { [status.id]: status.options![1].id, [priority.id]: priority.options![1].id } });
      addRow(id, { title: t("Drag a card to another column"), cells: { [status.id]: status.options![0].id, [priority.id]: priority.options![0].id } });
      addRow(id, { title: t("Link a Zeff todo or a Jira ticket"), cells: { [status.id]: status.options![0].id, [priority.id]: priority.options![2].id } });
      return id;
    },
  },
  {
    key: "keep-board",
    category: "notes",
    get name() {
      return t("Keep board");
    },
    icon: "🗒️",
    get description() {
      return t("Notes like in Google Keep: cards with colours, labels and pinning, lists as checkboxes.");
    },
    kind: "database",
    build: (parentId) => createNotesBoard(parentId, t("Keep board")),
  },
  {
    key: "decisions",
    category: "work",
    get name() {
      return t("Decision log");
    },
    icon: "⚖️",
    get description() {
      return t("What was decided, by whom, when — so nobody asks twice.");
    },
    kind: "database",
    build: (parentId) => {
      const status = { ...newProperty("Status", "status"), options: [{ id: newId("o"), name: "Proposed", color: "yellow", group: "todo" as const }, { id: newId("o"), name: "Decided", color: "green", group: "done" as const }, { id: newId("o"), name: "Superseded", color: "gray", group: "done" as const }] };
      const decided = newProperty("Decided on", "date");
      const who = newProperty("Deciders", "person");
      const ticket = newProperty("Ticket", "ticket");
      const area = multi("Area", ["Frontend", "Backend", "Process", "Design"]);
      const schema: DbSchema = { titleName: "Decision", properties: [status, decided, who, area, ticket], views: [view("Table", "table", { sorts: [{ prop: decided.id, dir: "desc" }] }), view("By status", "board", { groupBy: status.id, card: DECISION_CARD })] };
      const id = createPage({ parentId, title: "Decisions", icon: "⚖️", kind: "database", schema });
      addRow(id, { title: t("We review merge requests within one working day"), cells: { [status.id]: status.options[1].id, [decided.id]: new Date().toLocaleDateString("sv-SE"), [area.id]: [area.options![2].id] } });
      addRow(id, { title: t("Design tokens come from one shared file"), cells: { [status.id]: status.options[0].id, [area.id]: [area.options![0].id, area.options![3].id] } });
      return id;
    },
  },
  {
    key: "reading-list",
    category: "notes",
    get name() {
      return t("Reading list");
    },
    icon: "📖",
    get description() {
      return t("Articles and books: status, rating, tags, link — in a gallery too.");
    },
    kind: "database",
    build: (parentId) => {
      const status = { ...newProperty("Status", "status"), options: [{ id: newId("o"), name: "To read", color: "gray", group: "todo" as const }, { id: newId("o"), name: "Reading", color: "blue", group: "doing" as const }, { id: newId("o"), name: "Read", color: "green", group: "done" as const }] };
      const rating = { ...newProperty("Rating", "number") };
      const tags = multi("Tags", ["Tech", "Design", "Business", "Fiction"]);
      const url = newProperty("Link", "url");
      const schema: DbSchema = { titleName: "Title", properties: [status, rating, tags, url], views: [view("Gallery", "gallery", { card: READING_CARD }), view("Board", "board", { groupBy: status.id, card: READING_CARD }), view("List", "table")] };
      const id = createPage({ parentId, title: "Reading list", icon: "📖", kind: "database", schema });
      addRow(id, { title: "Shape Up", cells: { [status.id]: status.options[2].id, [rating.id]: 5, [tags.id]: [tags.options![2].id], [url.id]: "https://basecamp.com/shapeup" } });
      addRow(id, { title: "Refactoring UI", cells: { [status.id]: status.options[1].id, [tags.id]: [tags.options![1].id], [url.id]: "https://www.refactoringui.com" } });
      addRow(id, { title: t("An article you want to read"), cells: { [status.id]: status.options[0].id, [tags.id]: [tags.options![0].id] } });
      return id;
    },
  },
  {
    key: "projects",
    category: "work",
    get name() {
      return t("Projects with tasks");
    },
    icon: "🗂️",
    get description() {
      return t("Two linked databases: projects and their tasks — each project rolls up its tasks' progress and hours.");
    },
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
      const projSchema: DbSchema = { titleName: "Project", properties: [owner, newProperty("Due", "date"), back, done, total], views: [view("Cards", "gallery", { card: PROJECT_CARD }), view("Table", "table")] };
      updateSchema(projects, projSchema);
      // An example: a project with three tasks, one done — its progress and hours roll up.
      const p = addRow(projects, { title: t("Website relaunch") });
      const st = getDatabase(tasks)!.schema.properties.find((x) => x.id === status.id)!.options!;
      addRow(tasks, { title: t("Collect the requirements"), cells: { [project.id]: [p], [status.id]: st[2].id, [hours.id]: 3 } });
      addRow(tasks, { title: t("Design the start page"), cells: { [project.id]: [p], [status.id]: st[1].id, [hours.id]: 5 } });
      addRow(tasks, { title: t("Go live"), cells: { [project.id]: [p], [status.id]: st[0].id } });
      return projects;
    },
  },
  {
    key: "finances",
    category: "overview",
    get name() {
      return t("Finances");
    },
    icon: "💶",
    get description() {
      return t("Your cases in figures, the payments and deadlines coming up, the open cases and what you owe — live.");
    },
    kind: "page",
    build: (parentId) => financesPage(parentId),
  },
  {
    key: "who-owes",
    category: "overview",
    get name() {
      return t("Who owes whom");
    },
    icon: "🤝",
    get description() {
      return t("What you owe your people and what they owe you — read from your messages, ticked off when kept.");
    },
    kind: "page",
    build: (parentId) => whoOwesPage(parentId),
  },
  {
    key: "authority",
    category: "notes",
    get name() {
      return t("Authority");
    },
    icon: "🏛️",
    get description() {
      return t("An office, a court, an insurer: contact, your numbers there, what runs, deadlines and a log of what you sent.");
    },
    kind: "page",
    build: (parentId) => authorityPage(parentId),
  },
  {
    key: "installment-plan",
    category: "work",
    get name() {
      return t("Instalment plans");
    },
    icon: "🧾",
    get description() {
      return t("Two linked databases: the plans (creditor, case number, total, instalment, account) and their payments — each plan sums up what is paid and what is open.");
    },
    kind: "database",
    build: (parentId) => {
      const plans = createPage({ parentId, title: t("Instalment plans"), icon: "🧾", kind: "database", schema: { titleName: t("Creditor"), properties: [], views: [view(t("Table"), "table")] } });
      const payments = createPage({ parentId, title: t("Payments"), icon: "💸", kind: "database", schema: { titleName: t("Payment"), properties: [], views: [view(t("Table"), "table")] } });
      const plan = { ...newProperty(t("Plan"), "relation"), relationDb: plans };
      const amount = { ...newProperty(t("Amount"), "number"), format: "euro" as const };
      const paidOn = newProperty(t("Paid on"), "date");
      updateSchema(payments, { titleName: t("Payment"), properties: [plan, amount, paidOn], views: [view(t("Table"), "table", { sorts: [{ prop: paidOn.id, dir: "desc" }] })] });
      const back = { ...newProperty(t("Payments"), "relation"), relationDb: payments, backOf: plan.id };
      const total = { ...newProperty(t("Total"), "number"), format: "euro" as const };
      const rate = { ...newProperty(t("Instalment"), "number"), format: "euro" as const };
      const paid = { ...newProperty(t("Paid"), "rollup"), format: "euro" as const, rollup: { relation: back.id, property: amount.id, fn: "sum" as const } };
      const open = { ...newProperty(t("Open"), "formula"), format: "euro" as const, formula: `prop(${JSON.stringify(t("Total"))}) - prop(${JSON.stringify(t("Paid"))})` };
      const caseNo = newProperty(t("Case number"), "text");
      const next = newProperty(t("Next due"), "date");
      const iban = newProperty("IBAN", "text");
      const status = { ...newProperty(t("Status"), "status"), options: [{ id: newId("o"), name: t("Running"), color: "blue", group: "doing" as const }, { id: newId("o"), name: t("Paid off"), color: "green", group: "done" as const }] };
      updateSchema(plans, { titleName: t("Creditor"), properties: [status, caseNo, total, rate, paid, open, next, iban, back], views: [view(t("Table"), "table", { sorts: [{ prop: next.id, dir: "asc" }] }), view(t("Board"), "board", { groupBy: status.id })] });
      // An example: a plan with two payments made — what is paid and open follow.
      const p = addRow(plans, { title: t("Example creditor"), cells: { [status.id]: status.options[0].id, [caseNo.id]: "DR II 123/26", [total.id]: 600, [rate.id]: 100 } });
      addRow(payments, { title: t("Instalment 1"), cells: { [plan.id]: [p], [amount.id]: 100, [paidOn.id]: new Date(Date.now() - 30 * 864e5).toLocaleDateString("sv-SE") } });
      addRow(payments, { title: t("Instalment 2"), cells: { [plan.id]: [p], [amount.id]: 100, [paidOn.id]: new Date().toLocaleDateString("sv-SE") } });
      return plans;
    },
  },
  {
    key: "contracts",
    category: "work",
    get name() {
      return t("Contracts and subscriptions");
    },
    icon: "📜",
    get description() {
      return t("What you pay regularly: cost a month and a year, until when it runs, when to cancel by, your customer number.");
    },
    kind: "database",
    build: (parentId) => {
      const monthly = { ...newProperty(t("Per month"), "number"), format: "euro" as const };
      const yearly = { ...newProperty(t("Per year"), "formula"), format: "euro" as const, formula: `prop(${JSON.stringify(t("Per month"))}) * 12` };
      const until = newProperty(t("Runs until"), "date");
      const cancel = newProperty(t("Cancel by"), "date");
      const customer = newProperty(t("Customer number"), "text");
      const kind = select(t("Kind"), [t("Insurance"), t("Subscription"), t("Utilities"), t("Phone & internet"), t("Other")]);
      const status = { ...newProperty(t("Status"), "status"), options: [{ id: newId("o"), name: t("Active"), color: "green", group: "doing" as const }, { id: newId("o"), name: t("Cancelled"), color: "gray", group: "done" as const }] };
      const schema: DbSchema = { titleName: t("Contract"), properties: [status, kind, monthly, yearly, until, cancel, customer], views: [view(t("Table"), "table", { sorts: [{ prop: cancel.id, dir: "asc" }] }), view(t("By kind"), "board", { groupBy: kind.id })] };
      const id = createPage({ parentId, title: t("Contracts"), icon: "📜", kind: "database", schema });
      addRow(id, { title: t("Example: mobile phone"), cells: { [status.id]: status.options[0].id, [kind.id]: kind.options![3].id, [monthly.id]: 15 } });
      return id;
    },
  },
];

export const templateMetas = (): TemplateMeta[] => [
  ...TEMPLATES.map(({ key, name, icon, description, kind, category }) => ({ key, name, icon, description, kind, category })),
  ...listPackages().map((p): TemplateMeta => ({ key: `pkg:${p.id}`, name: t(p.name), icon: p.icon, description: p.description ? t(p.description) : "", kind: "page", category: "packages" })),
];

/** A template made as a new page (a database: with what belongs to it). Returns the new page's id. */
export function fromTemplate(key: string, parentId: number | null): number {
  const pkg = key.startsWith("pkg:") ? listPackages().find((p) => `pkg:${p.id}` === key) : undefined;
  if (pkg) return installPackage(pkg.pkg, parentId).rootId;
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error("No such template.");
  return t.build(parentId);
}
