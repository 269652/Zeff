import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/**
 * Jira as an app view of the Workspace (a database of the type "jira", its rows the synced tickets — tickets-source.ts): the screen Jira's own
 * page had, in the view language — the sync, the figures, all or mine, the tickets with their status, assignee, board, job and tags. The sync
 * controls, clearing and the job and tags pickers are Jira's own parts; what a ticket does in Jira (comment, move, assign) are the flows
 * jira.comment, jira.transition, jira.assign — a view of yours (or the AI's) puts them on a button. Client-safe.
 */

const template = (t: T) => `<state name="mine" value=""/>
<split side=left width=240>
<col gap=3>
<heading level=2>Jira</heading>
<text tone=muted>${t("A local, syncable copy of your assigned tickets. Feeds the ticket autocomplete, ticket→job memory, and completion tracking in Analysis.")}</text>
<part name="jira.clear"/>
</col>
<col gap=3>
<box>
<row gap=2 wrap=true align=center><small><b>${t("Sync")}</b></small><grow/><small><muted>{{ app.syncLine }}</muted></small></row>
<part name="jira.sync"/>
{{#if app.jql}}<small><muted>JQL: </muted><code>{{ app.jql }}</code><muted>{{#if app.base}} · {{ app.base }}{{/if}}</muted></small>{{/if}}
</box>
<grid cols=5 gap=3 min=140>
<tile label="${t("Tickets")}" value="{{ app.total }}"/>
<tile label="${t("To do")}" value="{{ app.todo }}"/>
<tile label="${t("In progress")}" value="{{ app.inprogress }}" tone=warn/>
<tile label="${t("Done")}" value="{{ app.done }}" tone=good/>
<tile label="${t("Linked to a job")}" value="{{ app.withJob }}"/>
</grid>
<small><a href="/settings/jira">${t("Jira settings")}</a><muted> — ${t("which boards are synced, and their default job")}</muted></small>
<box>
<row gap=2 align=center wrap=true>
<small><b>${t("Tickets")} ({{ rows | only('Mine', state.mine) | count }})</b></small>
<grow/>
<button action="state" state="mine" value="" label="${t("All")} {{ rows | count }}" variant="{{ state.mine ? 'plain' : 'primary' }}"/>
<button action="state" state="mine" value="true" label="${t("Mine")} {{ rows | where('Mine', true) | count }}" variant="{{ state.mine ? 'primary' : 'plain' }}"/>
</row>
<datatable source="rows | only('Mine', state.mine)"empty="${t("No tickets yet. Sync from Jira, or paste issues JSON above.")}">
<column label="${t("Key")}" nowrap=true><a href="{{ Link }}"><mono>{{ Key }}</mono></a></column>
<column label="${t("Type")}" nowrap=true><small><muted>{{ Type }}</muted></small></column>
<column label="${t("Summary")}"><truncate>{{ title }}</truncate></column>
<column label="${t("Status")}" nowrap=true><chip color="{{ Category == 'done' ? 'green' : Category == 'inprogress' ? 'yellow' : 'gray' }}">{{ Status }}</chip></column>
<column label="${t("Assignee")}" nowrap=true>{{#if Assignee}}<chip color="{{ Mine ? 'purple' : 'gray' }}">{{ Assignee }}</chip>{{#else}}<small><muted>${t("Unassigned")}</muted></small>{{/if}}</column>
<column label="${t("Board")}" nowrap=true><small><muted>{{ Board }}</muted></small></column>
<column label="${t("Job")}"><part name="jira.job"/></column>
<column label="${t("Tags")}"><part name="jira.tags"/></column>
</datatable>
</box>
</col>
</split>`;

export const JIRA_VIEW: ViewAppMeta = {
  app: "jira",
  label: "Jira",
  parts: [
    { name: "jira.sync", description: "Sync now (and paste issues JSON): Zeff's Jira connection" },
    { name: "jira.clear", description: "Delete all synced tickets (asks first)" },
    { name: "jira.job", description: "In a row: the ticket's job (its own, else its board's), changed in place" },
    { name: "jira.tags", description: "In a row: the ticket's default tags (added to every entry booked on it), changed in place" },
  ],
  actions: [],
  appData:
    "app.syncLine (how the sync is set up, when it last ran), app.jql, app.base, app.total / todo / inprogress / done / withJob (all synced tickets), app.jobs, app.allTags. Rows: the tickets — Key, Type, Status, Category (todo, inprogress, done), Priority, Assignee, Mine, Board, Job, Active, Link, Updated. Flows: jira.comment, jira.transition, jira.assign, jira.sync. State: mine.",
  defaultTemplate: template,
};
