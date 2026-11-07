import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { markdownToDoc } from "@/plugins/workspace/doc";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property, type View } from "@/plugins/workspace/model";
import { addRow, createPage, updatePage, updateSchema } from "@/plugins/workspace/store";
import { ensureAgenda } from "./upgrade";
import { agendaNames } from "./view-template.meta";

/**
 * Agenda (the Agenda plugin): notes on a timeline, in projects, like the app Agenda — a note has a date (or a range), stands in a
 * project, can be put "on the agenda", pinned, marked done, tagged and name people; its text, checklists, tables, pictures and links
 * to other notes are its page. One screen: the notes as a timeline (all, on the agenda, today, done; by project, searched), beside it
 * what is on the agenda and what comes up. The projects are a database of their own, by category. Your language. Server only.
 */

const select = (name: string, kind: "select" | "multi_select", choices: string[]): Property & { options: Option[] } => ({ ...newProperty(name, kind), options: choices.map((n, i): Option => ({ id: newId("o"), name: n, color: COLORS[(i + 2) % COLORS.length] })) });
const templateView = (name: string, template: string): View => ({ ...newView(name, "app"), app: "template", template });
const q = (s: string) => s.replace(/"/g, "'");
const day = (inDays: number) => new Date(Date.now() + inDays * 864e5).toLocaleDateString("sv-SE");

/** The projects' screen: by category, each with its notes' count. */
function projectsTemplate(p: { category: string; notes: string; archived: string }): string {
  const f = (name: string) => `[${name}]`;
  return [
    `<quickadd placeholder="${q(t("New project …"))}"/>`,
    `<groups source="rows | where('${p.archived}', '!=', true)" by="${p.category}" none="${q(t("Without a category"))}"><section title="{{ group }}" aside="{{ rows | count }}"><list source="rows" open=true><row wrap=false gap=2><col fill=true><b>{{ title }}</b></col><small><muted>{{ ${f(p.notes)} | count }} ${q(t("notes"))}</muted></small></row></list></section></groups>`,
  ].join("\n");
}

export function agendaPage(parentId: number | null): number {
  const root = createPage({ parentId, title: t("Agenda"), icon: "📒" });

  // The projects, by category.
  const category = select(t("Category"), "select", [t("Personal"), t("Family"), t("Home"), t("Work")]);
  const archived = newProperty(t("Archived"), "checkbox");
  const projects = createPage({ parentId: root, title: t("Projects"), icon: "🗂️", kind: "database", schema: { titleName: t("Project"), properties: [category, archived], views: [newView(t("Table"), "table")] } });

  // The notes.
  const date = newProperty(agendaNames(t).date, "date");
  const project = { ...newProperty(t("Project"), "relation"), relationDb: projects };
  const agenda = newProperty(t("On the agenda"), "checkbox");
  const pinned = newProperty(t("Pinned"), "checkbox");
  const done = newProperty(t("Done"), "checkbox");
  const tags = select(t("Tags"), "multi_select", []);
  // People are the People plugin's contacts where it is installed, else names.
  const people = isInstalled("people") ? newProperty(t("People"), "person") : select(t("People"), "multi_select", []);
  const notesSchema: DbSchema = {
    titleName: t("Note"),
    properties: [date, project, agenda, pinned, done, tags, people],
    dataType: "agenda",
    // (Its screen drawn by the upgrade below, with the reminder and the calendar's event it adds: a bare mark of an older version here.)
    views: [{ ...newView(t("Agenda"), "app"), app: "agenda", template: '<part name="agenda.new"/>' }, { ...newView(t("Calendar"), "calendar"), dateProp: date.id }, { ...newView(t("Table"), "table"), sorts: [{ prop: date.id, dir: "desc" }] }],
  };
  const notes = createPage({ parentId: root, title: t("Notes"), icon: "📝", kind: "database", schema: notesSchema });
  ensureAgenda(notes);

  // The projects see their notes.
  const back = { ...newProperty(t("Notes"), "relation"), relationDb: notes, backOf: project.id };
  updateSchema(projects, { titleName: t("Project"), properties: [category, archived, back], views: [templateView(t("Projects"), projectsTemplate({ category: category.name, notes: back.name, archived: archived.name })), newView(t("Table"), "table")] });

  // A start: a project and three notes that show what a note can be.
  const home = addRow(projects, { title: t("Getting started"), cells: { [category.id]: category.options[0].id } });
  const first = addRow(notes, { title: t("Welcome to your agenda"), cells: { [date.id]: day(0), [project.id]: [home], [agenda.id]: true, [pinned.id]: true } });
  updatePage(first, { content: markdownToDoc(t("Every note has a date, or none. Put what matters now on the agenda (○), pin what should stay on top (📌), mark what is done (✓). Open a note to write: lists, checklists, tables, pictures and links to other notes.")) });
  const call = addRow(notes, { title: t("Call the doctor"), cells: { [date.id]: day(1), [project.id]: [home], [agenda.id]: true } });
  // (The example's checklist is no todo of yours: switched off, as any list can be.)
  const example = markdownToDoc(`- [ ] ${t("Ask about the appointment")}\n- [ ] ${t("Bring the card")}`);
  updatePage(call, { content: { ...example, content: (example.content ?? []).map((n) => (n.type === "taskList" ? { ...n, attrs: { ...(n.attrs ?? {}), engine: false } } : n)) } });
  addRow(notes, { title: t("Ideas for the garden"), cells: { [project.id]: [home] } });

  updatePage(root, { fullWidth: true, content: { type: "doc", content: [{ type: "databaseView", attrs: { dbId: notes, viewId: notesSchema.views[0].id, title: "" } }, { type: "paragraph" }] } });
  return root;
}
