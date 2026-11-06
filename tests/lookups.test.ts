import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

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

test("the sources: every one lists its fields; without its key it says what it needs, and the search doesn't go out", async () => {
  const { lookupSources, searchLookup, lookupReference } = await import("@/plugins/workspace/lookups");
  const ids = lookupSources().map((s) => s.id);
  for (const id of ["tmdb.movies", "tmdb.tv", "wikipedia", "openlibrary", "google.books", "google.knowledge", "web.search"]) assert.ok(ids.includes(id), id);
  await assert.rejects(searchLookup("tmdb.movies", "Dune", "de-DE"), /TMDB/);
  await assert.rejects(searchLookup("nothing.here", "Dune", "de-DE"), /tmdb\.movies/, "an unknown source names the real ones");
  assert.equal(asked.length, 0);
  assert.match(lookupReference(), /tmdb\.movies .*NOT READY.*poster/);
});

test("TMDB: a v3 key goes into the address, a token into the header; a hit is short, one picked is complete", async () => {
  const { saveLookupConfig } = await import("@/plugins/lookups/config");
  const { searchLookup } = await import("@/plugins/workspace/lookups");
  saveLookupConfig({ tmdbKey: "0123456789abcdef0123456789abcdef" });
  const r = await searchLookup("tmdb.movies", "Dune", "de-DE");
  assert.deepEqual(r.hits[0], { id: "438631", title: "Dune", subtitle: "2021 · Paul Atreides", image: "https://image.tmdb.org/t/p/w92/p.jpg" });
  assert.match(r.credit, /not endorsed or certified by TMDB/);
  assert.match(asked[0].url, /api_key=0123/);
  assert.match(asked[0].url, /language=de-DE/);

  saveLookupConfig({ tmdbKey: "eyJhbGciOi.token" });
  await searchLookup("tmdb.movies", "Dune", "de-DE");
  assert.equal(asked[1].auth, "Bearer eyJhbGciOi.token");
  assert.doesNotMatch(asked[1].url, /api_key/);

  assert.deepEqual((await searchLookup("tmdb.movies", " D ", "de-DE")).hits, [], "one letter isn't asked");
  assert.equal(asked.length, 2);
});

test("the hit picked becomes a row: its data in the properties, a new genre an option, the poster linked — picked again it stays one", async () => {
  const { saveLookupConfig } = await import("@/plugins/lookups/config");
  const { addLookupRow } = await import("@/plugins/workspace/lookups");
  const { rowsOf } = await import("@/plugins/workspace/store");
  saveLookupConfig({ tmdbKey: "eyJtoken" });
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
  const { saveLookupConfig } = await import("@/plugins/lookups/config");
  const { addLookupRow } = await import("@/plugins/workspace/lookups");
  const { rowsOf } = await import("@/plugins/workspace/store");
  saveLookupConfig({ tmdbKey: "0123456789abcdef0123456789abcdef" });
  const { id } = await films();
  await assert.rejects(addLookupRow({ dbId: id, source: "tmdb.movies", hit: "438631", language: "de-DE", map: [["Poster", "cover"]] }), /no field “cover”.*poster/);
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
