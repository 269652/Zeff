import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/**
 * Agenda's screen (the Agenda plugin): the notes as a timeline — all, on the agenda, today, done; by project, searched — and beside
 * it what is on the agenda and what comes up; the toolbar's New opens the form for a new note (a part of the plugin). The names of the
 * fields come in, so a database made in one language reads in it. Client-safe.
 */

export type AgendaNames = { date: string; project: string; agenda: string; pinned: string; done: string; tags: string; people: string };

const q = (s: string) => s.replace(/"/g, "'");

/** The names the template gives its fields (agendaPage makes them so). */
export const agendaNames = (t: T): AgendaNames => ({ date: t("Date"), project: t("Project"), agenda: t("On the agenda"), pinned: t("Pinned"), done: t("Done"), tags: t("Tags"), people: t("People") });

/** The notes' screen: the timeline in the middle, what is on the agenda and what comes up beside it. */
export function agendaScreen(n: AgendaNames, t: T): string {
  const f = (name: string) => `[${name}]`;
  const open = `where('${n.done}', '!=', true)`;
  const timeline = (source: string, empty: string) =>
    [
      `<timeline source="rows | search(state.q) | only('${n.project}', state.p) | ${source} | sort('${n.date}', 'desc') | sort('${n.pinned}', 'desc')" date="{{ ${f(n.date)} | date }}" page=30 more="${q(t("Show more"))}" empty="${q(empty)}">`,
      `<row wrap=false gap=2><col fill=true><b>{{ title | default('…') }}</b></col>{{#if ${f(n.pinned)}}}<small>📌</small>{{/if}}{{ ${f(n.project)} | chip }}</row>`,
      `{{#if ${f(n.tags)}}}<row gap=1>{{ ${f(n.tags)} | chip }}{{ ${f(n.people)} | chip }}</row>{{/if}}`,
      `{{#if text}}<text pre=true><clamp lines=8>{{ text }}</clamp></text>{{/if}}`,
      `<row gap=1><button action="toggle" prop="${n.agenda}" label="{{ ${f(n.agenda)} ? '● ${q(t("On the agenda"))}' : '○ ${q(t("On the agenda"))}' }}" variant=quiet/><button action="toggle" prop="${n.done}" label="{{ ${f(n.done)} ? '✓ ${q(t("Done"))}' : '○ ${q(t("Done"))}' }}" variant=quiet/><button action="toggle" prop="${n.pinned}" label="📌" tip="${q(t("Pin to the top"))}" variant=quiet/><button action="open" label="${q(t("Open"))}" variant=quiet/></row>`,
      "</timeline>",
    ].join("\n");
  return [
    `<state name="p" value=""/><state name="scope" value="all"/><state name="q" value=""/><state name="adding" value=""/>`,
    // The toolbar's New: the form for a new note (view-parts.tsx).
    `<part name="agenda.new" date="${n.date}" project="${n.project}" agenda="${n.agenda}" pinned="${n.pinned}" tags="${n.tags}"/>`,
    "<panes>",
    `<pane title="${q(t("Notes"))}" aside="{{ rows | ${open} | count }}">`,
    `<toolbar><search bind="q" placeholder="${q(t("Search notes"))}"/><tabs bind="scope" options="all:${q(t("All"))}, agenda:${q(t("On the agenda"))}, today:${q(t("Today"))}, done:${q(t("Done"))}"/></toolbar>`,
    // The projects to pick: those with open notes — one with only done notes shows up under Done, as in Agenda.
    `{{#if state.scope == 'done'}}<facets bind="p" field="${n.project}" source="rows | where('${n.done}', true)" all="${q(t("All projects"))}"/>{{#else}}<facets bind="p" field="${n.project}" source="rows | ${open}" all="${q(t("All projects"))}"/>{{/if}}`,
    `<quickadd placeholder="${q(t("New note …"))}"/>`,
    `{{#if state.scope == 'all'}}${timeline(open, t("No notes yet: write the first one above."))}{{/if}}`,
    `{{#if state.scope == 'agenda'}}${timeline(`where('${n.agenda}', true) | ${open}`, t("Nothing on the agenda: put a note there with ○ On the agenda."))}{{/if}}`,
    `{{#if state.scope == 'today'}}${timeline(`where('${n.date}', now)`, t("No note for today."))}{{/if}}`,
    `{{#if state.scope == 'done'}}${timeline(`where('${n.done}', true)`, t("No note marked done yet."))}{{/if}}`,
    "</pane>",
    `<pane title="${q(t("On the agenda"))}" aside="{{ rows | where('${n.agenda}', true) | ${open} | count }}" width=320>`,
    `<list source="rows | where('${n.agenda}', true) | ${open} | sort('${n.date}')" open=true empty="${q(t("Nothing on the agenda."))}"><row wrap=false gap=2><col fill=true><truncate><b>{{ title | default('…') }}</b></truncate><small><muted>{{ ${f(n.date)} | date }}</muted></small></col><button action="toggle" prop="${n.done}" label="✓" tip="${q(t("Done"))}" variant=quiet/></row></list>`,
    `<divider label="${q(t("Coming up"))}"/>`,
    `<list source="rows | where('${n.date}', '>=', now) | ${open} | sort('${n.date}') | limit(8)" open=true empty="${q(t("Nothing dated ahead."))}"><row wrap=false gap=2><col fill=true><truncate>{{ title | default('…') }}</truncate></col><small><muted>{{ ${f(n.date)} | relative }}</muted></small></row></list>`,
    "</pane>",
    "</panes>",
  ].join("\n");
}

export const AGENDA_VIEW: ViewAppMeta = {
  app: "agenda",
  label: "Agenda",
  parts: [{ name: "agenda.new", description: "The form for a new note (title, date or range, project, on the agenda, pinned, tags, text) — shown while state.adding is true; the toolbar's New opens it", attrs: { date: "the date field's name", project: "the project relation's name", agenda: "the 'on the agenda' checkbox's name", pinned: "the 'pinned' checkbox's name", tags: "the tags field's name" } }],
  actions: [{ name: "agenda.new", description: "open the form for a new note" }],
  appData: "",
  defaultTemplate: (t) => agendaScreen(agendaNames(t), t),
};
