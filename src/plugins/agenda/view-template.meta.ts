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

// ---------------------------------------------------------------------------
// The port (zeff-plugins/plugins/agenda-ext): the same screen, made of the view language alone
// ---------------------------------------------------------------------------

/** The port's names in Zeff: its sidebar lambda and the flow that adds a note (in its package). */
export const AGENDA_PORT = { plugin: "agenda-ext", data: "agenda.data", addNote: "agenda.add-note" } as const;

/** The form for a new note (the built-in's NewNote, view-parts.tsx) as a dialog; its Save runs the package's flow. */
function newNoteDialog(n: AgendaNames, t: T): string {
  const s = (name: string, value = "") => `<state name="${name}" value="${value}"/>`;
  const names = JSON.stringify({ date: n.date, project: n.project, agenda: n.agenda, pinned: n.pinned, tags: n.tags, reminder: n.reminder });
  const input = `{"database": {{ db.id }}, "title": {{ state.nt | tojson }}, "dated": {{ state.ndated | tojson }}, "start": {{ state.ns | tojson }}, "end": {{ state.ne | tojson }}, "project": {{ state.np | tojson }}, "agenda": {{ state.nag | tojson }}, "pinned": {{ state.npin | tojson }}, "tags": {{ state.ntags | tojson }}, "reminder": {{ state.nrem | tojson }}, "text": {{ state.ntext | tojson }}, "names": ${names}}`;
  const reset = ["nt", "ne", "ntags", "nrem", "ntext", "nag", "npin", "adding"].map((k) => `<on event="agenda-note-saved" action="state" state="${k}" value=""/>`).join("");
  return [
    s("nt"), s("ndated", "true"), s("ns"), s("ne"), s("np"), s("nag"), s("npin"), s("ntags"), s("nrem"), s("ntext"),
    `<dialog bind="adding" title="${q(t("New note"))}">`,
    `<input bind="nt" label="${q(t("Title"))}" placeholder="${q(t("What is it about?"))}"/>`,
    `<toggle bind="ndated" label="${q(t("Has a date"))}"/>`,
    `{{#if state.ndated}}<row gap=2><input bind="ns" type="date" label="${q(t("Date"))}"/><input bind="ne" type="date" label="${q(t("Until (a range)"))}"/></row>{{/if}}`,
    `{{#if data.agenda.projectOptions}}<select bind="np" options="{{ data.agenda.projectOptions }}" label="${q(t("Project"))}"/>{{/if}}`,
    `<row gap=3><toggle bind="nag" label="${q(t("On the agenda"))}"/><toggle bind="npin" label="📌 ${q(t("Pinned"))}"/></row>`,
    `<input bind="ntags" label="${q(t("Tags"))}" placeholder="${q(t("comma separated — a new one is made"))}"/>`,
    `<input bind="nrem" type="date" label="${q(t("Reminder"))}"/>`,
    `<input bind="ntext" type="textarea" label="${q(t("Text"))}"/>`,
    `<button run="${AGENDA_PORT.addNote}" with='${input}' emit="agenda-note-saved" done="${q(t("Saved."))}" label="${q(t("Save"))}" variant=primary disabled="{{ state.nt ? 'false' : 'true' }}"/>`,
    "</dialog>",
    reset,
  ].join("\n");
}

/**
 * The port's screen: the built-in's (agendaScreen) — the same timeline, sidebar, filters and panes — with what was code made of the
 * view language: the projects and today's events from the plugin's lambda (<data lambda>), the new-note form a dialog, New in the
 * toolbar. One source: what changes in the built-in's screen changes in the port's.
 */
export const agendaScreenPort = (n: AgendaNames, t: T): string => toPortScreen(agendaScreen(n, t), n, t);

/**
 * A built-in Agenda screen — the plugin's, or one you changed — as the port's: the same template with what was code made of the view
 * language (the new-note part a dialog, app.projects / app.events the lambda's, New in the toolbar). What you changed in it stays.
 * One already made so comes back as it is.
 */
export function toPortScreen(template: string, n: AgendaNames, t: T): string {
  if (template.includes(`lambda="${AGENDA_PORT.data}"`)) return template;
  let s = template;
  s = s.replace(/<part name="agenda\.new"[^>]*\/>/, newNoteDialog(n, t));
  s = s.split("app.projects").join("data.agenda.projects").split("app.events").join("data.agenda.events");
  s = s.replace(`<toolbar><search bind="q"`, `<toolbar><button action="state" state="adding" value="true" label="${q(t("New note"))}" variant=primary/><search bind="q"`);
  // (with= as JSON: the done field's name quoted, so a package made in your language calls it by its name there — localizePackage)
  return `<data name="agenda" lambda="${AGENDA_PORT.data}" with='{"db": {{ db.id }}, "done": "${n.done}"}'/>\n${s}`;
}

/** The flow that adds a note (in the port's package): the dialog's values as the note's fields — a range, a project, tags made when new. */
export const ADD_NOTE_FLOW = {
  name: AGENDA_PORT.addNote,
  title: "Add an Agenda note",
  inputs: [
    { name: "database", type: "db", required: true },
    { name: "title", type: "text", required: true },
    { name: "dated", type: "text" },
    { name: "start", type: "text" },
    { name: "end", type: "text" },
    { name: "project", type: "text" },
    { name: "agenda", type: "text" },
    { name: "pinned", type: "text" },
    { name: "tags", type: "text" },
    { name: "reminder", type: "text" },
    { name: "text", type: "text" },
    { name: "names", type: "json" },
  ],
  nodes: [
    {
      id: "values",
      kind: "script",
      code: [
        "const input = flowInput;",
        "const n = input.names || {};",
        "const yes = (v) => v === true || v === 'true';",
        "const today = env.today;",
        "const v = {};",
        "if (yes(input.dated) && n.date) { const start = input.start || today; v[n.date] = input.end && input.end > start ? { start, end: input.end } : start; }",
        "if (input.project && n.project) v[n.project] = [input.project];",
        "if (yes(input.agenda) && n.agenda) v[n.agenda] = true;",
        "if (yes(input.pinned) && n.pinned) v[n.pinned] = true;",
        "if (input.reminder && n.reminder) v[n.reminder] = input.reminder;",
        "const tags = String(input.tags || '').split(',').map((x) => x.trim()).filter(Boolean);",
        "if (tags.length && n.tags) v[n.tags] = [...new Set(tags)];",
        "return v;",
      ].join("\n"),
    },
    { id: "add", kind: "action", action: "db.add", input: { database: "{{ input.database }}", title: "{{ input.title }}", values: "{{ steps.values }}", markdown: "{{ input.text }}" } },
  ],
  output: "{{ steps.add }}",
};
