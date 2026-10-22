import { t } from "@/lib/i18n/server";
import { setCollection } from "@/lib/items";
import { markdownToDoc, type DocNode } from "./doc";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property, type View } from "./model";
import { createRoutine, type Trigger } from "./routines";
import { addRow, createPage, updatePage } from "./store";

/**
 * The journal (the Workspace plugin): a page with a database of days — one entry a day, its headline, mood, energy, tags and what you
 * are grateful for, the thoughts on the entry's own page — drawn by a view template (the days in a list, the one picked beside it, the
 * mood in figures), and the reviews the AI writes of them: two agents, one each Monday for the week before, one on the 1st for the
 * month before (switched off until you switch them on). In your language. Server only.
 */

const day = (inDays: number) => new Date(Date.now() + inDays * 864e5).toLocaleDateString("sv-SE");
const md = (s: string): DocNode[] => (markdownToDoc(s).content ?? []) as DocNode[];
const select = (name: string, choices: [string, string][]): Property & { options: Option[] } => ({ ...newProperty(name, "select"), options: choices.map(([n, color]) => ({ id: newId("o"), name: n, color })) });
const multi = (name: string, names: string[]): Property => ({ ...newProperty(name, "multi_select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: COLORS[(i + 3) % COLORS.length] })) });
/** A view drawn from its template (view-template.ts). */
const templateView = (name: string, template: string): View => ({ ...newView(name, "app"), app: "template", template });
const q = (s: string) => s.replace(/"/g, "'");

/** The entries' view: a diary to read — the days newest first, each its date, mood and tags, its headline and what you wrote (a click opens it). */
export function journalTemplate(p: { date: string; mood: string; energy: string; tags: string; grateful: string }): string {
  return [
    // Its sidebar — in the Workspace tree under the entries (the view's setting): the newest five, each opens.
    `<nav title="${q(t("Journal"))}">{{#each rows | sort('${p.date}', 'desc') | limit(5)}}<entry label="{{ [${p.date}] | date }} · {{ title | default('…') }}" icon="✍️" group="${q(t("Newest"))}"/>{{/each}}</nav>`,
    // (A new entry: the toolbar's New — its date starts with today.)
    `<muted>{{ rows | count }} ${q(t("entries"))} · ${q(t("Average energy"))} {{ rows | avg('${p.energy}') | number(1) | default('—') }}</muted>`,
    `<list source="rows | sort('${p.date}', 'desc')" open=true spacing=roomy empty="${q(t("No entries yet — write today's."))}">`,
    `<row gap=2 align=center wrap=true><b>{{ [${p.date}] | date }}</b><small><muted>{{ [${p.date}] | relative }}</muted></small><grow/>{{ [${p.mood}] | chip }}{{ [${p.tags}] | chip }}</row>`,
    "{{#if title}}<heading level=3>{{ title }}</heading>{{/if}}",
    `{{#if text}}<text pre=true><clamp lines=12>{{ text }}</clamp></text>{{#else}}<muted>${q(t("Nothing written yet — open the entry and write."))}</muted>{{/if}}`,
    `{{#if [${p.grateful}]}}<small><muted>🙏 {{ [${p.grateful}] }}</muted></small>{{/if}}`,
    "</list>",
  ].join("\n");
}

/** The reviews' view: weekly or monthly, newest first — each its period, its summary, the review on its page (a click opens it). */
export function reviewsTemplate(p: { kind: string; week: string; month: string; from: string; to: string; summary: string }): string {
  return [
    `<state name="kind" value="${p.week}"/>`,
    `<tabs bind="kind" options="${p.week}:${q(t("Weekly"))}, ${p.month}:${q(t("Monthly"))}"/>`,
    `<list source="rows | where('${p.kind}', state.kind) | sort('${p.from}', 'desc')" open=true spacing=roomy empty="${q(t("No review yet — the agents write them (switch them on), or start one by hand."))}">`,
    `<row gap=2 align=baseline><b>{{ title }}</b><small><muted>{{ [${p.from}] | date }} – {{ [${p.to}] | date }}</muted></small></row>`,
    `{{#if [${p.summary}]}}<text>{{ [${p.summary}] }}</text>{{/if}}`,
    "{{#if text}}<text pre=true tone=muted><clamp lines=6>{{ text }}</clamp></text>{{/if}}",
    "</list>",
  ].join("\n");
}

/** An agent page's content: its controls block, then its instructions. */
export const agentDoc = (instructions: string): DocNode => ({ type: "doc", content: [{ type: "zeffRoutine" }, ...md(instructions)] });

/** An agent's page: its controls first, then its instructions — scheduled, allowed to write beside it (the journal), off until switched on. */
function agentPage(parentId: number, title: string, icon: string, instructions: string, trigger: Trigger): number {
  const id = createPage({ parentId, title, icon, content: agentDoc(instructions) });
  createRoutine(id, "agent", { triggers: [trigger], permissions: { scope: "parent" } });
  return id;
}

export function journalPage(parentId: number | null): number {
  const root = createPage({ parentId, title: t("Journal"), icon: "📓" });

  // The days.
  const date = { ...newProperty(t("Date"), "date"), defaultToday: true };
  const mood = select(t("Mood"), [
    [t("Hard"), "red"],
    [t("Meh"), "orange"],
    [t("Okay"), "gray"],
    [t("Good"), "blue"],
    [t("Great"), "green"],
  ]);
  const energy = newProperty(t("Energy"), "number");
  const tags = multi(t("Tags"), [t("Work"), t("Family"), t("Friends"), t("Health"), t("Ideas"), t("Learning")]);
  const grateful = newProperty(t("Grateful for"), "text");
  const [, , okay, good] = mood.options;
  const entriesSchema: DbSchema = {
    titleName: t("Headline"),
    properties: [date, mood, energy, tags, grateful],
    views: [
      { ...templateView(t("Journal"), journalTemplate({ date: date.name, mood: mood.name, energy: energy.name, tags: tags.name, grateful: grateful.name })), nav: "workspace" as const },
      { ...newView(t("Calendar"), "calendar"), dateProp: date.id },
      { ...newView(t("Table"), "table"), sorts: [{ prop: date.id, dir: "desc" }] },
    ],
  };
  const entries = createPage({ parentId: root, title: t("Journal entries"), icon: "✍️", kind: "database", schema: entriesSchema });
  // (Its entries go into the knowledge — their day, mood and thoughts; the reviews stay out.)
  setCollection(`workspace:${entries}`, { knowledge: true });
  addRow(entries, { title: t("Started the journal"), cells: { [date.id]: day(0), [mood.id]: good.id, [energy.id]: 4, [tags.id]: [tags.options![4].id], [grateful.id]: t("Ten quiet minutes in the evening") } });
  addRow(entries, { title: t("A long day, but the hard part is done"), cells: { [date.id]: day(-1), [mood.id]: okay.id, [energy.id]: 2, [tags.id]: [tags.options![0].id] } });

  // The reviews the agents write.
  const kind = select(t("Kind"), [
    [t("Week"), "blue"],
    [t("Month"), "purple"],
  ]);
  const from = newProperty(t("From"), "date");
  const to = newProperty(t("To"), "date");
  const summary = newProperty(t("Summary"), "text");
  const count = newProperty(t("Journal entries"), "number");
  const avgEnergy = newProperty(t("Average energy"), "number");
  const reviewsSchema: DbSchema = {
    titleName: t("Review"),
    properties: [kind, from, to, summary, count, avgEnergy],
    views: [
      templateView(t("Reviews"), reviewsTemplate({ kind: kind.name, week: kind.options[0].name, month: kind.options[1].name, from: from.name, to: to.name, summary: summary.name })),
      { ...newView(t("Table"), "table"), sorts: [{ prop: from.id, dir: "desc" }] },
    ],
  };
  const reviews = createPage({ parentId: root, title: t("Reviews"), icon: "🔁", kind: "database", schema: reviewsSchema });

  updatePage(root, { fullWidth: true, content: journalIntro({ entries, entriesView: entriesSchema.views[0].id, reviews, reviewsView: reviewsSchema.views[0].id }) });
  const on = { entries, reviews, kind, fields: [kind, from, to, summary, count, avgEnergy] };
  agentPage(root, t("Weekly review"), "🗓️", reviewInstructions("week", on), { kind: "schedule", at: "07:00", days: [1] });
  agentPage(root, t("Monthly review"), "🌙", reviewInstructions("month", on), { kind: "schedule", at: "07:30", monthDay: 1 });
  return root;
}

/** The journal page itself: what it is for, the days, the latest reviews. */
export function journalIntro(v: { entries: number; entriesView: string; reviews: number; reviewsView: string }): DocNode {
  return {
    type: "doc",
    content: [
      ...md(`:::callout 📓 gray\n${t("One entry a day: a headline, how it was, and your thoughts on the entry's page. Each Monday the AI looks back on the week, on the 1st on the month — switch the two agents below on.")}\n:::`),
      { type: "databaseView", attrs: { dbId: v.entries, viewId: v.entriesView, title: "" } },
      { type: "databaseView", attrs: { dbId: v.reviews, viewId: v.reviewsView, title: "" } },
      { type: "paragraph" },
    ],
  };
}

/** A review agent's instructions (markdown): what it reads, when it stops, what it writes where — the week before, or the month. */
export function reviewInstructions(which: "week" | "month", v: { entries: number; reviews: number; kind: Property & { options: Option[] }; fields: Property[] }): string {
  const fields = `${t("Fields")}: ${v.fields.map((x) => `„${x.name}“`).join(", ")}`;
  const week = which === "week";
  const steps = [
    t("Read the journal's entries of {period} — the database “{entries}” (id {entriesId}): workspace_query_database, and each entry's page with workspace_read_page (the thoughts are there).", { period: week ? t("last week") : t("last month"), entries: t("Journal entries"), entriesId: v.entries }),
    t("If there is a review of this period in “{reviews}” (id {reviewsId}) already, stop. If there are no entries, stop too.", { reviews: t("Reviews"), reviewsId: v.reviews }),
    t("Write the review as a new row of “{reviews}” (workspace_add_row) — {kind}: “{kindName}”, the title the period (e.g. “Week 43” or “October 2026”); {fields}. The summary: two or three sentences.", { reviews: t("Reviews"), kind: v.kind.name, kindName: v.kind.options[week ? 0 : 1].name, fields }),
    t("The row's page (markdown): how the period was, in a few sentences; the themes that came up again and again; what went well and what weighed; how mood and energy moved; open thoughts and questions worth taking further; and one or two suggestions for the next period."),
    week ? "" : t("Read the month's weekly reviews in “{reviews}” too — the month is more than their sum: what changed over the weeks?", { reviews: t("Reviews") }),
    t("Write warmly and honestly, in the language the entries are written in. Quote the entries briefly where it helps; invent nothing."),
  ];
  const lead = week ? t("Look back on last week (Monday to Sunday) of my journal.") : t("Look back on last month of my journal.");
  return `${lead}\n\n${steps
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join("\n")}\n`;
}
