/**
 * Ready-made pages and databases (the Workspace plugin): a meeting, a project brief, a weekly review,
 * a decision log, tasks tied to Zeff's todos, projects with their tasks and a progress rollup. Server only.
 */
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { markdownToDoc, type DocNode } from "./doc";
import { createJobsDatabase } from "./jobs";
import { createRulesDatabase } from "./rules";
import { createNotesBoard } from "./notes-board";
import { newsDatabaseTitle } from "./news-database";
import { installPackage, listPackages } from "./packages";
import { widgetCatalog } from "./widgets";
import { createRoutine } from "./routines";
import { createTicketCockpit } from "./ticket-cockpit";
import { authorityPage, financesPage, meetingPage, oneOnOnePage, projectBriefPage, weeklyReviewPage, whoOwesPage, wikiHomePage } from "./templates-pages";
import { getPref, setPref } from "@/lib/prefs";
import { createPage, getPage, updatePage } from "./store";
import { contractsDatabase, decisionsDatabase, instalmentPlansDatabase, projectsDatabase, readingDatabase, tasksDatabase } from "./templates-databases";

/** The group a template is shown in (the gallery's tabs). */
export type TemplateCategory = "overview" | "work" | "notes" | "automation" | "packages";
export type TemplateMeta = {
  key: string;
  name: string;
  icon: string;
  description: string;
  kind: "page" | "database";
  category: TemplateCategory;
  /** Shown first, large — where most start. */
  featured?: boolean;
  /** What was made of it before and is still there (the gallery offers to open it instead of a second one). */
  made?: { id: number; title: string }[];
};

/** Where the templates' pages are kept (per template, the pages made of it — newest last). */
const MADE = "workspace.templatesMade";
/** The templates most start with (in this order). */
const FEATURED = ["dashboard", "tasks", "finances", "weekly-review", "meeting", "contracts"];
const rank = (key: string) => (FEATURED.includes(key) ? FEATURED.indexOf(key) : FEATURED.length);

function madeOf(key: string): { id: number; title: string }[] {
  const ids = getPref<Record<string, number[]>>(MADE, {})[key] ?? [];
  return ids.flatMap((id) => {
    const p = getPage(id);
    return p && !p.archivedAt ? [{ id, title: p.title }] : [];
  });
}


type Template = TemplateMeta & {
  build: (parentId: number | null) => number | Promise<number>;
  /** Offered only while this holds (a template another plugin does better is left out then). */
  offered?: () => boolean;
};

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
    build: (parentId) => routinePage("agent", parentId, t("New agent"), "🤖", `${t("Write what the agent should do — one block per instruction.")}\n\n- ${t("Read the pages next to this one.")}\n- ${t("Write what you find as a short summary under this page.")}\n`),
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
        t("News summary"),
        "📰",
        `${t("Read the database “{name}” (the news I saved or liked — find it with workspace_search, read it with workspace_read_page).", { name: newsDatabaseTitle() })}

- ${t("Group the items by topic and write a short summary per topic, with the headlines as links.")}
- ${t("Say what is new since your last summary (look at the sub pages of this page).")}
- ${t("Write the result as a new sub page of this page, titled with today's date.")}
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
    build: (parentId) => routinePage("automation", parentId, t("New automation"), "⚙️", t("What this automation is for, in a line — its steps are above.")),
  },
  {
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
    build: (parentId) => tasksDatabase(parentId),
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
    build: (parentId) => decisionsDatabase(parentId),
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
    build: (parentId) => readingDatabase(parentId),
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
    build: (parentId) => projectsDatabase(parentId),
  },
  {
    key: "finances",
    category: "overview",
    get name() {
      return t("Finances");
    },
    icon: "💶",
    get description() {
      return isInstalled("finances")
        ? t("Your money at a glance, live: what is open, the instalments a month, when you are debt-free, what is left — and the payments coming up.")
        : t("Your cases in figures, the payments and deadlines coming up, the open cases and what you owe — live.");
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
    key: "debts",
    category: "overview",
    get name() {
      return t("Debts and claims");
    },
    icon: "💶",
    get description() {
      return t("Whom you owe what and who owes you: each debt with its plan, the instalments a month, when you are debt-free — your cases' debts come by themselves.");
    },
    kind: "database",
    offered: () => isInstalled("finances"),
    // One for all: the Finances plugin's database (made once) — the template opens it.
    build: async () => {
      const id = await (await import("@/plugins/finances/database")).ensureDebtsDatabase();
      if (!id) throw new Error(t("The debts database couldn't be made."));
      return id;
    },
  },
  {
    key: "installment-plan",
    category: "work",
    offered: () => !isInstalled("finances"),
    get name() {
      return t("Instalment plans");
    },
    icon: "🧾",
    get description() {
      return t("Two linked databases: the plans (creditor, case number, total, instalment, account) and their payments — each plan sums up what is paid and what is open.");
    },
    kind: "database",
    build: (parentId) => instalmentPlansDatabase(parentId),
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
    build: (parentId) => contractsDatabase(parentId),
  },
];

export const templateMetas = (): TemplateMeta[] => [
  ...TEMPLATES.filter((x) => x.offered?.() ?? true)
    .map(({ key, name, icon, description, kind, category }): TemplateMeta => ({ key, name, icon, description, kind, category, featured: FEATURED.includes(key), made: madeOf(key) }))
    // The featured first, in their order; the rest as they are.
    .sort((a, b) => rank(a.key) - rank(b.key)),
  ...listPackages().map((p): TemplateMeta => ({ key: `pkg:${p.id}`, name: t(p.name), icon: p.icon, description: p.description ? t(p.description) : "", kind: "page", category: "packages" })),
];

/** A template made as a new page (a database: with what belongs to it). Returns the new page's id. */
export async function fromTemplate(key: string, parentId: number | null): Promise<number> {
  const pkg = key.startsWith("pkg:") ? listPackages().find((p) => `pkg:${p.id}` === key) : undefined;
  if (pkg) return installPackage(pkg.pkg, parentId).rootId;
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error("No such template.");
  const id = await t.build(parentId);
  const made = getPref<Record<string, number[]>>(MADE, {});
  setPref(MADE, { ...made, [key]: [...(made[key] ?? []).filter((x) => x !== id), id].slice(-10) });
  return id;
}
