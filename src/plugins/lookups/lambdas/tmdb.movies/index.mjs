import { getJson, language2, short, year } from "./lib.mjs";

/**
 * Films at TMDB, through its API, with your own key (Settings → Lookups, or the secret TMDB_KEY): a v3 key goes into the address, a
 * v4 token into the header. Without a key the same fields come from Wikidata (it knows TMDB's id, so a key added later finds the same
 * film), the posters and texts from Wikipedia — no rating then.
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event, context) {
  const key = context.secrets.TMDB_KEY ?? "";
  if (event.mode === "search") return { hits: key ? await search(event.query, event.language, key) : await searchWikidata(event.query, event.language) };
  // (A suggestion made before the key came, too.)
  if (!key || /^Q\d+$/.test(event.id)) return { fields: await detailsWikidata(event.id, event.language) };
  if (!/^\d+$/.test(event.id)) throw new Error("Not a TMDB id.");
  return { fields: await details(event.id, event.language, key) };
}

// -- TMDB -----------------------------------------------------------------------------------------------------------------------

const API = "https://api.themoviedb.org/3";
const image = (p, size) => (typeof p === "string" && p ? `https://image.tmdb.org/t/p/${size}${p}` : "");
const names = (list, max = 20) => (Array.isArray(list) ? list : []).map((x) => String(x?.name ?? "")).filter(Boolean).slice(0, max);

function tmdb(path, params, key) {
  const v3 = /^[0-9a-f]{32}$/i.test(key);
  const query = new URLSearchParams({ ...params, ...(v3 ? { api_key: key } : {}) });
  return getJson(`${API}${path}?${query}`, "TMDB", v3 ? {} : { Authorization: `Bearer ${key}` });
}

async function search(q, language, key) {
  const r = await tmdb("/search/movie", { query: q, language, include_adult: "false" }, key);
  return (r.results ?? []).map((x) => ({ id: String(x.id), title: x.title ?? "", subtitle: [year(x.release_date), short(x.overview, 90)].filter(Boolean).join(" · "), image: image(x.poster_path, "w92") }));
}

async function details(id, language, key) {
  const d = await tmdb(`/movie/${id}`, { language, append_to_response: "credits,external_ids" }, key);
  const imdb = d.external_ids?.imdb_id;
  return {
    title: d.title ?? "",
    original_title: d.original_title ?? "",
    overview: d.overview ?? "",
    tagline: d.tagline ?? "",
    year: year(d.release_date) ? Number(year(d.release_date)) : null,
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    genres: names(d.genres),
    cast: names(d.credits?.cast, 8),
    language: d.original_language ?? "",
    poster: image(d.poster_path, "w500"),
    backdrop: image(d.backdrop_path, "w1280"),
    tmdb_id: d.id,
    id: d.id,
    url: `https://www.themoviedb.org/movie/${d.id}?language=${language2(language)}`,
    imdb_url: imdb ? `https://www.imdb.com/title/${imdb}/` : "",
    release_date: d.release_date ?? "",
    runtime: d.runtime || null,
    director: (d.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name ?? "").filter(Boolean),
    countries: names(d.production_countries),
  };
}

// -- Without a key: Wikidata and Wikipedia ----------------------------------------------------------------------------------------

const WIKIDATA = "https://www.wikidata.org/w/api.php?format=json&";
/** Wikidata's "TMDB film id": what has one is a film, and "Dune" finds no sand. */
const TMDB_ID = "P4947";

