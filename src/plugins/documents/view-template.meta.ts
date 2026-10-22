import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { DOC_KINDS_NAV } from "./nav";
import { DOCUMENTS_APP_DATA } from "./view-data";

/**
 * The documents app's view as a template (the Workspace's view templates): the scopes as tabs, the search, the sort and the layout
 * bound to the view's state, the documents as cards or a list, the one picked with its facts and buttons — built of the language's
 * own tags; parts of the documents plugin where it takes more (adding files and dropping them on the view, a thumbnail, the PDF in a
 * frame, the box to tick several). Client-safe.
 */

// (An option of a <select> is "value:Label, …" — a label keeps neither.)
const opt = (s: string) => s.replace(/[,:]/g, " ");

/** A row's size, written as the documents app always did (KB, from a megabyte on MB). */
const SIZE = "{{ docsize >= 1024 ? concat(round(docsize / 1024, 1), ' MB') : concat(docsize, ' KB') }}";
/** When it was added: today the time, else the day (compared as texts — two dates are compared as times). */
const DAY = "{{#if text(slice(docadded, 0, 10)) == text(now)}}{{ slice(docadded, 11, 16) }}{{#else}}{{ docadded | date }}{{/if}}";
const ICON = `{{ ifs(${Object.entries(DOC_KINDS_NAV)
  .filter(([k]) => k !== "other")
  .map(([k, v]) => `dockind == '${k}', '${v.icon}'`)
  .join(", ")}, '${DOC_KINDS_NAV.other.icon}') }}`;

/** The state a document is in: failed, being read, not readable — or compiled by the knowledge server. */
const badge = (t: T) =>
  `{{#if docstatus == 'failed'}}<badge color=red>${t("failed")}</badge>{{#else}}{{#if docstatus == 'queued' or docstatus == 'extracting'}}<badge color=blue>${t("reading …")}</badge>{{#else}}{{#if docstatus == 'unsupported'}}<badge color=yellow>${t("not readable")}</badge>{{#else}}{{#if doccompiled}}<badge color=green>✓ ${t("compiled")}</badge>{{/if}}{{/if}}{{/if}}{{/if}}`;
const name = (inner: string) => `{{#if docunread}}<b>${inner}</b>{{#else}}${inner}{{/if}}`;
const fact = (label: string, value: string) => `<row gap=3><muted>${label}</muted><small>${value}</small></row>`;

