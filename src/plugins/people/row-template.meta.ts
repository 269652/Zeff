import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { PERSON_PAGE_APP_DATA } from "./row-data";

/**
 * A person's own page as a template (the Workspace's view templates): who they are, their details, your notes, their dates and what
 * to do with the profile on the left; the summary, what was read from messages and the relations on the right; below, over the full
 * width, what the knowledge knows, the latest messages, the todos, the appointments, the cases and letters, the pages and tickets —
 * built of the language's own tags, and parts of the People plugin where it takes more (an input saved on leaving it, the note, the
 * forms to add a detail, a date, a relation, a reminder's days, the transfer with its GiroCode). Client-safe.
 */

/** A text for a '…' in an expression (an apostrophe kept). */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** A card's head: its title, and what it does on the right. */
const head = (title: string, extra = "") => `<row gap=2 align=baseline><heading level=3>${title}</heading><grow/>${extra}</row>`;
/** "Saved ✓" for a moment after a part saved (state.saved). */
const saved = (t: T, what: string) => `{{#if state.saved == '${what}'}}<text tone=good><small>${t("Saved ✓")}</small></text>{{/if}}`;
/** A button that runs on the server: "…" and disabled while it runs (state.busy). */
const busy = (key: string, label: string) => `label="{{ state.busy == '${key}' ? '…' : ${label} }}" disabled="{{ state.busy == '${key}' ? 'true' : 'false' }}"`;

/** A date: what it is, when next, found or yours; Right / Wrong, or how many days before it reminds. */
const date = (t: T) => `<row gap=2 align=baseline><b>{{ label }}</b> {{ text }}{{#if when}} <muted>{{ when }}</muted>{{/if}}{{#if !confirmed}} <text tone=warn><small>${t("found — is it right?")}</small></text>{{/if}}</row>
      {{#if sourceText}}<muted>{{ sourceText }}</muted>{{/if}}
      <row gap=1>
        {{#if confirmed}}<muted>${t("remind")}</muted><part name="person.remind" date="{{ id }}" days="{{ remindDays }}"/><muted>${t("days before")}</muted>{{#else}}<button action="person.dateRight" value="{{ id }}" label="${t("Right")}" variant=primary/>{{/if}}
        <button action="person.dateWrong" value="{{ id }}" label="{{ confirmed ? ${q(t("Delete"))} : ${q(t("Wrong"))} }}"/>
      </row>`;

/** An appointment: its calendar's colour, when, what (to its day in the calendar), where. */
const event = `<row gap=2 align=baseline wrap=false tip="{{ calendar }}"><dot color="{{ color }}"/><muted>{{ when }}</muted><col fill=true><truncate><button action="url" href="{{ href }}" label="{{ title }}" variant=link/></truncate></col>{{#if location}}<muted>{{ location | truncate(40) }}</muted>{{/if}}</row>`;

