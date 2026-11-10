/**
 * Templates (the Workspace plugin): the built-in ready-made pages and databases — few, each complete (tasks tied to Zeff's todos,
 * projects with their tasks and a progress rollup, a journal, meeting notes, a weekly review, a reading list, contracts, a decision
 * log; the ticket cockpit with the Jira plugin) —, the plugins' packages, and your own — pages marked a template, kept out of the page
 * tree, under the Templates. One catalog for every "new from a template". Agents, automations, jobs and rules are no templates: the
 * "+" menu's "Automation …" makes them (automation-new.ts). Server only.
 */
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { installPackage, listPackages } from "./packages";
import { workspaceTemplates } from "./page-apps-point";
import { createRoutine, getRoutine } from "./routines";
import { createTicketCockpit } from "./ticket-cockpit";
import { journalPage } from "./templates-journal";
import { agendaPage } from "@/plugins/agenda/template";
import { meetingPage, weeklyReviewPage } from "./templates-pages";
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { quietly } from "./events";
import { kindIcon } from "./model";
import { createPage, duplicatePage, getPage, inTemplates, movePage, rawRows, templateTree, updatePage } from "./store";
import { contractsDatabase, decisionsDatabase, projectsPage, readingDatabase, tasksDatabase } from "./templates-databases";
import { previewParts, type MadePage, type PreviewDatabase } from "./template-preview";

/** The group a template is shown in (the gallery's tabs; "mine": your own, the pages marked a template). */
export type TemplateCategory = "work" | "notes" | "packages" | "mine";
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
const FEATURED = ["tasks", "projects", "journal", "meeting", "weekly-review"];
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

const TEMPLATES: Template[] = [
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
    key: "projects",
    category: "work",
    get name() {
      return t("Projects with tasks");
    },
    icon: "🗂️",
    get description() {
      return t("A page with two linked databases: projects (goal, owner, due) and their tasks — each project rolls up its tasks' progress and hours.");
    },
    kind: "page",
    build: (parentId) => projectsPage(parentId),
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
    key: "agenda",
    category: "notes",
    get name() {
      return t("Agenda");
    },
    icon: "📒",
    get description() {
      return t("Notes on a timeline, in projects, as in the app Agenda: dates and ranges, on the agenda, today, pinned and done notes, tags and people — and what comes up beside them.");
    },
    kind: "page",
    build: (parentId) => agendaPage(parentId),
    // (With its plugin: its screen and its form for a new note are the plugin's.)
    offered: () => isInstalled("agenda"),
  },
  {
    key: "meeting",
    category: "notes",
    get name() {
      return t("Meeting notes");
    },
    icon: "🗓️",
    get description() {
      return t("Attendees, agenda, notes, decisions and action items — with a section for a recurring 1:1.");
    },
    kind: "page",
    build: (parentId) => meetingPage(parentId),
  },
  {
    key: "weekly-review",
    category: "notes",
    get name() {
      return t("Weekly review");
    },
    icon: "🔁",
    get description() {
      return t("What got done, what didn't, what's next — the week's figures live, and an agent drafts it on Fridays.");
    },
    kind: "page",
    build: (parentId) => weeklyReviewPage(parentId),
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
    key: "ticket-cockpit",
    category: "work",
    offered: () => isInstalled("jira"),
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
];