const template = (t: T) => `<state name="scope" value="inbox"/>
<state name="sort" value="newest"/>
<state name="layout" value="grid"/>
<state name="q" value=""/>
<part name="documents.sync"/>

{{#if app.showScopes}}<tabs bind="scope" options="{{ app.scopeOptions }}"/>{{/if}}

<row gap=2>
  <part name="documents.add"/>
  {{#if app.checkedCount}}
    <b>${t("{n} selected", { n: "{{ app.checkedCount }}" })}</b>
    <button action="documents.read" label="✓ ${t("Mark read")}"/>
    <button action="documents.unread" label="● ${t("Mark unread")}"/>
    <button action="documents.delete" label="🗑 ${t("Delete")}" variant=danger/>
    <button action="state" state="checked" value="" label="${t("Clear")}" variant=quiet/>
  {{#else}}
    <search bind="q" placeholder="${t("Search documents …")}"/>
    <select bind="sort" options="newest:${opt(t("Newest first"))}, oldest:${opt(t("Oldest first"))}, unread:${opt(t("Unread first"))}, name:${opt(t("Name"))}, size:${opt(t("Largest first"))}"/>
    <grow/>
    {{#if app.markAll}}<button action="documents.readAll" label="✓ ${t("Mark all read")}"/>{{/if}}
    <tabs bind="layout" options="grid:▦, list:☰"/>
  {{/if}}
</row>
{{#if state.busy}}<small><muted>${t("Working …")}</muted></small>{{/if}}

<grid cols="{{ app.hasPicked ? 2 : 1 }}" gap=4 min=320>
  <col gap=3>
    {{#if app.count}}
      {{#if state.layout == 'list'}}
        <list source="app.shown" select=true>
          <row gap=2 wrap=false>
            <part name="documents.check"/>
            <dot color="{{ docunread ? '#4f46e5' : '#0000' }}"/>
            ${ICON}
            ${name("{{ title | truncate(80) }}")}
            <grow/>
            {{#if docfrom}}<muted>{{ docfrom | truncate(40) }}</muted>{{/if}}
            ${badge(t)}
            <muted>${SIZE}</muted>
            <muted>${DAY}</muted>
          </row>
        </list>
      {{#else}}
        <cards source="app.shown" cols="{{ app.hasPicked ? 3 : 5 }}" select=true>
          <row><part name="documents.check"/><grow/>{{#if docunread}}<dot color="#4f46e5"/>{{/if}}</row>
          <part name="documents.thumb"/>
          <clamp lines=2>${name("{{ title }}")}</clamp>
          <small><muted>${SIZE} · ${DAY}</muted></small>
          {{#if docfrom}}<small><muted>✉ {{ docfrom | truncate(40) }}</muted></small>{{/if}}
          <row>${badge(t)}</row>
        </cards>
      {{/if}}
    {{#else}}
      <box tone=muted>
        <heading level=1>{{ app.emptyIcon }}</heading>
        <text>{{ app.emptyText }}</text>
        <small><muted>${t("Drop files here to add them.")}</muted></small>
      </box>
    {{/if}}
  </col>
  {{#if app.hasPicked}}
    <selected>
      <box>
        <row gap=2 align=start><b>{{ title }}</b><grow/><button action="state" state="selected" value="" label="✕" variant=quiet/></row>
        {{#if dockind == 'pdf'}}<part name="documents.pdf"/>{{#else}}<part name="documents.thumb" big=true/>{{/if}}
        <row gap=2>
          <part name="documents.file"/>
          {{#if docunread}}<button action="documents.read" label="✓ ${t("Mark read")}"/>{{#else}}<button action="documents.unread" label="● ${t("Mark unread")}"/>{{/if}}
          <button action="open" label="${t("Page")}"/>
          <button action="documents.delete" label="🗑" variant=danger/>
        </row>
        <col gap=1>
          ${fact(t("Type"), "{{ app.picked.kind }}")}
          ${fact(t("Size"), SIZE)}
          ${fact(t("Added"), "{{ app.picked.added }}")}
          {{#if docfrom}}${fact(t("From"), "{{ docfrom }}")}{{/if}}
          ${fact(t("State"), "{{ app.picked.state }}")}
        </col>
        <part name="documents.text"/>
        {{#if app.picked.concepts}}<row gap=1>{{#each app.picked.concepts}}<button action="documents.find" value="{{ this }}" label="{{ this }}" variant=quiet/>{{/each}}</row>{{/if}}
      </box>
    </selected>
  {{/if}}
</grid>`;

export const DOCUMENTS_VIEW: ViewAppMeta = {
  app: "documents",
  label: "Documents",
  parts: [
    { name: "documents.sync", description: "Draws nothing: keeps the view in step — the scope with the Workspace tree's entry (when the navigation is there), the layout remembered in the browser, the arrow keys and Escape through the documents, the ticks cleared when the scope changes" },
    { name: "documents.add", description: "+ Add files (a file picker); files dropped anywhere on the view are added too (it is outlined while they are dragged over)" },
    { name: "documents.thumb", description: "A document's thumbnail: the picture of an image, else its type's colour, icon and file ending", attrs: { big: "true: the preview's (the whole picture)" } },
    { name: "documents.pdf", description: "A PDF shown in a frame (the preview)" },
    { name: "documents.file", description: "Open (the file in a new tab — it is read then) and Download" },
    { name: "documents.check", description: "The box to tick a document (several: shift-click ticks the ones between) — state.checked" },
    { name: "documents.text", description: "The picked document's summary and its whole text (what was read from it, word for word), the text a click away" },
  ],
  actions: [
    { name: "documents.read", description: "mark read: the row (in a row), else the ones ticked" },
    { name: "documents.unread", description: "mark unread: the row (in a row), else the ones ticked" },
    { name: "documents.readAll", description: "mark every document shown read" },
    { name: "documents.delete", description: "delete the document for good (in a row), else the ones ticked — asks first" },
    { name: "documents.find", description: 'search all documents for value="…" (a concept)' },
  ],
  appData: DOCUMENTS_APP_DATA,
  defaultTemplate: template,
};