const template = (t: T) => `<state name="keep" value=""/>

{{#if app.loading}}
  <text tone=muted>…</text>
{{#else}}{{#if app.ready}}

<split ratio=1:2>
  <col gap=5>
    <box>
      ${head(t("Profile"), `${saved(t, "profile")}<button action="person.star" label="{{ app.starLabel }}" tip="{{ app.starTip }}" variant=quiet/>`)}
      <part name="person.input" field="name" label="${t("Name")}"/>
      <part name="person.input" field="aliases" label="${t("Also called (comma-separated)")}"/>
      <part name="person.input" field="emails" label="${t("Mail addresses (comma-separated)")}"/>
      <part name="person.input" field="whatsapp" label="${t("WhatsApp chat (its name)")}"/>
      <part name="person.input" field="jira" label="${t("Jira usernames (comma-separated) — for @-mentions in Jira comments")}" placeholder="chrlorenz1"/>
    </box>

    <box>
      ${head(t("Details"), "{{#if app.canPay}}<part name=\"person.transfer\"/>{{/if}}")}
      {{#if app.hasDetails}}
        <col gap=1>
          {{#each app.details}}
          <row gap=3 align=baseline wrap=false>
            <small><muted>{{ label }}</muted></small>
            <col gap=0 fill=true>
              <row gap=1 align=baseline>{{#if phone}}<a href="tel:{{ dial }}">{{ value }}</a>{{#else}}{{#if map}}<a href="{{ map }}">{{ value }}</a>{{#else}}{{#if mono}}<mono>{{ value }}</mono>{{#else}}{{ value }}{{/if}}{{/if}}{{/if}}{{#if !confirmed}}<text tone=warn tip="${t("Read from a message — confirm it under To check.")}"><small>${t("unchecked")}</small></text>{{/if}}</row>
            </col>
            <button action="person.copy" value="{{ value }}" label="⧉" tip="${t("Copy")}" variant=quiet/>
            <button action="person.removeDetail" value="{{ id }}" label="×" tip="${t("Remove")}" variant=quiet/>
          </row>
          {{/each}}
        </col>
      {{#else}}
        <text tone=muted>${t("No bank account, address or phone known yet — Zeff takes them from what it reads, or add one.")}</text>
      {{/if}}
      <part name="person.addDetail"/>
    </box>

    <box>
      ${head(t("Notes"), saved(t, "note"))}
      <part name="person.note" placeholder="${t("What you want to remember about them — preferences, gift ideas, what you last talked about…")}"/>
    </box>

    <box>
      ${head(t("Dates"), `<button action="person.findDates" ${busy("findDates", q(t("Find dates")))} tip="${t("In the facts and (with the LLM plugin) by AI in the knowledge and the messages")}" variant=quiet/>`)}
      {{#if app.hasDates}}
        <col gap=2>
          {{#each app.dates}}
          {{#if confirmed}}
            <col gap=1>
      ${date(t)}
            </col>
          {{#else}}
            <box tone=warn>
      ${date(t)}
            </box>
          {{/if}}
          {{/each}}
        </col>
      {{#else}}
        <text tone=muted>${t("No date yet — enter one or let Zeff search (“Find dates”).")}</text>
      {{/if}}
      <part name="person.addDate"/>
    </box>

    <box>
      ${head(t("Same person, or gone"))}
      {{#if app.hasOthers}}
        <col gap=1>
          <muted>${t("Same person as …")}</muted>
          <row gap=2 wrap=false>
            <select bind="keep" options="{{ app.mergeOptions }}"/>
            <button action="person.merge" value="{{ state.keep }}" label="${t("Merge into it")}" disabled="{{ state.keep ? 'false' : 'true' }}"/>
          </row>
          <muted>${t("“{name}” becomes an alias of the chosen profile; its chat, addresses, notes and dates come along; this profile is removed.", { name: "{{ app.name }}" })}</muted>
        </col>
      {{/if}}
      <row><button action="person.delete" label="${t("Delete profile")}" variant=danger confirm="${t("Delete the profile of “{name}”?", { name: "{{ app.name }}" })}"/></row>
    </box>
  </col>

  <col gap=5>
    <box>
      ${head(t("Summary"), `<button action="person.compile" ${busy("compile", "app.compileLabel")} variant=quiet/>`)}
      {{#if app.compiled}}
        {{#if app.summary.connection}}<col gap=0><muted>${t("What connects you")}</muted><text pre=true>{{ app.summary.connection }}</text></col>{{/if}}
        {{#if app.summary.keyFacts}}<col gap=0><muted>${t("Key facts")}</muted>{{#each app.summary.keyFacts}}<text>• {{ this }}</text>{{/each}}</col>{{/if}}
        {{#if app.summary.funFacts}}<col gap=0><muted>${t("Fun facts")}</muted>{{#each app.summary.funFacts}}<text>🎈 {{ this }}</text>{{/each}}</col>{{/if}}
        <muted>${t("Compiled from {n} things", { n: "{{ app.summary.sources }}" })}</muted>
      {{#else}}
        <text tone=muted>${t("Not compiled yet — “Compile” writes what connects you, the key facts and the fun ones (needs the LLM plugin).")}</text>
      {{/if}}
    </box>

    <box>
      ${head(t("Read from your messages"))}
      {{#if app.known.nothing}}<text tone=muted>${t("Nothing read from your messages yet — Zeff reads new ones after each briefing.")}</text>{{/if}}
      {{#if app.known.any}}
        <state name="known" value="{{ app.known.first }}"/>
        <tabs bind="known" options="{{ app.known.tabs }}"/>
        {{#if state.known == 'facts'}}
          {{#if app.known.hasFacts}}
            {{#each app.known.facts}}
            <col gap=1>
              <muted>{{ title }}</muted>
              {{#each items}}
              <row gap=2 align=baseline wrap=false tip="{{ tip }}"><col fill=true>{{ text }}{{#if due}} <muted>· {{ due }}</muted>{{/if}}</col>{{#if commitment}}<button action="person.done" value="{{ id }}" label="${t("Done")}"/>{{/if}}</row>
              {{/each}}
            </col>
            {{/each}}
          {{#else}}
            <text tone=muted>${t("No confirmed facts yet — check what was read under To check.")}</text>
          {{/if}}
        {{#else}}{{#if state.known == 'done'}}
          {{#if app.known.hasDone}}
            {{#each app.known.done}}
            <row gap=2 align=baseline wrap=false><small><muted>{{ kind }}</muted></small><text tone=muted>✓ {{ text }}{{#if due}} · {{ due }}{{/if}}</text></row>
            {{/each}}
          {{#else}}
            <text tone=muted>${t("Nothing done yet.")}</text>
          {{/if}}
        {{#else}}
          {{#if app.known.hasCheck}}
            {{#each app.known.check}}
            <col gap=0>
              <row gap=2 align=baseline wrap=false>
                <small><muted>{{ kind }}</muted></small>
                <col fill=true>{{ text }}{{#if due}} <muted>· {{ due }}</muted>{{/if}}</col>
                <button action="person.right" value="{{ id }}" label="${t("Right")}" variant=primary/>
                <button action="person.wrong" value="{{ id }}" label="${t("Wrong")}"/>
              </row>
              <truncate tip="{{ evidence }}"><muted>{{ quote }}</muted></truncate>
            </col>
            {{/each}}
          {{#else}}
            <text tone=muted>${t("Nothing to check.")}</text>
          {{/if}}
        {{/if}}{{/if}}
      {{/if}}
      {{#if app.links}}<row gap=1>{{#each app.links}}<badge color=gray>{{ rel }} <b>{{ target }}</b></badge>{{/each}}</row>{{/if}}
    </box>

    <box>
      ${head(t("Relations"))}
      {{#if app.relations.none}}
        <text tone=muted>${t("None known yet — the AI derives them from your todos and messages (“Match names”), or add one below.")}</text>
      {{#else}}
        <col gap=1>
          {{#each app.relations.out}}
          <row gap=2 align=baseline wrap=false tip="{{ evidence }}">
            <col gap=0 fill=true>
              <row gap=1><b>{{ rel }}</b>{{#if toYou}}<muted>${t("(to you)")}</muted>{{#else}}${t("of")} {{ other }}{{/if}}</row>
              {{#if evidence}}<muted>{{ evidence }}</muted>{{/if}}
            </col>
            <button action="person.removeRelation" value="{{ id }}" label="✕" tip="${t("Wrong? Remove it.")}" variant=quiet/>
          </row>
          {{/each}}
          {{#each app.relations.in}}
          <row gap=2 align=baseline wrap=false tip="{{ evidence }}">
            <col gap=0 fill=true>
              <row gap=1>{{ person }}: <b>{{ rel }}</b></row>
              {{#if evidence}}<muted>{{ evidence }}</muted>{{/if}}
            </col>
            <button action="person.removeRelation" value="{{ id }}" label="✕" tip="${t("Remove")}" variant=quiet/>
          </row>
          {{/each}}
        </col>
      {{/if}}
      <part name="person.addRelation"/>
    </box>
  </col>
</split>

{{#if app.showWiki}}
<box>
  ${head(t("What the knowledge knows"), `{{#if app.wiki.graph}}<a href="{{ app.wiki.graph }}">${t("In the graph ↗")}</a>{{/if}}`)}
  {{#if app.wikiLoading}}<text tone=muted>…</text>{{/if}}
  {{#if app.wikiError}}<text tone=warn><small>{{ app.wiki.error }}</small></text>{{/if}}
  {{#if app.wikiEmpty}}<text tone=muted>${t("The knowledge knows nobody of this name. An alias — what the person is called in your pages — helps.")}</text>{{/if}}
  {{#if app.wikiFull}}
    {{#if app.hasWikiMerge}}
      <box tone=warn>
        <small>{{ app.wikiMerge.text }}</small>
        <row gap=2><button action="person.knowledgeMerge" value="{{ app.wikiMerge.id }}" label="{{ app.wikiMerge.label }}" variant=primary/><button action="person.knowledgeDismiss" value="{{ app.wikiMerge.id }}" label="${t("Not the same")}"/></row>
      </box>
    {{/if}}
    {{#if app.wiki.summary}}<text>{{ app.wiki.summary }}</text>{{/if}}
    {{#if app.wiki.related}}
      <col gap=1>
        {{#each app.wiki.related}}<col gap=0><b>{{ name }}</b>{{#each rels}}<text tone=muted><small>{{ this }}</small></text>{{/each}}</col>{{/each}}
      </col>
    {{/if}}
    {{#if app.wiki.pages}}
      <section collapsible=true open=false title="{{ app.wikiPagesTitle }}">
        {{#each app.wiki.pages}}<row gap=1><a href="{{ href }}">{{ title }}</a> <muted>{{ space }}</muted></row>{{/each}}
      </section>
    {{/if}}
  {{/if}}
</box>
{{/if}}

<section title="${t("Latest messages")}">
  <list source="app.contacts" empty="${t("No messages — enter the WhatsApp chat or the mail addresses in the profile.")}">
    <row gap=2><muted>{{ folder }}</muted><muted>{{ who }}</muted><grow/><muted>{{ at }}</muted></row>
    <clamp lines=2>{{ text }}</clamp>
  </list>
</section>

<part name="person.timeline"/>

<section title="${t("Todos they appear in")}">
  <list source="app.todos" empty="${t("No open todo names them.")}">
    <row gap=2 align=baseline wrap=false><button action="url" href="{{ href }}" label="{{ ref }}" variant=quiet/><col fill=true>{{ text }}</col>{{#if due}}<muted>{{ due }}</muted>{{/if}}</row>
  </list>
</section>

{{#if app.hasEvents}}
<section title="${t("Appointments")}">
  {{#if app.anyEvents}}
    <grid cols=2 gap=8 min=320>
      <col gap=1><muted>${t("Coming up")}</muted><list source="app.events.upcoming" empty="${t("Nothing in the next 30 days.")}">${event}</list></col>
      <col gap=1><muted>${t("Recently")}</muted><list source="app.events.recent" empty="${t("Nothing in the last 30 days.")}">${event}</list></col>
    </grid>
  {{#else}}
    <text tone=muted>${t("No appointment with them in the last or next 30 days — Zeff looks for their mail address among the attendees and their name in the title.")}</text>
  {{/if}}
</section>
{{/if}}

<grid cols=2 gap=8 min=320>
{{#if app.hasCases}}
<section title="${t("Cases")}">
  <list source="app.cases">
    <row gap=2 align=baseline wrap=false>
      <mono>{{ label }}</mono>
      <col fill=true><truncate>{{#if done}}<text tone=muted><button action="url" href="{{ href }}" label="{{ title }}" variant=link/></text>{{#else}}<button action="url" href="{{ href }}" label="{{ title }}" variant=link/>{{/if}}</truncate></col>
      {{#if showOpen}}<text>{{ open | euro }}</text>{{/if}}
      {{#if nextDue}}<muted>{{ nextDue }}</muted>{{/if}}
    </row>
  </list>
</section>
{{/if}}
{{#if app.hasDocuments}}
<section title="${t("Letters and documents")}">
  <list source="app.documents">
    <row gap=2 align=baseline wrap=false><col fill=true><truncate><a href="{{ href }}">📄 {{ name }}</a></truncate></col><muted>{{ at }}</muted></row>
    {{#if summary}}<clamp lines=2><muted>{{ summary }}</muted></clamp>{{/if}}
  </list>
</section>
{{/if}}
</grid>

<grid cols=2 gap=8 min=320>
  <section title="${t("Mentioned in your workspace")}">
    {{#if app.pages}}
      <row gap=1>{{#each app.pages}}<button action="url" href="{{ href }}" label="{{ label }}"/>{{/each}}</row>
    {{#else}}
      <text tone=muted>${t("No page mentions them yet — type @ in a page.")}</text>
    {{/if}}
  </section>
  <section title="${t("Shared tickets")}">
    {{#if app.tickets}}
      <row gap=1>{{#each app.tickets}}<badge color=gray>🎫 {{ this }}</badge>{{/each}}</row>
    {{#else}}
      <text tone=muted>${t("No ticket known yet — Zeff derives them from comments and assignments.")}</text>
    {{/if}}
  </section>
</grid>

{{#else}}
  <text tone=muted>{{ app.error }}</text>
{{/if}}{{/if}}`;

export const PERSON_PAGE: ViewAppMeta = {
  app: "person",
  label: "Person",
  parts: [
    { name: "person.input", description: "A line of the profile, saved on leaving it (or Enter) — “Saved ✓” for a moment (state.saved)", attrs: { field: "name | aliases | emails | whatsapp | jira", label: "its label", placeholder: "a hint in it" } },
    { name: "person.timeline", description: "What happened with them, by day: mails, chats, Teams, comments, appointments, todos, payments, documents — with the kinds to filter by and a line where your last visit was (the Timeline plugin; nothing while it is off) — under its own heading" },
    { name: "person.note", description: "Your notes on them, saved while you write and on leaving it", attrs: { placeholder: "a hint in it" } },
    { name: "person.transfer", description: "“Transfer money”: a dialog with the amount and purpose, and the GiroCode of the transfer to their account (app.canPay)" },
    { name: "person.addDetail", description: "The form to add a detail: its kind (IBAN, BIC, bank, address, phone, office hours) and value" },
    { name: "person.addDate", description: "The form to add a date: birthday, anniversary or another, the day, what for" },
    { name: "person.remind", description: "How many days before a confirmed date it reminds — saved on leaving it", attrs: { date: "{{ id }} of an item of app.dates", days: "{{ remindDays }}" } },
    { name: "person.addRelation", description: "The form to add a relation: what they are (mother, landlord), to you or to someone else" },
  ],
  actions: [
    { name: "person.star", description: "star them, or not" },
    { name: "person.compile", description: "compile the summary again (state.busy “compile” meanwhile)" },
    { name: "person.findDates", description: "search their dates (state.busy “findDates” meanwhile)" },
    { name: "person.right", description: "a thing read is right: value=\"{{ id }}\" of app.known.check" },
    { name: "person.wrong", description: "a thing read is wrong: value=\"{{ id }}\"" },
    { name: "person.done", description: "a commitment kept: value=\"{{ id }}\"" },
    { name: "person.dateRight", description: "a date found is right: value=\"{{ id }}\" of app.dates" },
    { name: "person.dateWrong", description: "a date wrong, or deleted: value=\"{{ id }}\"" },
    { name: "person.copy", description: "copy value=\"…\" to the clipboard" },
    { name: "person.call", description: "call value=\"{{ dial }}\" (a phone number)" },
    { name: "person.removeDetail", description: "remove a detail: value=\"{{ id }}\" of app.details" },
    { name: "person.removeRelation", description: "remove a relation: value=\"{{ id }}\"" },
    { name: "person.merge", description: "merge this profile into another: value=\"{{ state.keep }}\" (its id) — the page goes to it" },
    { name: "person.delete", description: "delete the profile (with confirm=\"…\")" },
    { name: "person.knowledgeMerge", description: "merge their entries in the knowledge: value=\"{{ app.wikiMerge.id }}\"" },
    { name: "person.knowledgeDismiss", description: "they are not the same: value=\"{{ app.wikiMerge.id }}\"" },
  ],
  appData: PERSON_PAGE_APP_DATA,
  defaultTemplate: template,
};
