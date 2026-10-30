/**
 * Templates (the Workspace plugin): the built-in ready-made pages and databases (a meeting, a project brief, a weekly review, a
 * decision log, tasks tied to Zeff's todos, projects with their tasks and a progress rollup …), the plugins' packages, and your own —
 * pages marked a template, kept out of the page tree, under the Templates. One catalog for every "new from a template". Server only.
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
import { createRoutine, getRoutine } from "./routines";
import { createTicketCockpit } from "./ticket-cockpit";
import { journalPage } from "./templates-journal";
import { authorityPage, financesPage, meetingPage, oneOnOnePage, projectBriefPage, weeklyReviewPage, whoOwesPage } from "./templates-pages";
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { quietly } from "./events";
import { kindIcon } from "./model";
import { createPage, duplicatePage, getPage, inTemplates, movePage, rawRows, templateTree, updatePage } from "./store";
import { contractsDatabase, decisionsDatabase, instalmentPlansDatabase, projectsDatabase, readingDatabase, tasksDatabase } from "./templates-databases";

/** The group a template is shown in (the gallery's tabs; "mine": your own, the pages marked a template). */
export type TemplateCategory = "overview" | "work" | "notes" | "automation" | "packages" | "mine";
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
  build: (parentId: number | null) => number;
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
    key: "journal",
    category: "notes",
    get name() {
      return t("Journal");
    },
    icon: "📓",
    get description() {
      return t("One entry a day for your thoughts, mood and energy — and the AI writes a weekly and a monthly review of them.");
    },
    kind: "page",
    build: (parentId) => journalPage(parentId),
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

/** The built-in templates offered now (the featured first, in their order) and the plugins' packages — each with what makes it. */
function builtins(): (TemplateMeta & { build: (parentId: number | null) => number })[] {
  return [
    ...TEMPLATES.filter((x) => x.offered?.() ?? true)
      .map(({ key, name, icon, description, kind, category, build }) => ({ key, name, icon, description, kind, category, build, featured: FEATURED.includes(key) }))
      .sort((a, b) => rank(a.key) - rank(b.key)),
    ...listPackages().map((p) => ({ key: `pkg:${p.id}`, name: t(p.name), icon: p.icon, description: p.description ? t(p.description) : "", kind: "page" as const, category: "packages" as const, build: (parentId: number | null) => installPackage(p.pkg, parentId).rootId })),
  ];
}
const builtin = (key: string) => {
  const b = builtins().find((x) => x.key === key);
  if (!b) throw new Error(t("There is no such template."));
  return b;
};
/** Your own template's page (key "page:<id>"), or null. */
const ownId = (key: string): number | null => (/^page:\d+$/.test(key) ? Number(key.slice(5)) : null);

/**
 * Every template — the built-in ones, the plugins' packages and your own (the pages marked a template): what the Templates in the
 * tree show and what every "new from a template" offers.
 */
export const templateMetas = (): TemplateMeta[] => [
  ...builtins().map(({ key, name, icon, description, kind, category, featured }): TemplateMeta => ({ key, name, icon, description, kind, category, featured, ...(category === "packages" ? {} : { made: madeOf(key) }) })),
  ...templateTree()
    .filter((x) => x.template)
    .map((x): TemplateMeta => ({ key: `page:${x.id}`, name: x.title || t("Untitled"), icon: x.icon || kindIcon(x.kind), description: "", kind: x.kind === "database" ? "database" : "page", category: "mine" })),
];

/** A page copied with what is below it — as a template of yours or as a page made of one; its routines come along. */
function copyTree(id: number, parentId: number | null, template: boolean): number {
  return duplicatePage(id, {
    parentId,
    suffix: false,
    template,
    onCopy: (from, to) => {
      const r = getRoutine(from);
      if (r) createRoutine(to, r.kind, { enabled: r.enabled, triggers: r.triggers, permissions: r.permissions, steps: r.steps, provider: r.provider });
    },
  });
}