const values = (e, prop) => (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated").map((c) => c.mainsnak?.datavalue?.value).filter((v) => v !== undefined);
const items = (e, prop) => values(e, prop).map((v) => v?.id ?? "").filter(Boolean);
/** In the language asked for, else English, else "mul" (a film's title often is the same in all). */
const text = (labels, lang) => labels?.[lang]?.value ?? labels?.en?.value ?? labels?.mul?.value ?? "";
/** The earliest of its release dates (each country has its own). */
const released = (e) => values(e, "P577").map((v) => String(v?.time ?? "").replace(/^\+/, "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] ?? "";

const entities = async (ids, props, lang) =>
  (await getJson(`${WIKIDATA}${new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props, languages: [...new Set([lang, "en", "mul"])].join("|"), sitefilter: [...new Set([`${lang}wiki`, "enwiki"])].join("|") })}`, "Wikidata")).entities ?? {};

/** The pictures of English articles, by title — Wikipedia's film articles show the poster. */
async function posters(titles, size) {
  if (!titles.length) return new Map();
  const r = await getJson(`https://en.wikipedia.org/w/api.php?format=json&${new URLSearchParams({ action: "query", prop: "pageimages", piprop: "thumbnail", pithumbsize: String(size), pilicense: "any", pilimit: "50", redirects: "1", titles: titles.join("|") })}`, "Wikipedia");
  const found = new Map(Object.values(r.query?.pages ?? {}).map((p) => [p.title ?? "", (p.thumbnail?.source ?? "").split("?")[0]]));
  const renamed = new Map([...(r.query?.normalized ?? []), ...(r.query?.redirects ?? [])].map((x) => [x.from, x.to]));
  return new Map(titles.map((t) => [t, found.get(renamed.get(renamed.get(t) ?? t) ?? renamed.get(t) ?? t) ?? ""]));
}

async function searchWikidata(q, language) {
  const lang = language2(language);
  const r = await getJson(`${WIKIDATA}${new URLSearchParams({ action: "query", list: "search", srsearch: `${q} haswbstatement:${TMDB_ID}`, srlimit: "15", srnamespace: "0" })}`, "Wikidata");
  const ids = (r.query?.search ?? []).map((x) => x.title ?? "").filter((x) => /^Q\d+$/.test(x));
  if (!ids.length) return [];
  const found = await entities(ids, "labels|descriptions|claims|sitelinks", lang);
  // (Their pictures are a nicety: without them the suggestions still come.)
  const pics = await posters(ids.flatMap((id) => found[id]?.sitelinks?.enwiki?.title ?? []), 92).catch(() => new Map());
  // Wikidata ranks by the words: what is well known is described in detail, and comes first.
  const known = (id) => Object.keys(found[id]?.claims ?? {}).length;
  return [...ids].sort((a, b) => known(b) - known(a)).slice(0, 8).flatMap((id) => {
    const e = found[id];
    if (!e) return [];
    const article = e.sitelinks?.enwiki?.title;
    return [{ id, title: text(e.labels, lang), subtitle: [year(released(e)), short(text(e.descriptions, lang), 90)].filter(Boolean).join(" · "), image: article ? pics.get(article) || "" : "" }];
  });
}

async function detailsWikidata(id, language) {
  if (!/^Q\d+$/.test(id)) throw new Error("Not a Wikidata film.");
  const lang = language2(language);
  const e = (await entities([id], "labels|descriptions|claims|sitelinks", lang))[id];
  if (!e) throw new Error("Wikidata doesn't know that film.");
  const director = items(e, "P57");
  const cast = items(e, "P161").slice(0, 8);
  const genres = items(e, "P136").slice(0, 10);
  const countries = items(e, "P495").slice(0, 6);
  const others = [...new Set([...director, ...cast, ...genres, ...countries])];
  const named = new Map();
  // (At most 50 ids a request.)
  for (let i = 0; i < others.length; i += 50) for (const [k, v] of Object.entries(await entities(others.slice(i, i + 50), "labels", lang))) named.set(k, v);
  const nameOf = (ids) => ids.map((x) => text(named.get(x)?.labels, lang)).filter(Boolean);
  const article = e.sitelinks?.[`${lang}wiki`]?.title;
  const english = e.sitelinks?.enwiki?.title;
  const wiki = article ? { lang, title: article } : english ? { lang: "en", title: english } : null;
  const summary = wiki ? await getJson(`https://${wiki.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki.title.replace(/ /g, "_"))}`, "Wikipedia").catch(() => null) : null;
  const poster = english ? ((await posters([english], 500).catch(() => null))?.get(english) ?? "") : "";
  const date = released(e);
  const tmdbId = Number(values(e, TMDB_ID)[0]) || null;
  const imdb = String(values(e, "P345")[0] ?? "");
  const minutes = values(e, "P2047").map((v) => Number(v?.amount))[0];
  return {
    title: text(e.labels, lang),
    original_title: String(values(e, "P1476")[0]?.text ?? ""),
    overview: summary?.extract ?? text(e.descriptions, lang),
    tagline: "",
    year: year(date) ? Number(year(date)) : null,
    rating: null,
    genres: nameOf(genres),
    cast: nameOf(cast),
    language: "",
    poster,
    backdrop: "",
    tmdb_id: tmdbId,
    id: tmdbId,
    url: tmdbId ? `https://www.themoviedb.org/movie/${tmdbId}?language=${lang}` : `https://www.wikidata.org/wiki/${id}`,
    imdb_url: imdb ? `https://www.imdb.com/title/${imdb}/` : "",
    release_date: date,
    runtime: minutes > 0 ? minutes : null,
    director: nameOf(director),
    countries: nameOf(countries),
  };
}
