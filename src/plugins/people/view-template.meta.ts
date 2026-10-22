import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { PEOPLE_APP_DATA } from "./view-data";

/**
 * The people overview as a template (the Workspace's view templates): the circles as tabs, the filters, the sort, the cards — beside
 * the appointments with their briefs, who to get in touch with, the dates coming up, what to check, the suggestions and the tools —
 * built of the language's own tags, and parts of the People plugin where it takes more (a person's card with its panels, the form for
 * a new person, a tool run on the server, a yes/no verdict, the settings). Client-safe.
 */

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** A name that opens their row — a plain name when they have none. */
const who = (label: string, row = "rowId") => `{{#if ${row}}}<button action="open" row="{{ ${row} }}" label="{{ ${label} }}" variant=link/>{{#else}}<b>{{ ${label} }}</b>{{/if}}`;

/** A filter: pressed while on, off with a second click. */
const only = (id: string, label: string) => `<button action="state" state="only" value="{{ state.only == '${id}' ? '' : '${id}' }}" label="${label}" variant="{{ state.only == '${id}' ? 'primary' : 'plain' }}"/>`;

const template = (t: T) => `<state name="circle" value="all"/>
<state name="only" value=""/>
<state name="sort" value="name"/>
<state name="adding" value=""/>
<state name="days" value="0"/>

{{#if app.loading}}
  <muted>{{ app.error | default('…') }}</muted>
{{#else}}

<grid cols=2 gap=4 min=360>
<col gap=3>
  <row gap=2>
    <tabs bind="circle" options="{{ app.circleOptions }}"/>
    <grow/>
    <select bind="sort" options="name:${t("By name")}, quiet:${t("Longest without contact first")}, recent:${t("Last in touch first")}, next:${t("Next date first")}, todos:${t("Most todos first")}"/>
    {{#if state.adding}}
      <part name="people.add"/>
    {{#else}}
      <button action="state" state="adding" value="true" label="+ ${t("Person")}" variant=primary/>
    {{/if}}
  </row>
  <row gap=3>
    <muted>{{#if app.filtered}}${t("{n} of {total}", { n: "{{ app.shown | count }}", total: "{{ app.rowCount }}" })}{{#else}}{{#if app.count == 1}}${t("1 person")}{{#else}}${t("{n} people", { n: "{{ app.count }}" })}{{/if}}{{/if}}</muted>
    <row gap=1>
      ${only("starred", `★ ${t("Starred")}`)}
      ${only("quiet", t("Long not heard of"))}
      ${only("owed", t("Open promises"))}
      ${only("todos", t("With todos"))}
      ${only("soon", t("Dates soon"))}
    </row>
  </row>

  {{#if app.shown}}
    <grid cols=3 gap=2 min=280>
      {{#each app.shown}}<part name="people.card" row="{{ id }}"/>{{/each}}
    </grid>
  {{#else}}
    <box><text tone=muted>{{ app.rowCount ? ${q(t("No one matches."))} : ${q(t("No people yet — add one above, or import them from your mails and chats (Tools)."))} }}</text></box>
  {{/if}}
</col>

<col gap=4>
  {{#if app.meetings}}
  <box title="${t("Appointments in the next 24 hours")}">
    {{#each app.meetings}}
    <section collapsible=true open=false title="{{ when }} · {{ name }} — {{ title }}">
      {{#if rowId}}<button action="open" row="{{ rowId }}" label="${t("Open {name}", { name: "{{ name }}" })}" variant=link/>{{/if}}
      <text tone=muted><small>{{ lastMet }}</small></text>
      {{#if since}}
        <col gap=0>
          <muted>{{ sinceTitle }}</muted>
          {{#each since}}<clamp lines=2><muted>{{ ago }}:</muted> {{ text }}</clamp>{{/each}}
        </col>
      {{/if}}
      {{#if owed}}
        <col gap=0>
          <muted>${t("Open between you")}</muted>
          {{#each owed}}<row gap=1><badge color="{{ mine ? 'red' : 'blue' }}">{{ mine ? ${q(t("you"))} : ${q(t("they"))} }}</badge> {{ text }}{{#if due}} <muted>· {{ due }}</muted>{{/if}}</row>{{/each}}
        </col>
      {{/if}}
      {{#if cases}}
        <col gap=0>
          <muted>${t("Cases")}</muted>
          {{#each cases}}<row gap=1>{{ title }} <muted>{{ label }}</muted>{{#if hasOpen}} <muted>· ${t("open {amount}", { amount: "{{ open | euro }}" })}</muted>{{/if}}</row>{{/each}}
        </col>
      {{/if}}
      {{#if nothing}}<muted>${t("Nothing open with them.")}</muted>{{/if}}
    </section>
    {{/each}}
  </box>
  {{/if}}

  {{#if app.nudges}}
  <box>
    <row gap=2 align=baseline><heading level=3>${t("Get in touch again?")}</heading><grow/><muted>${t("after {n} weeks", { n: "{{ app.weeks }}" })}</muted></row>
    {{#each app.nudges}}
    <row gap=2>
      <col gap=0>${who("name")}<text tone=muted><small>{{ note }}</small></text></col>
      <grow/>
      {{#if write}}<button action="url" href="{{ write }}" label="{{ icon }} ${t("Write")}" variant=primary/>{{/if}}
      <part name="people.tool" tool="snooze" person="{{ personId }}" days=14 label="${t("Later")}" title="${t("Ask again in two weeks")}"/>
    </row>
    {{/each}}
  </box>
  {{/if}}

  {{#if app.upcoming}}
  <box title="${t("Coming up")}">
    {{#each app.upcoming}}
    <row gap=2 wrap=false>${who("title")}<grow/>{{#if soon}}<text tone=warn><small><b>{{ when }}</b></small></text>{{#else}}<muted>{{ when }}</muted>{{/if}}</row>
    {{/each}}
  </box>
  {{/if}}

  {{#if app.toCheck}}
  <box>
    <row gap=2 align=baseline><heading level=3>${t("To check")}</heading><grow/><button action="url" href="/review" label="${t("{n} in the review queue", { n: "{{ app.toCheck }}" })} →" variant=quiet/></row>
    {{#if app.confident}}
      <part name="people.tool" tool="acceptConfident" wide=true label="${t("Take all from 90 % ({n})", { n: "{{ app.confident }}" })}" title="${t("Claims and links the AI is sure of (90 % and more) — identity suggestions still wait for you.")}"/>
    {{/if}}
    {{#each app.groups}}
    <section collapsible=true open="{{ app.oneKind ? 'true' : 'false' }}" title="{{ title }} · {{ n }}">
      {{#each items}}
      <row align=start gap=2 wrap=false>
        <col gap=0>
          <clamp lines=3>{{#if person}}${who("person")}: {{/if}}{{ text }}</clamp>
          {{#if detail}}<muted>{{ detail | truncate(90) }}</muted>{{/if}}
        </col>
        <grow/>
        <part name="people.verdict" on="{{ on }}" item="{{ id }}"/>
      </row>
      {{/each}}
    </section>
    {{/each}}
  </box>
  {{/if}}

  {{#if app.suggestions.any}}
  <box>
    <section collapsible=true open=false title="${t("Suggestions")} · ${t("{n} to take over", { n: "{{ app.suggestions.n }}" })}">
      {{#if app.suggestions.error}}<text tone=warn><small>${t("Knowledge: {error}", { error: "{{ app.suggestions.error }}" })}</small></text>{{/if}}
      {{#if app.suggestions.persons}}
        <muted>${t("From the knowledge — the most mentioned first")}</muted>
        <row gap=1>{{#each app.suggestions.persons}}<part name="people.tool" tool="add" entity="{{ id }}" variant=chip label="+ {{ name }}" count="{{ pages }}" title="${t("{n} pages", { n: "{{ pages }}" })}"/>{{/each}}</row>
      {{/if}}
      {{#if app.suggestions.chats}}
        <muted>${t("From WhatsApp")}</muted>
        <row gap=1>{{#each app.suggestions.chats}}<part name="people.tool" tool="add" whatsapp="{{ name }}" variant=chip label="+ {{ name }}" title="${t("{n} messages", { n: "{{ messages }}" })}"/>{{/each}}</row>
      {{/if}}
    </section>
  </box>
  {{/if}}

  <box>
    <section collapsible=true open="{{ app.running ? 'true' : 'false' }}" title="${t("Tools and settings")}">
      <part name="people.tool" tool="import" wide=true variant=primary label="${t("Import from context (AI)")}" title="${t("The AI goes through the last 14 days of your mails, WhatsApp and Teams and makes profiles of the people in them.")}"/>
      {{#if app.datesProgress}}
        <row gap=2><dot color="#f59e0b"/><text tone=muted>{{ app.datesProgress }}</text></row>
      {{#else}}
        <part name="people.tool" tool="findAll" wide=true label="${t("Find dates for everyone")}" title="${t("For everyone without a birthday: in the facts and (with the LLM plugin) by AI in the knowledge and the messages")}"/>
      {{/if}}
      {{#if app.count > 1}}
        <part name="people.tool" tool="normalize" wide=true label="${t("Match names (AI)")}" title="${t("The AI looks at who the names in your todos are: new names become aliases, contacts get profiles, duplicates are merged. It also runs after each briefing.")}"/>
      {{/if}}
      {{#if app.count}}
        <row gap=1 wrap=false>
          <part name="people.tool" tool="extract" days="{{ state.days }}" wide=true label="${t("Read new messages (AI)")}" title="${t("The AI reads the messages that came in since the last time (mail, chats, Teams, Jira) and notes what they say about people: roles, responsibilities, facts, commitments — to confirm.")}"/>
          <select bind="days" options="0:${t("since last")}, 14:${t("14 days")}, 30:${t("30 days")}"/>
        </row>
        <part name="people.tool" tool="classify" wide=true label="${t("Place contacts (AI)")}" title="${t("The AI says for each contact not placed yet whether it is a person or an organisation and which circle it is in — from what Zeff knows of them. Yours stay. It also runs after each briefing.")}"/>
        <part name="people.tool" tool="linkJira" wide=true label="${t("Link Jira accounts")}" title="${t("Ties Jira users to the profiles by their names — so @-mentions in notes synced to Jira point to the right person. No AI.")}"/>
      {{/if}}
      {{#if app.compileProgress}}
        <row gap=2><dot color="#6366f1"/><text tone=muted>{{ app.compileProgress }}</text></row>
      {{#else}}
        <row gap=1 wrap=false>
          <part name="people.tool" tool="compile" wide=true label="${t("Compile summaries")}" title="${t("A summary of every person: what connects you, the key facts, the fun facts")}"/>
          <part name="people.tool" tool="compileAgain" label="${t("again")}" title="${t("Also those compiled in the last 12 hours")}"/>
        </row>
      {{/if}}
      <muted>${t("Two profiles that are one person? Open one: “Merge or delete” merges it into the other.")}</muted>
      <part name="people.settings"/>
    </section>
  </box>
</col>
</grid>

{{/if}}`;

