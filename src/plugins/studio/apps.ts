import { t } from "@/lib/i18n/server";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property, type View } from "@/plugins/workspace/model";
import { addRow, createPage, getDatabase, setCell, updatePage, updateSchema } from "@/plugins/workspace/store";
import { createFlow, flowByName } from "@/plugins/workspace/flows/store";

/**
 * What the Studio makes in one go: an app — a database (its data) with a screen drawn from a template as its first view, the flows
 * the screen calls, a lifecycle, a detail page for its rows. Each kind shows another part of what apps can be: a web search whose
 * hits you keep, a catalogue filled by a lookup, a tracker whose items move through stages, an empty one to build on. Server only.
 */

export const APP_KINDS = ["blank", "websearch", "catalogue", "tracker"] as const;
export type AppKind = (typeof APP_KINDS)[number];

const q = (s: string) => s.replace(/"/g, "'");
const select = (name: string, choices: string[]): Property & { options: Option[] } => ({ ...newProperty(name, "select"), options: choices.map((n, i): Option => ({ id: newId("o"), name: n, color: COLORS[(i + 3) % COLORS.length] })) });
const appView = (name: string, template: string): View => ({ ...newView(name, "app"), app: "template", template });
/** A free flow name from the app's title ("Meine Suche" → "meine-suche.search"). */
const slug = (title: string): string => {
  const base = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "app";
  return /^[a-z]/.test(base) ? base : `app-${base}`;
};

/** A detail page for a database's rows: its title, its fields to edit, its lifecycle when it has one. */
export function detailTemplate(schema: DbSchema): string {
  const fields = schema.properties.filter((p) => !p.id.startsWith("src") && !["created_time", "updated_time", "button", "formula", "rollup"].includes(p.type)).slice(0, 12);
  return [
    '<header title="{{ title }}"/>',
    // (A <field> shows its name with it.)
    fields.length ? `<grid cols=3 min=200>${fields.map((p) => `<field name="${q(p.name)}"/>`).join("")}</grid>` : "",
    schema.lifecycle ? "<transitions history=true/>" : "",
    "{{#if text}}<text pre=true>{{ text }}</text>{{/if}}",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A new app of a kind under `parentId`: its database's id (its page is the app). */
export function createApp(kind: AppKind, title: string, parentId: number | null = null): { dbId: number; flows: string[] } {
  const name = title.trim() || t("New app");
  // (A key no other app's flows use yet.)
  let key = slug(name);
  for (let i = 2; flowByName(`${key}.search`) || flowByName(`${key}.save`); i++) key = `${slug(name)}-${i}`;
  const flows: string[] = [];

  if (kind === "websearch") {
    const url = newProperty("URL", "url");
    const snippet = newProperty(t("Snippet"), "text");
    const query = newProperty(t("Search"), "text");
    const db = createPage({ parentId, title: name, icon: "🔎", kind: "database", schema: { titleName: t("Title"), properties: [url, snippet, query], views: [newView(t("Table"), "table")] } });
    const search = createFlow({
      name: `${key}.search`,
      title: `${name}: ${t("search")}`,
      inputs: [{ name: "q", type: "text", required: true }],
      nodes: [{ id: "web", kind: "action", action: "web.search", input: { query: "{{ input.q }}", count: 8 } }],
      output: "{{ steps.web.hits }}",
    }, db);
    const save = createFlow({
      name: `${key}.save`,
      title: `${name}: ${t("keep")}`,
      inputs: [{ name: "title", type: "text", required: true }, { name: "url", type: "url", required: true }, { name: "snippet", type: "text" }, { name: "q", type: "text" }],
      permissions: { write: [db] },
      nodes: [{ id: "add", kind: "action", action: "db.insert", input: { database: String(db), title: "{{ input.title }}", values: { URL: "{{ input.url }}", [snippet.name]: "{{ input.snippet }}", [query.name]: "{{ input.q }}" }, unique: "URL" } }],
      output: "{{ steps.add }}",
    }, db);
    flows.push(search.name, save.name);
    const tpl = [
      '<state name="q" value=""/>',
      `<data name="hits" flow="${search.name}" with="q={{ state.q }}" when="{{ state.q }}" debounce=700/>`,
      "<panes>",
      `<pane title="${q(t("Search the web"))}">`,
      `<toolbar><search bind="q" placeholder="${q(t("Search the web …"))}"/>{{#if data.hits_status == 'loading'}}<muted>${q(t("searching …"))}</muted>{{/if}}</toolbar>`,
      "{{#if data.hits_error}}<callout tone=bad>{{ data.hits_error }}</callout>{{/if}}",
      `{{#if state.q}}{{#each data.hits}}<box><row wrap=false gap=2><col fill=true><a href="{{ url }}"><b>{{ title }}</b></a><small><muted>{{ url | host }}</muted></small><text tone=muted><clamp lines=3>{{ snippet }}</clamp></text></col><button run="${save.name}" with="title={{ title }}, url={{ url }}, q={{ state.q }}, snippet={{ snippet }}" label="${q(t("Keep"))}" done="${q(t("Kept."))}" variant=quiet/></row></box>{{/each}}{{#else}}<empty icon="🔎" title="${q(t("Search the web"))}" text="${q(t("Type above; keep what you want to find again."))}"/>{{/if}}`,
      "</pane>",
      `<pane title="${q(t("Kept"))}" aside="{{ rows | count }}" width=380>`,
      `<list source="rows" open=true empty="${q(t("Nothing kept yet."))}"><row wrap=false><col fill=true><truncate><b>{{ title }}</b></truncate><small><muted>{{ URL | host }}</muted></small></col><button action="delete" label="×" tip="${q(t("Remove"))}" variant=quiet/></row></list>`,
      "</pane>",
      "</panes>",
    ].join("\n");
    finish(db, tpl, name);
    return { dbId: db, flows };
  }

  if (kind === "catalogue") {
    const poster = newProperty(t("Poster"), "url");
    const year = newProperty(t("Year"), "number");
    const rating = newProperty(t("Rating"), "number");
    const mine = newProperty(t("My rating"), "number");
    const tmdb = newProperty("TMDB ID", "text");
    const db = createPage({ parentId, title: name, icon: "🎬", kind: "database", schema: { titleName: t("Title"), properties: [poster, year, rating, mine, tmdb], views: [newView(t("Table"), "table")] } });
    const tpl = [
      '<state name="q" value=""/>',
      `<toolbar><lookup source="tmdb.movies" placeholder="${q(t("Find a film at TMDB and add it"))}" map="${q(poster.name)}=poster, ${q(year.name)}=year, ${q(rating.name)}=rating, TMDB ID=tmdb_id" unique="TMDB ID"/><grow/><search bind="q" placeholder="${q(t("Search the list"))}"/></toolbar>`,
      `<gallery source="rows | search(state.q) | sort('${q(rating.name)}', 'desc')" image="{{ [${poster.name}] }}" alt="{{ title }}" ratio=2:3 min=170 empty="${q(t("Nothing here yet: find a film above."))}"><b>{{ title }}</b> <muted>{{ [${year.name}] }}</muted><row><small>${q(t("Rating"))} {{ [${rating.name}] | number(1) }}</small><grow/><small>${q(t("Mine"))} {{ [${mine.name}] | default('—') }}</small></row></gallery>`,
    ].join("\n");
    finish(db, tpl, name);
    return { dbId: db, flows };
  }

  if (kind === "tracker") {
    const status = select(t("Status"), [t("New"), t("In progress"), t("Done")]);
    const due = newProperty(t("Due"), "date");
    const owner = newProperty(t("Owner"), "text");
    const db = createPage({ parentId, title: name, icon: "📋", kind: "database", schema: { titleName: t("Title"), properties: [status, due, owner], views: [newView(t("Table"), "table")] } });
    const [fresh, doing, done] = status.options.map((o) => o.id);
    const s = getDatabase(db)!.schema;
    updateSchema(db, {
      ...s,
      lifecycle: {
        field: status.id,
        strict: true,
        transitions: [
          { id: "start", name: t("Start"), from: [fresh], to: doing },
          { id: "finish", name: t("Finish"), from: [doing], to: done, require: [owner.id] },
          { id: "reopen", name: t("Reopen"), from: [doing, done], to: fresh },
        ],
      },
    });
    const tpl = [
      `<header title="{{ db.title }}" subtitle="{{ rows | where('${q(status.name)}', '!=', '${q(t("Done"))}') | count }} ${q(t("open"))}"><button action="new" label="${q(t("New"))}" values="${q(status.name)}=${q(t("New"))}" variant=primary/></header>`,
      `<split side=right width=380><board source="rows" group="${q(status.name)}"><b>{{ title }}</b>{{#if [${due.name}]}}<small><muted>{{ [${due.name}] | date }}</muted></small>{{/if}}<button action="select" label="${q(t("Details"))}" variant=link/></board><selected empty=""><header title="{{ title }}"><button action="open" label="${q(t("Open"))}"/></header><field name="${q(owner.name)}"/><field name="${q(due.name)}"/><transitions history=true/></selected></split>`,
    ].join("\n");
    finish(db, tpl, name);
    const r = addRow(db, { title: t("A first item") });
    setCell(r, status.id, fresh);
    return { dbId: db, flows };
  }

  // Empty: a table and a screen of its own to build on.
  const notes = newProperty(t("Notes"), "text");
  const db = createPage({ parentId, title: name, icon: "✨", kind: "database", schema: { titleName: t("Name"), properties: [notes], views: [newView(t("Table"), "table")] } });
  finish(db, ['<state name="q" value=""/>', `<header title="{{ db.title }}"><search bind="q" placeholder="${q(t("Search …"))}"/><button action="new" label="${q(t("New"))}" variant=primary/></header>`, `<list source="rows | search(state.q)" open=true empty="${q(t("Nothing here yet."))}"><b>{{ title }}</b></list>`].join("\n"), name);
  return { dbId: db, flows };
}

/** The app's screen as its first view, its detail page, the page full width. */
function finish(db: number, template: string, name: string): void {
  const s = getDatabase(db)!.schema;
  const screen = appView(name, template);
  const withScreen: DbSchema = { ...s, views: [screen, ...s.views] };
  updateSchema(db, { ...withScreen, rowTemplate: detailTemplate(withScreen) });
  updatePage(db, { fullWidth: true });
}
