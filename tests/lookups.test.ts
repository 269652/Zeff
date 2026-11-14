import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, before, beforeEach } from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin } from "./plugins-repo";

setupTempData();

/**
 * ZEFF_LOOKUPS_EXT=1 (tests/lookups-ext.test.ts): the same tests against Lookups as an external plugin from the zeff-plugins
 * repository (plugins/lookups-ext) instead of the built-in one — the port is 1:1 when both pass.
 */
const EXT = process.env.ZEFF_LOOKUPS_EXT === "1";
before(async () => {
  if (!EXT) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-lookups-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("lookups-ext"), path.join(dir, "lookups-ext"), { recursive: true });
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("lookups-ext", true);
  (await import("@/plugins/state")).setInstalled("lookups", false);
});
/** The TMDB key, where the Lookups in use keep it: the built-in's settings, or the plugin's (encrypted). */
async function setTmdbKey(key: string) {
  if (!EXT) return (await import("@/plugins/lookups/config")).saveLookupConfig({ tmdbKey: key });
  const reg = await import("@/lib/ext/registry");
  const ps = await import("@/lib/ext/plugin-settings");
  const m = reg.getPlugin("lookups-ext")!.manifest;
  if (key) ps.saveSettings("lookups-ext", m, { TMDB_KEY: key });
  else ps.saveSettings("lookups-ext", m, {}, ["TMDB_KEY"]);
}

const realFetch = globalThis.fetch;
let asked: { url: string; auth: string | null }[] = [];

const MOVIE = {
  id: 438631,
  title: "Dune",
  original_title: "Dune: Part One",
  overview: "Paul Atreides",
  release_date: "2021-09-16",
  runtime: 155,
  vote_average: 7.83,
  poster_path: "/p.jpg",
  genres: [{ name: "Science Fiction" }, { name: "Abenteuer" }],
  credits: { cast: [{ name: "Punchthée Chalamet" }], crew: [{ name: "Denis Villeneuve", job: "Director" }, { name: "Someone", job: "Editor" }] },
  external_ids: { imdb_id: "tt1160419" },
  production_countries: [{ name: "USA" }],
};