export const PEOPLE_VIEW: ViewAppMeta = {
  app: "people",
  label: "People",
  parts: [
    { name: "people.card", description: "A person's card: initials, name, star, circle and role, last contact, what is open, the next date, todos and tickets — on hover write, add a todo, pay, set the circle; a birthday greeting to draft", attrs: { row: "{{ id }} of an item of app.shown" } },
    { name: "people.add", description: "The form for a new person (a name; Escape closes it — state.adding)" },
    { name: "people.tool", description: "A button that runs a tool of the overview on the server (… while it runs, the others wait)", attrs: { tool: "import | findAll | normalize | extract | classify | linkJira | compile | compileAgain | acceptConfident | snooze | add", label: "its text", title: "what it does (a tooltip)", variant: "primary | plain | chip", wide: "true: as wide as the column", person: "snooze: the person's id", days: "snooze: days; extract: how far back", entity: "add: a knowledge person's id", whatsapp: "add: a WhatsApp chat's name", count: "chip: a number beside it" } },
    { name: "people.verdict", description: "Yes/no for a thing to check", attrs: { on: "identity | commitment | claim | link | stale | date", item: "{{ id }} of an item of app.groups[].items" } },
    { name: "people.settings", description: "The settings: after how many weeks someone you care about comes up, your name (your family by your last name)" },
  ],
  actions: [],
  appData: PEOPLE_APP_DATA,
  defaultTemplate: template,
};
