import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/**
 * News as an app view of the Workspace (a database of the type "news"): the screen News' own page had, written in the view language — the
 * views with their counts, the categories, the funnel, your taste, the overview with its themes and picks — and News' own parts where it
 * takes more: the feed (cards, reading, voting, more like this, endless), the stories, asking, listening, refreshing, discovering. The
 * view, the source and the category are the view's state (a link sets them: ?s.view=saved&s.category=Tech). Client-safe.
 */

const template = (t: T) => `<state name="view" value="foryou"/><state name="source" value=""/><state name="category" value=""/>
<on event="pickview" action="state" state="category" value=""/>
<on event="pickview" action="state" state="source" value=""/>
<on event="pickcat" action="state" state="source" value=""/>
<on event="pickcat" action="state" state="view" value="{{ state.view == 'foryou' ? 'latest' : state.view }}"/>
<on event="all" action="state" state="category" value=""/>
<on event="all" action="state" state="source" value=""/>
<split side=left width=240>
<col gap=4>
<heading level=2>${t("News")}</heading>
<col gap=1>
{{#each app.views}}
<row gap=2 align=center wrap=false><col fill=true><button action="state" state="view" value="{{ id }}" emit="pickview" label="{{ label }}" variant="{{ on ? 'primary' : 'quiet' }}"/></col>{{#if n}}<small><muted>{{ n }}</muted></small>{{/if}}</row>
{{/each}}
</col>
<part name="news.refresh"/>
{{#if app.categories}}
<col gap=1>
<small><muted>${t("Categories")}</muted></small>
{{#each app.categories}}
<row gap=2 align=center wrap=false><col fill=true><button action="state" state="category" value="{{ value }}" emit="pickcat" label="{{ name }}" variant="{{ on ? 'primary' : 'quiet' }}"/></col><small><muted>{{ n }}</muted></small></row>
{{/each}}
{{#if app.filtered}}<button emit="all" label="${t("Show everything")}" variant=quiet/>{{/if}}
</col>
{{/if}}
<part name="news.discover"/>
<button action="url" href="/settings/news" label="${t("News settings")}" wide=true/>
</col>
<col gap=3>
{{#if app.funnel}}
<box>
<row gap=2 wrap=true align=center>
{{#each app.funnel.parts}}{{#if kind == 'br'}}<hr/>{{#else}}{{#if kind == 'head'}}<small><b>{{ text }}</b></small>{{/if}}{{#if kind == 'sep'}}<small><muted>{{ text }}</muted></small>{{/if}}{{#if kind == 'plain'}}<small tip="{{ tip }}">{{ text }}</small>{{/if}}{{#if kind == 'good'}}<small tip="{{ tip }}"><text tone=good>{{ text }}</text></small>{{/if}}{{#if kind == 'warn'}}<small><text tone=warn>{{ text }}</text></small>{{/if}}{{#if kind == 'link'}}<button action="state" state="view" value="filtered" emit="pickview" label="{{ text }}" variant=quiet/>{{/if}}{{/if}}{{/each}}
<grow/>
{{#if app.funnel.on}}<part name="news.funnel"/>{{#else}}<small><a href="/settings/news#funnel" tip="{{ app.funnel.agentTip }}">{{ app.funnel.agent }}</a></small>{{/if}}
</row>
</box>
{{/if}}
<part name="news.stories"/>
{{#if app.taste}}
<box tone=accent title="✨ ${t("Your taste")}">
{{#if app.taste.text}}<text>{{ app.taste.text }}</text>{{#else}}<text tone=muted>{{ app.taste.none }}</text>{{/if}}
<small><muted>{{ app.taste.by }} </muted><a href="/settings/news#taste">{{ app.taste.edit }}</a><muted>{{ app.taste.pending }}</muted></small>
</box>
{{/if}}
{{#if app.llm}}<part name="news.ask"/>{{/if}}
{{#if app.overview}}
<box tone=accent>
<row gap=2 align=center><small><b>${t("Overview")} · {{ app.overview.ago }}</b></small><part name="news.listen"/></row>
<text>{{ app.overview.text }}</text>
{{#if app.overview.themes}}
<grid cols=2 gap=2 min=260>
{{#each app.overview.themes}}
<box><b>{{ title }}</b><text>{{ summary }}</text><row gap=1 wrap=true>{{#each links}}<small><a href="{{ url }}" tip="{{ tip }}">[{{ n }}] {{ label }}</a></small>{{/each}}</row></box>
{{/each}}
</grid>
{{/if}}
{{#each app.overview.picks}}
<row gap=1 wrap=true><text>• </text><a href="{{ url }}"><b>{{ title }}</b></a><text tone=muted> — {{ why }}</text></row>
{{/each}}
</box>
{{/if}}
{{#if app.empty}}
<box>
{{#if app.empty == 'starter'}}<part name="news.fetching" starter="true"/><small><muted>{{ app.emptyText }} </muted><a href="/settings/news">${t("News settings")}</a></small>{{/if}}
{{#if app.empty == 'funnel'}}<text tone=muted>{{ app.emptyText }}</text><row gap=2 wrap=true><part name="news.funnel"/><button action="state" state="view" value="latest" emit="pickview" label="${t("See everything unfiltered")}"/></row>{{/if}}
{{#if app.empty == 'old'}}<part name="news.fetching"/><small><muted>{{ app.emptyText }}</muted></small>{{/if}}
{{#if app.empty == 'none'}}<text tone=muted>{{ app.emptyText }}</text>{{/if}}
</box>
{{#else}}
<part name="news.feed"/>
{{/if}}
</col>
</split>`;

export const NEWS_VIEW: ViewAppMeta = {
  app: "news",
  label: "News",
  parts: [
    { name: "news.feed", description: "The feed of the view, source and category picked: cards with reading here, 👍 👎, saving, more like this, the story, listening — endless, the newest marked seen" },
    { name: "news.stories", description: "The stories strip on top of For you: what is important and the stories running through it, played like stories" },
    { name: "news.refresh", description: "Refresh (and the overview's refresh), with how far it is" },
    { name: "news.discover", description: "Discover: new sources and articles from your taste" },
    { name: "news.funnel", description: "Let the agent look now (the funnel)" },
    { name: "news.ask", description: "Ask your news a question: an answer with numbered sources" },
    { name: "news.listen", description: "Listen to the overview" },
    { name: "news.fetching", description: "What is being fetched now (attrs: starter=true — the starter pack offered)" },
  ],
  actions: [],
  appData:
    "app.views [{ id, label, n, on }], app.categories [{ name, value, n, on }], app.filtered, app.funnel { on, parts [{ kind: head|sep|plain|good|warn|link|br, text, tip }], agent, agentTip } | null, app.stories, app.taste { text, none, by, edit, pending } | null, app.overview { ago, text, themes [{ title, summary, links [{ n, url, label, tip }] }], picks [{ url, title, why }], spoken } | null, app.llm, app.items (the feed's first page), app.empty: '' | starter | funnel | old | none, app.emptyText. State: view (foryou, discover, latest, saved, filtered, hidden), source (id), category.",
  defaultTemplate: template,
};