/** A template made as a new page (a database: with what belongs to it) — a built-in one or one of yours. Returns the new page's id. */
export async function fromTemplate(key: string, parentId: number | null): Promise<number> {
  const own = ownId(key);
  if (own !== null) {
    if (!inTemplates(own)) throw new Error(t("There is no such template."));
    return copyTree(own, parentId, false);
  }
  const id = builtin(key).build(parentId);
  if (!key.startsWith("pkg:")) {
    const made = getPref<Record<string, number[]>>(MADE, {});
    setPref(MADE, { ...made, [key]: [...(made[key] ?? []).filter((x) => x !== id), id].slice(-10) });
  }
  return id;
}

export type TemplatePreview = Omit<TemplateMeta, "made"> & {
  /** The page it makes: its title, icon, text and width; what is below it; the databases it makes (the page itself or below). */
  page: { title: string; icon: string; content: unknown; fullWidth: boolean };
  children: { title: string; icon: string; kind: string }[];
  databases: { title: string; icon: string; properties: { name: string; type: string }[]; views: string[]; rows: number }[];
};

/**
 * A built-in template as it would be made, without keeping anything: it is made inside a savepoint (its rows' events quiet), read,
 * and rolled back. Synchronous: nothing else writes while it runs.
 */
export function previewTemplate(key: string): TemplatePreview {
  const { name, icon, description, kind, category, build: make } = builtin(key);
  const meta = { key, name, icon, description, kind, category };
  const sqlite = getSqlite();
  sqlite.exec("savepoint zeff_template_preview");
  try {
    return quietly(() => {
      const before = (sqlite.prepare("select coalesce(max(id), 0) n from ws_pages").get() as { n: number }).n;
      const root = getPage(make(null))!;
      const made = (sqlite.prepare("select id from ws_pages where id > ? and db_id is null order by id").all(before) as { id: number }[]).map((r) => getPage(r.id)!);
      const databases = made
        .filter((p) => p.kind === "database" && p.schema)
        .map((p) => ({ title: p.title, icon: p.icon, properties: p.schema!.properties.map((x) => ({ name: x.name, type: x.type })), views: p.schema!.views.map((v) => v.name), rows: rawRows(p.id).length }));
      return {
        ...meta,
        page: { title: root.title, icon: root.icon, content: root.content, fullWidth: root.fullWidth },
        children: made.filter((p) => p.parentId === root.id).map((p) => ({ title: p.title, icon: p.icon, kind: p.kind })),
        databases,
      };
    });
  } finally {
    sqlite.exec("rollback to zeff_template_preview");
    sqlite.exec("release zeff_template_preview");
  }
}

/** A built-in template made as a template of yours (at the top of your templates; what it makes beside its page kept together under one). Returns its page. */
export function duplicateBuiltin(key: string): number {
  const b = builtin(key);
  const sqlite = getSqlite();
  const before = (sqlite.prepare("select coalesce(max(id), 0) n from ws_pages").get() as { n: number }).n;
  let root = b.build(null);
  const tops = (sqlite.prepare("select id from ws_pages where id > ? and db_id is null and parent_id is null order by id").all(before) as { id: number }[]).map((r) => r.id);
  if (tops.length > 1) {
    root = createPage({ title: b.name, icon: b.icon });
    for (const id of tops) movePage(id, root);
  }
  updatePage(root, { template: true });
  return root;
}

/** A page copied into your templates (the page itself stays). Returns the template's page. */
export const saveAsTemplate = (id: number): number => copyTree(id, null, true);

/**
 * A page moved into your templates (to their top) — or out of them: back into the page tree (a page below a template: to the top of it).
 */
export function setTemplate(id: number, on: boolean): void {
  const p = getPage(id);
  if (!p || p.dbId) throw new Error(t("This page is gone."));
  if (on) {
    if (!inTemplates(id)) movePage(id, null);
  } else if (p.parentId !== null && inTemplates(p.parentId)) movePage(id, null);
  updatePage(id, { template: on });
}
