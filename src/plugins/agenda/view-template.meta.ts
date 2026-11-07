import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/**
 * Agenda's screen (the Agenda plugin), as the app Agenda is: a sidebar with the overviews (all notes, on the agenda, today, coming
 * up, reminders, done) and the projects by category; in the middle the notes as a timeline — searched, by tag and person, the done
 * ones shown on request; beside it what is on the agenda, today's events of the calendar, the reminders and what comes up. The
 * toolbar's New opens the form for a new note (a part of the plugin). The names of the fields come in, so a database made in one
 * language reads in it. Client-safe.
 */

/** The screen's version: a screen of an older one is redrawn by the upgrade (upgrade.ts); one of this version stays as it is. */
export const AGENDA_VERSION = "2";

export type AgendaNames = { date: string; project: string; agenda: string; pinned: string; done: string; tags: string; people: string; reminder: string; /** "": no calendar. */ event: string };

const q = (s: string) => s.replace(/"/g, "'");

/** The names the template gives its fields (agendaPage makes them so). */
export const agendaNames = (t: T): AgendaNames => ({ date: t("Date"), project: t("Project"), agenda: t("On the agenda"), pinned: t("Pinned"), done: t("Done"), tags: t("Tags"), people: t("People"), reminder: t("Reminder"), event: t("Event") });

/** The notes' screen. */
export function agendaScreen(n: AgendaNames, t: T): string {
  const f = (name: string) => `[${name}]`;
  const open = `where('${n.done}', '!=', true)`;
  // What every scope starts from: searched, the project, the tag and the person picked.
  const base = `rows | search(state.q) | only('${n.project}', state.p) | only('${n.tags}', state.tag) | only('${n.people}', state.who)`;
  const timeline = (source: string, empty: string, dir = "desc") =>
    [
      `<timeline source="${base} | ${source} | sort('${n.date}', '${dir}') | sort('${n.pinned}', 'desc')" date="{{ ${f(n.date)} | date }}" page=30 more="${q(t("Show more"))}" empty="${q(empty)}">`,
      `<row wrap=false gap=2 align=center><col fill=true>{{#if ${f(n.done)}}}<strike>{{ title | default('…') }}</strike>{{#else}}<b>{{ title | default('…') }}</b>{{/if}}</col><todomark/>{{#if ${f(n.pinned)}}}<small>📌</small>{{/if}}{{ ${f(n.project)} | chip }}</row>`,
      `{{#if ${f(n.tags)}}}<row gap=1>{{ ${f(n.tags)} | chip }}{{ ${f(n.people)} | chip }}</row>{{/if}}`,
      `{{#if ${f(n.reminder)}}}<small><muted>⏰ {{ ${f(n.reminder)} | date }}</muted></small>{{/if}}`,
      n.event ? `{{#if ${f(n.event)}}}<small><muted>📅 {{ ${f(n.event)} }}</muted></small>{{/if}}` : "",
      `{{#if text}}<text pre=true><clamp lines=8>{{ text }}</clamp></text>{{/if}}`,
      `<row gap=1><button action="toggle" prop="${n.agenda}" label="{{ ${f(n.agenda)} ? '● ${q(t("On the agenda"))}' : '○ ${q(t("On the agenda"))}' }}" variant=quiet/><button action="toggle" prop="${n.done}" label="{{ ${f(n.done)} ? '✓ ${q(t("Done"))}' : '○ ${q(t("Done"))}' }}" variant=quiet/><button action="toggle" prop="${n.pinned}" label="📌" tip="${q(t("Pin to the top"))}" variant=quiet/><button action="open" label="${q(t("Open"))}" variant=quiet/></row>`,
      "</timeline>",
    ]
      .filter(Boolean)
      .join("\n");
  const scope = (value: string, body: string) => `{{#if state.scope == '${value}'}}${body}{{/if}}`;
  const entry = (value: string, icon: string, label: string, count: string) => `<entry label="${q(label)}" icon="${icon}" state="scope" value="${value}" n="{{ rows | ${count} | count }}" group="${q(t("Overview"))}"/>`;
  return [
    `<state name="v" value="${AGENDA_VERSION}"/><state name="p" value=""/><state name="scope" value="all"/><state name="q" value=""/><state name="adding" value=""/><state name="tag" value=""/><state name="who" value=""/><state name="showdone" value=""/>`,
    // The toolbar's New: the form for a new note (view-parts.tsx).
    `<part name="agenda.new" date="${n.date}" project="${n.project}" agenda="${n.agenda}" pinned="${n.pinned}" tags="${n.tags}" reminder="${n.reminder}"/>`,
    // The sidebar: the overviews, then the projects by category (the archived ones not).
    `<nav title="${q(t("Agenda"))}">`,
    entry("all", "📒", t("All notes"), open),
    entry("agenda", "●", t("On the agenda"), `where('${n.agenda}', true) | ${open}`),
    entry("today", "📅", t("Today"), `where('${n.date}', now)`),
    entry("upcoming", "⏭", t("Coming up"), `where('${n.date}', '>=', now) | ${open}`),
    entry("reminders", "⏰", t("Reminders"), `where('${n.reminder}', 'filled') | ${open}`),
    entry("done", "✓", t("Done"), `where('${n.done}', true)`),
    `<entry label="${q(t("All projects"))}" icon="🗂️" state="p" value="" group="${q(t("Projects"))}"/>`,
    `{{#each app.projects}}<entry label="{{ title }}" icon="{{ icon }}" state="p" value="{{ title }}" n="{{ open }}" group="{{ category }}"/>{{/each}}`,
    "</nav>",
    "<panes>",
    `<pane title="{{ state.p ? state.p : '${q(t("Notes"))}' }}" aside="{{ ${base} | ${open} | count }}">`,
    `<toolbar><search bind="q" placeholder="${q(t("Search notes"))}"/><toggle bind="showdone" label="${q(t("Show done ones"))}"/></toolbar>`,
    // (Only when there is something to pick: notes with tags, with people.)
    `{{#if rows | where('${n.tags}', 'filled') | count}}<facets bind="tag" field="${n.tags}" source="rows | ${open}" all="${q(t("All tags"))}"/>{{/if}}`,
    `{{#if rows | where('${n.people}', 'filled') | count}}<facets bind="who" field="${n.people}" source="rows | ${open}" all="${q(t("Everyone"))}"/>{{/if}}`,
    `<quickadd placeholder="${q(t("New note …"))}"/>`,
    scope("all", `{{#if state.showdone}}${timeline("limit(100000)", t("No notes yet: write the first one above."))}{{#else}}${timeline(open, t("No notes yet: write the first one above."))}{{/if}}`),
    scope("agenda", timeline(`where('${n.agenda}', true) | ${open}`, t("Nothing on the agenda: put a note there with ○ On the agenda."))),
    scope("today", timeline(`where('${n.date}', now)`, t("No note for today."))),
    scope("upcoming", timeline(`where('${n.date}', '>=', now) | ${open}`, t("Nothing dated ahead."), "asc")),
    scope("reminders", timeline(`where('${n.reminder}', 'filled') | ${open}`, t("No note has a reminder: give one in a note's ⏰ Reminder."), "asc")),
    scope("done", timeline(`where('${n.done}', true)`, t("No note marked done yet."))),
    "</pane>",
    `<pane title="${q(t("On the agenda"))}" aside="{{ rows | where('${n.agenda}', true) | ${open} | count }}" width=320>`,
    `<list source="rows | where('${n.agenda}', true) | ${open} | sort('${n.date}')" open=true empty="${q(t("Nothing on the agenda."))}"><row wrap=false gap=2><col fill=true><truncate><b>{{ title | default('…') }}</b></truncate><small><muted>{{ ${f(n.date)} | date }}</muted></small></col><button action="toggle" prop="${n.done}" label="✓" tip="${q(t("Done"))}" variant=quiet/></row></list>`,
    `{{#if app.events}}<divider label="${q(t("Today in the calendar"))}"/><list source="app.events"><row wrap=false gap=2><small><muted>{{ time }}</muted></small><col fill=true><truncate>{{ title }}</truncate></col></row></list>{{/if}}`,
    `<divider label="${q(t("Reminders"))}"/>`,
    `<list source="rows | where('${n.reminder}', 'filled') | ${open} | sort('${n.reminder}') | limit(6)" open=true empty="${q(t("No reminders."))}"><row wrap=false gap=2><col fill=true><truncate>{{ title | default('…') }}</truncate></col><small><muted>⏰ {{ ${f(n.reminder)} | relative }}</muted></small></row></list>`,
    `<divider label="${q(t("Coming up"))}"/>`,
    `<list source="rows | where('${n.date}', '>=', now) | ${open} | sort('${n.date}') | limit(8)" open=true empty="${q(t("Nothing dated ahead."))}"><row wrap=false gap=2><col fill=true><truncate>{{ title | default('…') }}</truncate></col><small><muted>{{ ${f(n.date)} | relative }}</muted></small></row></list>`,
    "</pane>",
    "</panes>",
  ].join("\n");
}

export const AGENDA_VIEW: ViewAppMeta = {
  app: "agenda",
  label: "Agenda",
  parts: [{ name: "agenda.new", description: "The form for a new note (title, date or range, project, on the agenda, pinned, tags, reminder, text) — shown while state.adding is true; the toolbar's New opens it", attrs: { date: "the date field's name", project: "the project relation's name", agenda: "the 'on the agenda' checkbox's name", pinned: "the 'pinned' checkbox's name", tags: "the tags field's name", reminder: "the reminder date's name" } }],
  actions: [{ name: "agenda.new", description: "open the form for a new note" }],
  appData: "app.projects: the projects ({ title, icon, category, open — its open notes }) by category, the archived ones not; app.events: today's events of the calendar ({ title, time })",
  defaultTemplate: (t) => agendaScreen(agendaNames(t), t),
};
