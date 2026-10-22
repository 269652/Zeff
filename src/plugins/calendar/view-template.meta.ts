import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";
import { CALENDAR_APP_DATA } from "./app-data";

/**
 * The calendar as a template (the Workspace's view templates): the toolbar (Today, back and forth, the range, the views as tabs, Sync)
 * and the sidebar's contents (New, the calendars by source, the todos' proposals, the shortcuts) built of the language's own tags —
 * and the calendar plugin's parts where it takes more: the grid itself (day, week, month, agenda — dragging, opening, editing), the
 * month to pick a day from, a calendar's switch. Client-safe.
 */

const shortcuts = (t: T): [string, string][] => [
  ["T", t("Today")],
  ["← / →", t("Previous / next")],
  ["D W M A", t("Day, week, month, agenda")],
  ["N", t("New event")],
  ["Alt + ↑ ↓ ← →", t("Move the focused event by 15 minutes / a day")],
  ["Shift + Alt + ↑ ↓", t("Change the focused event's end")],
  ["Esc", t("Close")],
];

const template = (t: T) => `<state name="view" value="week"/>
<state name="day" value=""/>
<state name="proposed" value="true"/>

<row gap=2>
  <button action="state" state="day" value="{{ app.today }}" label="${t("Today")}"/>
  <row gap=0 wrap=false>
    <button action="state" state="day" value="{{ app.prev }}" label="‹"/>
    <button action="state" state="day" value="{{ app.next }}" label="›"/>
  </row>
  <heading level=2>{{ app.title }}</heading>
  <grow/>
  {{#if state.saving}}<muted>${t("Saving…")}</muted>{{/if}}
  <tabs bind="view" options="day:${t("Day")}, week:${t("Week")}, month:${t("Month")}, agenda:${t("Agenda")}"/>
  {{#if app.canSync}}<button action="calendar.sync" label="⟳ ${t("Sync")}"/>{{/if}}
</row>

<row gap=6 align=start>
  <col gap=4>
    <button action="calendar.new" label="+ ${t("New event")}" variant=primary/>
    <section title="${t("Calendars & date")}" collapsible=true open=wide>
      <part name="calendar.minimonth"/>
      {{#each app.groups}}
        <col gap=1>
          <muted><b>{{ label | upper }}</b></muted>
          {{#each calendars}}
            <row gap=2 wrap=false><part name="calendar.toggle" calendar="{{ id }}" label="{{ name }}"/>{{#if free}}<muted>${t("free")}</muted>{{/if}}</row>
          {{/each}}
        </col>
      {{/each}}
      <col gap=1>
        <muted><b>${t("Todos").toUpperCase()}</b></muted>
        <row gap=2 wrap=false><part name="calendar.toggle" calendar="proposed" label="${t("Proposed by todos")}"/><muted>{{ app.proposedCount }}</muted></row>
      </col>
      <muted><button action="url" href="/settings/calendar" label="${t("Manage calendars …")}" variant=link/></muted>
      <section title="${t("Keyboard shortcuts")}" collapsible=true open=false>
${shortcuts(t)
  .map(([k, what]) => `        <row gap=3 wrap=false><code>${k}</code><muted>${what}</muted></row>`)
  .join("\n")}
      </section>
    </section>
  </col>
  <part name="calendar.grid"/>
</row>`;

export const CALENDAR_VIEW: ViewAppMeta = {
  app: "calendar",
  label: "Calendar",
  parts: [
    { name: "calendar.grid", description: "The calendar itself for state.view and state.day, the window's height (it takes the room left in a <row>): day, week, month or agenda — appointments made, dragged, opened, edited; the keyboard (T, ← →, D W M A, N)" },
    { name: "calendar.minimonth", description: "A month to pick a day from: the days shown marked, days with appointments dotted" },
    { name: "calendar.toggle", description: "A calendar's switch in its colour with its label (shown or hidden — saved), or the todos' proposals' (state.proposed)", attrs: { calendar: "{{ id }} of a calendar of app.groups, or proposed", label: "{{ name }}" } },
  ],
  actions: [
    { name: "calendar.new", description: "a new appointment (the next half hour)" },
    { name: "calendar.sync", description: "read Google Calendar now" },
  ],
  appData: CALENDAR_APP_DATA,
  defaultTemplate: template,
};