/** The built-in templates offered now (the featured first, in their order) and the plugins' packages — each with what makes it. */
function builtins(): (TemplateMeta & { build: (parentId: number | null) => number })[] {
  return [
    ...TEMPLATES.filter((x) => x.offered?.() ?? true)
      .map(({ key, name, icon, description, kind, category, build }) => ({ key, name, icon, description, kind, category, build, featured: FEATURED.includes(key) }))
      .sort((a, b) => rank(a.key) - rank(b.key)),
    ...listPackages().map((p) => ({ key: `pkg:${p.id}`, name: t(p.name), icon: p.icon, description: p.description ? t(p.description) : "", kind: "page" as const, category: "packages" as const, build: (parentId: number | null) => installPackage(p.pkg, parentId).rootId })),
    // (A plugin's own, made by its code: Learn's learning space.)
    ...workspaceTemplates.list().flatMap((c) => c.impl.map((x) => ({ key: `plugin:${c.plugin}.${x.key}`, name: x.name, icon: x.icon, description: x.description, kind: x.kind, category: "packages" as const, build: x.build }))),
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

/** The blocks pointing at a page or database by id (a database view, an embedded page, a form …) with the ids in `map` put right. */
function remapIds(node: unknown, map: Map<number, number>): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as { attrs?: Record<string, unknown>; content?: unknown[] };
  const attrs = n.attrs && Object.fromEntries(Object.entries(n.attrs).map(([k, v]) => [k, ["dbId", "pageId", "formId"].includes(k) && map.has(Number(v)) ? map.get(Number(v)) : v]));
  return { ...n, ...(attrs ? { attrs } : {}), ...(n.content ? { content: n.content.map((c) => remapIds(c, map)) } : {}) };
}

/**
 * A page copied with what is below it — as a template of yours or as a page made of one; its routines come along, and what its pages
 * show of each other (the journal's days, the projects' boards) points at the copies.
 */
function copyTree(id: number, parentId: number | null, template: boolean): number {
  const map = new Map<number, number>();
  const top = duplicatePage(id, {
    parentId,
    suffix: false,
    template,
    onCopy: (from, to) => {
      map.set(from, to);
      const r = getRoutine(from);
      if (r) createRoutine(to, r.kind, { enabled: r.enabled, triggers: r.triggers, permissions: r.permissions, steps: r.steps, provider: r.provider });
    },
  });
  for (const to of map.values()) {
    const p = getPage(to);
    if (!p?.content || p.dbId) continue;
    const content = remapIds(p.content, map);
    if (JSON.stringify(content) !== JSON.stringify(p.content)) updatePage(to, { content });
  }
  return top;
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
  /**
   * The page it makes: its title, icon, text and width — what it would show of what is made with it (its databases, its sub pages)
   * as static cards; what is below it; the databases it makes that the page doesn't show.
   */
  page: { title: string; icon: string; content: unknown; fullWidth: boolean };
  children: { title: string; icon: string; kind: string }[];
  databases: PreviewDatabase[];
};

/** How many example rows a database's card names. */
const EXAMPLES = 3;

/**
 * A built-in template as it would be made, without keeping anything: it is made inside a savepoint (its rows' events quiet), what it
 * made read, and rolled back — the preview points at none of it (template-preview.ts). Synchronous: nothing else writes while it runs.
 */
export function previewTemplate(key: string): TemplatePreview {
  const { name, icon, description, kind, category, build: make } = builtin(key);
  const meta = { key, name, icon, description, kind, category };
  const sqlite = getSqlite();
  sqlite.exec("savepoint zeff_template_preview");
  try {
    return quietly(() => {
      const before = (sqlite.prepare("select coalesce(max(id), 0) n from ws_pages").get() as { n: number }).n;
      const rootId = make(null);
      const made = (sqlite.prepare("select id from ws_pages where id > ? and db_id is null order by id").all(before) as { id: number }[]).map((r): MadePage => {
        const p = getPage(r.id)!;
        const rows = p.kind === "database" && p.schema ? rawRows(p.id) : [];
        return {
          id: p.id,
          parentId: p.parentId,
          title: p.title,
          icon: p.icon,
          kind: p.kind,
          titleName: p.schema?.titleName,
          properties: p.schema?.properties.map((x) => ({ name: x.name, type: x.type })) ?? [],
          views: p.schema?.views.map((v) => v.name) ?? [],
          examples: rows.slice(0, EXAMPLES).map((x) => x.title).filter(Boolean),
          rows: rows.length,
        };
      });
      const root = getPage(rootId)!;
      return { ...meta, ...previewParts({ ...made.find((x) => x.id === rootId)!, content: root.content, fullWidth: root.fullWidth }, made, t) };
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
