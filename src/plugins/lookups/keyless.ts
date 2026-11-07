import { htmlToText } from "@/plugins/web-search/search";
import type { LookupHit, LookupValue } from "@/plugins/workspace/lookup-point";
import { getJson, language2, short, year } from "./http";

/**
 * Films and series without any key: what the TMDB sources answer with until there is one. Films from Wikidata (it knows TMDB's id, so
 * a key added later finds the same film), their posters and texts from Wikipedia; series from TVmaze. Wikidata has no rating, and a
 * film with no English article has no poster. Server only.
 */

export const FILMS_CREDIT = "Data: Wikidata and Wikipedia.";
export const SHOWS_CREDIT = "Data: TVmaze (CC BY-SA).";

// -- Films ----------------------------------------------------------------------------------------------------------------------

const WIKIDATA = "https://www.wikidata.org/w/api.php?format=json&";
/** Wikidata's "TMDB film id": what has one is a film, and "Dune" finds no sand. */
const TMDB_ID = "P4947";

type Snak = { rank?: string; mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { labels?: Record<string, { value?: string }>; descriptions?: Record<string, { value?: string }>; claims?: Record<string, Snak[]>; sitelinks?: Record<string, { title?: string }> };

const values = (e: Entity, prop: string): unknown[] => (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated").map((c) => c.mainsnak?.datavalue?.value).filter((v) => v !== undefined);
const items = (e: Entity, prop: string): string[] => values(e, prop).map((v) => (v as { id?: string }).id ?? "").filter(Boolean);
/** In the language asked for, else English, else "mul": the name that is the same in all of them (a film's title often is). */
const text = (labels: Entity["labels"] | Entity["descriptions"], lang: string) => labels?.[lang]?.value ?? labels?.en?.value ?? labels?.mul?.value ?? "";
/** The earliest of its release dates (each country has its own). */
const released = (e: Entity): string => values(e, "P577").map((v) => String((v as { time?: string }).time ?? "").replace(/^\+/, "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] ?? "";

const entities = async (ids: string[], props: string, lang: string) =>
  (await getJson<{ entities?: Record<string, Entity> }>(`${WIKIDATA}${new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props, languages: [...new Set([lang, "en", "mul"])].join("|"), sitefilter: [...new Set([`${lang}wiki`, "enwiki"])].join("|") })}`, "Wikidata")).entities ?? {};

/** The pictures of English articles, by title — Wikipedia's film articles show the poster. */
async function posters(titles: string[], size: number): Promise<Map<string, string>> {
  if (!titles.length) return new Map();
  const r = await getJson<{ query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }>; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } }>(
    `https://en.wikipedia.org/w/api.php?format=json&${new URLSearchParams({ action: "query", prop: "pageimages", piprop: "thumbnail", pithumbsize: String(size), pilicense: "any", pilimit: "50", redirects: "1", titles: titles.join("|") })}`,
    "Wikipedia",
  );
  const found = new Map(Object.values(r.query?.pages ?? {}).map((p) => [p.title ?? "", (p.thumbnail?.source ?? "").split("?")[0]]));
  const renamed = new Map([...(r.query?.normalized ?? []), ...(r.query?.redirects ?? [])].map((x) => [x.from, x.to]));
  return new Map(titles.map((t) => [t, found.get(renamed.get(renamed.get(t) ?? t) ?? renamed.get(t) ?? t) ?? ""]));
}

export async function searchFilms(q: string, language: string): Promise<LookupHit[]> {
  const lang = language2(language);
  const r = await getJson<{ query?: { search?: { title?: string }[] } }>(`${WIKIDATA}${new URLSearchParams({ action: "query", list: "search", srsearch: `${q} haswbstatement:${TMDB_ID}`, srlimit: "15", srnamespace: "0" })}`, "Wikidata");
  const ids = (r.query?.search ?? []).map((x) => x.title ?? "").filter((x) => /^Q\d+$/.test(x));
  if (!ids.length) return [];
  const found = await entities(ids, "labels|descriptions|claims|sitelinks", lang);
  // (Their pictures are a nicety: without them the suggestions still come.)
  const pics = await posters(ids.flatMap((id) => found[id]?.sitelinks?.enwiki?.title ?? []), 92).catch(() => new Map<string, string>());
  // Wikidata ranks by the words: "Dune" finds any film with it. What is well known is described in detail, and comes first.
  const known = (id: string) => Object.keys(found[id]?.claims ?? {}).length;
  return [...ids].sort((a, b) => known(b) - known(a)).slice(0, 8).flatMap((id) => {
    const e = found[id];
    if (!e) return [];
    const article = e.sitelinks?.enwiki?.title;
    return [{ id, title: text(e.labels, lang), subtitle: [year(released(e)), short(text(e.descriptions, lang), 90)].filter(Boolean).join(" · "), image: article ? pics.get(article) || "" : "" }];
  });
}

export async function filmDetails(id: string, language: string): Promise<Record<string, LookupValue>> {
  if (!/^Q\d+$/.test(id)) throw new Error("Not a Wikidata film.");
  const lang = language2(language);
  const e = (await entities([id], "labels|descriptions|claims|sitelinks", lang))[id];
  if (!e) throw new Error("Wikidata doesn't know that film.");
  const director = items(e, "P57");
  const cast = items(e, "P161").slice(0, 8);
  const genres = items(e, "P136").slice(0, 10);
  const countries = items(e, "P495").slice(0, 6);
  const others = [...new Set([...director, ...cast, ...genres, ...countries])];
  const named = new Map<string, Entity>();
  // (At most 50 ids a request.)
  for (let i = 0; i < others.length; i += 50) for (const [k, v] of Object.entries(await entities(others.slice(i, i + 50), "labels", lang))) named.set(k, v);
  const names = (ids: string[]) => ids.map((x) => text(named.get(x)?.labels, lang)).filter(Boolean);
  const article = e.sitelinks?.[`${lang}wiki`]?.title;
  const english = e.sitelinks?.enwiki?.title;
  const wiki = article ? { lang, title: article } : english ? { lang: "en", title: english } : null;
  const summary = wiki ? await getJson<{ extract?: string }>(`https://${wiki.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki.title.replace(/ /g, "_"))}`, "Wikipedia").catch(() => null) : null;
  const poster = english ? ((await posters([english], 500).catch(() => null))?.get(english) ?? "") : "";
  const date = released(e);
  const tmdb = Number(values(e, TMDB_ID)[0]) || null;
  const imdb = String(values(e, "P345")[0] ?? "");
  const minutes = values(e, "P2047").map((v) => Number((v as { amount?: string }).amount))[0];
  return {
    title: text(e.labels, lang),
    original_title: String((values(e, "P1476")[0] as { text?: string } | undefined)?.text ?? ""),
    overview: summary?.extract ?? text(e.descriptions, lang),
    tagline: "",
    year: year(date) ? Number(year(date)) : null,
    rating: null,
    genres: names(genres),
    cast: names(cast),
    language: "",
    poster,
    backdrop: "",
    tmdb_id: tmdb,
    url: tmdb ? `https://www.themoviedb.org/movie/${tmdb}?language=${lang}` : `https://www.wikidata.org/wiki/${id}`,
    imdb_url: imdb ? `https://www.imdb.com/title/${imdb}/` : "",
    release_date: date,
    runtime: minutes > 0 ? minutes : null,
    director: names(director),
    countries: names(countries),
  };
}

// -- Series ---------------------------------------------------------------------------------------------------------------------

const TVMAZE = "https://api.tvmaze.com";
type Show = {
  id: number;
  name?: string;
  url?: string;
  language?: string;
  genres?: string[];
  status?: string;
  averageRuntime?: number;
  premiered?: string;
  rating?: { average?: number | null };
  network?: { name?: string } | null;
  webChannel?: { name?: string } | null;
  externals?: { imdb?: string | null };
  image?: { medium?: string; original?: string } | null;
  summary?: string | null;
  _embedded?: { cast?: { person?: { name?: string } }[]; seasons?: { episodeOrder?: number | null }[]; crew?: { type?: string; person?: { name?: string } }[] };
};
const plain = (html: string | null | undefined) => htmlToText(html ?? "").text.replace(/\s+/g, " ").trim();

export async function searchShows(q: string): Promise<LookupHit[]> {
  const r = await getJson<{ show: Show }[]>(`${TVMAZE}/search/shows?${new URLSearchParams({ q })}`, "TVmaze");
  return r.map(({ show: s }) => ({ id: String(s.id), title: s.name ?? "", subtitle: [year(s.premiered), short(plain(s.summary), 90)].filter(Boolean).join(" · "), image: s.image?.medium ?? "" }));
}

export async function showDetails(id: string): Promise<Record<string, LookupValue>> {
  if (!/^\d+$/.test(id)) throw new Error("Not a TVmaze show.");
  const s = await getJson<Show>(`${TVMAZE}/shows/${id}?embed[]=cast&embed[]=seasons&embed[]=crew`, "TVmaze");
  const seasons = s._embedded?.seasons ?? [];
  const names = (list: { person?: { name?: string } }[]) => [...new Set(list.map((x) => x.person?.name ?? "").filter(Boolean))];
  const channel = s.network?.name ?? s.webChannel?.name ?? "";
  return {
    title: s.name ?? "",
    original_title: s.name ?? "",
    overview: plain(s.summary),
    tagline: "",
    year: year(s.premiered) ? Number(year(s.premiered)) : null,
    rating: s.rating?.average ?? null,
    genres: s.genres ?? [],
    cast: names(s._embedded?.cast ?? []).slice(0, 8),
    language: s.language ?? "",
    poster: s.image?.original ?? s.image?.medium ?? "",
    backdrop: "",
    tmdb_id: null,
    url: s.url ?? "",
    imdb_url: s.externals?.imdb ? `https://www.imdb.com/title/${s.externals.imdb}/` : "",
    first_air_date: s.premiered ?? "",
    status: s.status ?? "",
    seasons: seasons.length || null,
    episodes: seasons.reduce((n, x) => n + (x.episodeOrder ?? 0), 0) || null,
    runtime: s.averageRuntime ?? null,
    creators: names((s._embedded?.crew ?? []).filter((c) => c.type === "Creator")),
    networks: channel ? [channel] : [],
  };
}
