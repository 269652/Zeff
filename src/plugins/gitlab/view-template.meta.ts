import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/**
 * GitLab as an app view of the Workspace (a database of the type "gitlab", its rows the synced items — items-source.ts): the screen GitLab's own
 * page had, in the view language — what it reads, the sync, the kinds with their counts, the search and each item with its text. The sync,
 * resolving a comment and "Add as context" are GitLab's own parts; what is done in GitLab (answer, resolve, merge) are the flows gitlab.reply,
 * gitlab.resolve, gitlab.merge — a view of yours (or the AI's) puts them on a button. Client-safe.
 */

const template = (t: T) => `<state name="kind" value=""/><state name="q" value=""/>
<split side=left width=240>
<col gap=2>
<heading level=2>GitLab</heading>
<text tone=muted>{{ app.intro }}</text>
<small><a href="/settings/gitlab">${t("GitLab settings")}</a><muted> — ${t("address, sign-in")}</muted></small>
</col>
<col gap=3>
<box><part name="gitlab.sync"/></box>
<row gap=3 wrap=true align=center>
<tabs bind="kind" options=":${t("All")}:{{ rows | count }}, mr:${t("Merge requests")}:{{ rows | where('Kind', 'mr') | count }}, comment:${t("Comments")}:{{ rows | where('Kind', 'comment') | count }}, branch:${t("Branches")}:{{ rows | where('Kind', 'branch') | count }}"/>
<grow/>
<search bind="q" placeholder="${t("Search !169, title, words, branch, author…")}"/>
</row>
<let name="synced" value="rows | count"/>
{{#if synced == 0}}<text tone=muted>{{ app.nothing }}</text>{{/if}}
<list source="rows | only('Kind', state.kind) | search(state.q) | sort('When', 'desc')" page=150 more="${t("Show more")}" empty="${t("Nothing matches.")}">
<col gap=1>
<row gap=2 align=center wrap=true>
{{#if Kind == 'mr'}}<chip color=orange>${t("MR")}</chip>{{/if}}{{#if Kind == 'comment'}}<chip color=orange>${t("Comment")}</chip>{{/if}}{{#if Kind == 'branch'}}<chip color=orange>${t("Branch")}</chip>{{/if}}
<small><mono>{{ Project }}</mono></small>
{{#if Author}}<small><b>{{ Author }}</b></small>{{/if}}
{{#if When}}<small><muted>{{ When | date }}</muted></small>{{/if}}
{{#if State}}<chip color="{{ State == 'merged' ? 'purple' : State == 'opened' ? 'green' : State == 'resolved' ? 'green' : 'gray' }}">{{ State }}</chip>{{/if}}
<grow/>
<part name="gitlab.resolve"/>
{{#if [In context]}}<chip color=green>✓ ${t("in Context")}</chip>{{/if}}
<small><a href="{{ Link }}">${t("Open in GitLab")} ↗</a></small>
</row>
<b>{{#if Kind == 'branch'}}<mono>{{ Ref }}</mono>{{/if}}{{#if Kind == 'comment'}}On {{ Ref }} {{ title }}{{/if}}{{#if Kind == 'mr'}}{{ Ref }} {{ title }}{{/if}}</b>
{{#if Body}}<box scroll=12><markdown value="{{ Body }}"/></box>{{/if}}
<row><part name="gitlab.context"/></row>
</col>
</list>
</col>
</split>`;

export const GITLAB_VIEW: ViewAppMeta = {
  app: "gitlab",
  label: "GitLab",
  parts: [
    { name: "gitlab.sync", description: "Sync now, how often it runs, how it last went" },
    { name: "gitlab.resolve", description: "In a row: a comment marked done (its thread resolved in GitLab, when it is one)" },
    { name: "gitlab.context", description: "In a row: “Add as context” — the item kept as a context item, to link to entries" },
  ],
  actions: [],
  appData:
    "app.intro (what it reads, from where), app.host, app.nothing (said when nothing is synced). Rows: the items — Item, Kind (mr, comment, branch), Project, Ref (!167 or the branch), Author, State, Branch, Ticket, When, Updated, In context, Link, Body (Markdown). Flows: gitlab.reply, gitlab.resolve, gitlab.merge, gitlab.sync. State: kind, q.",
  defaultTemplate: template,
};