beforeEach(() => {
  asked = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.includes("list=search")) return Response.json({ query: { search: [{ title: "Q63985561" }] } });
    if (url.includes("action=wbgetentities") && url.includes("Q63985561"))
      return Response.json({
        entities: {
          Q63985561: {
            labels: { mul: { value: "Dune" } },
            descriptions: { de: { value: "Film von Denis Villeneuve" } },
            sitelinks: { enwiki: { title: "Dune (2021 film)" } },
            claims: {
              P4947: [{ mainsnak: { datavalue: { value: "438631" } } }],
              P345: [{ mainsnak: { datavalue: { value: "tt1160419" } } }],
              P577: [{ mainsnak: { datavalue: { value: { time: "+2021-10-22T00:00:00Z" } } } }, { mainsnak: { datavalue: { value: { time: "+2021-09-03T00:00:00Z" } } } }],
              P57: [{ mainsnak: { datavalue: { value: { id: "Q1" } } } }],
              P136: [{ mainsnak: { datavalue: { value: { id: "Q2" } } } }],
              P2047: [{ mainsnak: { datavalue: { value: { amount: "+155" } } } }],
            },
          },
        },
      });
    if (url.includes("action=wbgetentities")) return Response.json({ entities: { Q1: { labels: { de: { value: "Denis Villeneuve" } } }, Q2: { labels: { de: { value: "Science-Fiction-Film" } } } } });
    if (url.includes("prop=pageimages")) return Response.json({ query: { pages: { "1": { title: "Dune (2021 film)", thumbnail: { source: "https://upload.wikimedia.org/wikipedia/en/d/dune.jpg?utm_source=x" } } } } });
    if (url.includes("page/summary")) return Response.json({ extract: "Dune ist ein Film." });
    if (url.includes("/search/shows")) return Response.json([{ show: { id: 44933, name: "Severance", premiered: "2022-02-18", summary: "<p>An office.</p>", image: { medium: "https://static.tvmaze.com/m.jpg" } } }]);
    if (url.includes("/shows/44933")) return Response.json({ id: 44933, name: "Severance", premiered: "2022-02-18", summary: "<p>An office.</p>", status: "Running", genres: ["Drama"], rating: { average: 7.7 }, image: { original: "https://static.tvmaze.com/o.jpg" }, webChannel: { name: "Apple TV" }, url: "https://www.tvmaze.com/shows/44933/severance", _embedded: { cast: [{ person: { name: "Adam Scott" } }], seasons: [{ episodeOrder: 9 }, { episodeOrder: 10 }], crew: [{ type: "Creator", person: { name: "Dan Erickson" } }] } });
    if (url.includes("/search/movie")) return Response.json({ results: [{ id: 438631, title: "Dune", release_date: "2021-09-16", overview: "Paul Atreides", poster_path: "/p.jpg" }] });
    if (url.includes("/movie/438631")) return Response.json(MOVIE);
    if (url.includes("/movie/1")) return Response.json({ status_message: "Invalid API key" }, { status: 401 });
    throw new Error(`Unexpected ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function films() {
  const { createPage, getDatabase } = await import("@/plugins/workspace/store");
  const id = createPage({
    parentId: null,
    title: "Filme",
    kind: "database",
    schema: {
      titleName: "Name",
      properties: [
        { id: "poster", name: "Poster", type: "url" },
        { id: "year", name: "Jahr", type: "number" },
        { id: "yeartext", name: "Jahr als Text", type: "text" },
        { id: "genres", name: "Genre", type: "multi_select", options: [{ id: "sf", name: "Science Fiction", color: "blue" }] },
        { id: "cast", name: "Besetzung", type: "text" },
        { id: "tmdb", name: "TMDB", type: "number" },
      ],
      views: [{ id: "v1", name: "Liste", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }],
    },
  });
  return { id, db: () => getDatabase(id)! };
}

const MAP: [string, string][] = [["Poster", "poster"], ["Jahr", "year"], ["Jahr als Text", "year"], ["Genre", "genres"], ["Besetzung", "cast"], ["TMDB", "tmdb_id"]];

test("the sources: every one lists its fields; one that needs a key says so and the search doesn't go out; the AI reads them whole", async () => {
  const { lookupSources, searchLookup, lookupReference } = await import("@/plugins/workspace/lookups");
  const ids = lookupSources().map((s) => s.id);
  for (const id of ["tmdb.movies", "tmdb.tv", "wikipedia", "openlibrary", "google.books", "google.knowledge", "web.search"]) assert.ok(ids.includes(id), id);
  await assert.rejects(searchLookup("google.books", "Dune", "de-DE"), /Google API key/);
  await assert.rejects(searchLookup("nothing.here", "Dune", "de-DE"), /tmdb\.movies/, "an unknown source names the real ones");
  assert.equal(asked.length, 0);
  assert.match(lookupReference(), /google\.books .*NOT READY/);
  assert.doesNotMatch(lookupReference(), /tmdb\.movies [^\n]*NOT READY/);
  const { resultCap } = await import("@/plugins/workspace/agent");
  const { viewReference } = await import("@/plugins/workspace/view-template");
  assert.ok(`${viewReference()}\n\n${lookupReference()}`.length < resultCap("workspace_view_template_docs"), "the sources come last: nothing of the docs is cut off");
});

test("without a key: a film from Wikidata, with TMDB's id and its poster; a series from TVmaze — one view works before and after a key", async () => {
  const { addLookupRow, searchLookup } = await import("@/plugins/workspace/lookups");
  const { rowsOf } = await import("@/plugins/workspace/store");
  await setTmdbKey("");
  const found = await searchLookup("tmdb.movies", "Dune", "de-DE");
  assert.deepEqual(found.hits[0], { id: "Q63985561", title: "Dune", subtitle: "2021 · Film von Denis Villeneuve", image: "https://upload.wikimedia.org/wikipedia/en/d/dune.jpg" });
  assert.match(found.credit, /Wikidata/);
  assert.ok(!asked.some((a) => a.url.includes("themoviedb")), "TMDB isn't asked");

  const { id } = await films();
  const made = await addLookupRow({ dbId: id, source: "tmdb.movies", hit: found.hits[0].id, language: "de-DE", map: MAP, unique: "TMDB" });
  const row = rowsOf(id)!.rows.find((r) => r.id === made.id)!;
  assert.equal(row.title, "Dune");
  assert.equal(row.cells.poster, "https://upload.wikimedia.org/wikipedia/en/d/dune.jpg");
  assert.equal(row.cells.year, 2021, "its first release");
  assert.equal(row.cells.tmdb, 438631, "the id a key would give");
  const byId = await addLookupRow({ dbId: id, source: "tmdb.movies", hit: found.hits[0].id, language: "de-DE", map: [["TMDB", "id"]], unique: "TMDB" });
  assert.equal(byId.existed, true, "`id` is tmdb_id");

  const shows = await searchLookup("tmdb.tv", "Severance", "de-DE");
  assert.equal(shows.hits[0].title, "Severance");
  const tv = [["Poster", "poster"], ["Besetzung", "cast"], ["TMDB", "tmdb_id"]] as [string, string][];
  const show = await addLookupRow({ dbId: id, source: "tmdb.tv", hit: "44933", language: "de-DE", map: tv, unique: "TMDB" });
  assert.equal(rowsOf(id)!.rows.find((r) => r.id === show.id)!.cells.poster, "https://static.tvmaze.com/o.jpg");
  const again = await addLookupRow({ dbId: id, source: "tmdb.tv", hit: "44933", language: "de-DE", map: tv, unique: "TMDB" });
  assert.equal(again.existed, true, "no TMDB id without a key: by its title");
  assert.equal(rowsOf(id)!.rows.length, 2);
});

test("a slow source waits for Enter; the document behind the hit picked becomes the row's page", async () => {
  const { workspaceLookups } = await import("@/plugins/workspace/lookup-point");
  const { addLookupRow, searchLookup } = await import("@/plugins/workspace/lookups");
  const { getPage } = await import("@/plugins/workspace/store");
  const { docText } = await import("@/plugins/workspace/doc");
  let searched = 0;
  workspaceLookups.contribute("core", [
    {
      id: "test.slow",
      label: "Slow",
      what: "",
      slow: true,
      fields: { title: "", url: "" },
      search: async () => (searched++, [{ id: "1", title: "Doc" }]),
      details: async () => ({ title: "Doc", url: "https://example.org/", _page: "Der ganze Text." }),
    },
  ]);
  assert.deepEqual(await searchLookup("test.slow", "dune", "de-DE"), { hits: [], credit: "", askEnter: true });
  assert.equal(searched, 0, "typing costs nothing");
  assert.equal((await searchLookup("test.slow", "dune", "de-DE", true)).hits.length, 1);
  const { id } = await films();
  const made = await addLookupRow({ dbId: id, source: "test.slow", hit: "1", language: "de-DE", map: [["Poster", "url"]] });
  assert.match(docText(getPage(made.id)!.content), /Der ganze Text/);
});

test("TMDB: a v3 key goes into the address, a token into the header; a hit is short, one picked is complete", async () => {
  const { searchLookup } = await import("@/plugins/workspace/lookups");
  await setTmdbKey("0123456789abcdef0123456789abcdef");
  const r = await searchLookup("tmdb.movies", "Dune", "de-DE");
  assert.deepEqual(r.hits[0], { id: "438631", title: "Dune", subtitle: "2021 · Paul Atreides", image: "https://image.tmdb.org/t/p/w92/p.jpg" });
  assert.match(r.credit, /not endorsed or certified by TMDB/);
  assert.match(asked[0].url, /api_key=0123/);
  assert.match(asked[0].url, /language=de-DE/);

  await setTmdbKey("eyJhbGciOi.token");
  await searchLookup("tmdb.movies", "Dune", "de-DE");
  assert.equal(asked[1].auth, "Bearer eyJhbGciOi.token");
  assert.doesNotMatch(asked[1].url, /api_key/);

  assert.deepEqual((await searchLookup("tmdb.movies", " D ", "de-DE")).hits, [], "one letter isn't asked");
  assert.equal(asked.length, 2);
});

test("the hit picked becomes a row: its data in the properties, a new genre an option, the poster linked — picked again it stays one", async () => {
  const { addLookupRow } = await import("@/plugins/workspace/lookups");
  const { rowsOf } = await import("@/plugins/workspace/store");
  await setTmdbKey("eyJtoken");
  const { id, db } = await films();
  const made = await addLookupRow({ dbId: id, source: "tmdb.movies", hit: "438631", language: "de-DE", map: MAP, unique: "TMDB" });
  assert.equal(made.existed, false);
  assert.equal(made.title, "Dune");
  const row = rowsOf(id)!.rows.find((r) => r.id === made.id)!;
  assert.equal(row.title, "Dune");
  assert.equal(row.cells.poster, "https://image.tmdb.org/t/p/w500/p.jpg");
  assert.equal(row.cells.year, 2021);
  assert.equal(row.cells.yeartext, "2021");
  assert.equal(row.cells.cast, "Punchthée Chalamet", "a list in a text");
  const genres = row.cells.genres as string[];
  assert.equal(genres.length, 2);
  assert.equal(genres[0], "sf", "the option there");
  assert.equal(db().schema.properties.find((p) => p.id === "genres")!.options!.length, 2, "and a new one");

  const again = await addLookupRow({ dbId: id, source: "tmdb.movies", hit: "438631", language: "de-DE", map: MAP, unique: "TMDB" });
  assert.equal(again.existed, true);
  assert.equal(again.id, made.id);
  assert.equal(rowsOf(id)!.rows.length, 1);
});

test("what can't be filled makes no row: a field the source hasn't, an answer that fails — and the key stays out of the message", async () => {
  const { addLookupRow } = await import("@/plugins/workspace/lookups");
  const { rowsOf } = await import("@/plugins/workspace/store");
  await setTmdbKey("0123456789abcdef0123456789abcdef");
  const { id } = await films();
  await assert.rejects(addLookupRow({ dbId: id, source: "tmdb.movies", hit: "438631", language: "de-DE", map: [["Poster", "cover"], ["Jahr", "yeer"]] }), /no field “cover”, “yeer”.*poster/);
  await assert.rejects(addLookupRow({ dbId: id, source: "tmdb.movies", hit: "1", language: "de-DE", map: MAP }), (e: Error) => /Invalid API key/.test(e.message) && !e.message.includes("0123"));
  await assert.rejects(addLookupRow({ dbId: id, source: "tmdb.movies", hit: "../secrets", language: "de-DE", map: MAP }), /Not a TMDB id/);
  assert.equal(rowsOf(id)!.rows.length, 0);
});

test("a template: <lookup> is drawn with its map; a property that isn't there is refused with its line", async () => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const props = [{ id: "poster", name: "Poster", type: "url" }] as never;
  const draw = (src: string) => renderView(src, { rows: [], props, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "Filme" } });
  const good = draw('<lookup source="tmdb.movies" placeholder="Film" map="Poster=poster, Name=title" unique="Poster"/>');
  assert.deepEqual(good.errors, []);
  const node = good.nodes.find((n) => typeof n !== "string") as { t: string; a: Record<string, string> };
  assert.equal(node.t, "lookup");
  assert.deepEqual(JSON.parse(node.a.map), [["Poster", "poster"], ["Name", "title"]]);
  assert.match(draw('<lookup source="tmdb.movies" map="Cover=poster"/>').errors[0].message, /no property “Cover”/);
  assert.match(draw('<lookup source="tmdb.movies"/>').errors[0].message, /needs map/);
});
