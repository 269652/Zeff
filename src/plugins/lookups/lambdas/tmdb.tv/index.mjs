import { getJson, language2, plain, short, year } from "./lib.mjs";

/**
 * TV series at TMDB with your key (Settings → Lookups, or the secret TMDB_KEY); without one from TVmaze — in English then, and no
 * tmdb_id.
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event, context) {
  const key = context.secrets.TMDB_KEY ?? "";
  if (event.mode === "search") return { hits: key ? await search(event.query, event.language, key) : await searchTvmaze(event.query) };
  if (!key) return { fields: await detailsTvmaze(event.id) };
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
  const r = await tmdb("/search/tv", { query: q, language, include_adult: "false" }, key);
  return (r.results ?? []).map((x) => ({ id: String(x.id), title: x.name ?? "", subtitle: [year(x.first_air_date), short(x.overview, 90)].filter(Boolean).join(" · "), image: image(x.poster_path, "w92") }));
}

async function details(id, language, key) {
  const d = await tmdb(`/tv/${id}`, { language, append_to_response: "credits,external_ids" }, key);
  const imdb = d.external_ids?.imdb_id;
  return {
    title: d.name ?? "",
    original_title: d.original_name ?? "",
    overview: d.overview ?? "",
    tagline: d.tagline ?? "",
    year: year(d.first_air_date) ? Number(year(d.first_air_date)) : null,
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    genres: names(d.genres),
    cast: names(d.credits?.cast, 8),
    language: d.original_language ?? "",
    poster: image(d.poster_path, "w500"),
    backdrop: image(d.backdrop_path, "w1280"),
    tmdb_id: d.id,
    id: d.id,
    url: `https://www.themoviedb.org/tv/${d.id}?language=${language2(language)}`,
    imdb_url: imdb ? `https://www.imdb.com/title/${imdb}/` : "",
    first_air_date: d.first_air_date ?? "",
    status: d.status ?? "",
    seasons: d.number_of_seasons ?? null,
    episodes: d.number_of_episodes ?? null,
    runtime: d.episode_run_time?.[0] ?? null,
    creators: names(d.created_by),
    networks: names(d.networks),
  };
}

// -- Without a key: TVmaze --------------------------------------------------------------------------------------------------------

const TVMAZE = "https://api.tvmaze.com";
const text = (html) => plain(html).replace(/\s+/g, " ").trim();

async function searchTvmaze(q) {
  const r = await getJson(`${TVMAZE}/search/shows?${new URLSearchParams({ q })}`, "TVmaze");
  return r.map(({ show: s }) => ({ id: String(s.id), title: s.name ?? "", subtitle: [year(s.premiered), short(text(s.summary), 90)].filter(Boolean).join(" · "), image: s.image?.medium ?? "" }));
}

async function detailsTvmaze(id) {
  if (!/^\d+$/.test(id)) throw new Error("Not a TVmaze show.");
  const s = await getJson(`${TVMAZE}/shows/${id}?embed[]=cast&embed[]=seasons&embed[]=crew`, "TVmaze");
  const seasons = s._embedded?.seasons ?? [];
  const people = (list) => [...new Set(list.map((x) => x.person?.name ?? "").filter(Boolean))];
  const channel = s.network?.name ?? s.webChannel?.name ?? "";
  return {
    title: s.name ?? "",
    original_title: s.name ?? "",
    overview: text(s.summary),
    tagline: "",
    year: year(s.premiered) ? Number(year(s.premiered)) : null,
    rating: s.rating?.average ?? null,
    genres: s.genres ?? [],
    cast: people(s._embedded?.cast ?? []).slice(0, 8),
    language: s.language ?? "",
    poster: s.image?.original ?? s.image?.medium ?? "",
    backdrop: "",
    tmdb_id: null,
    id: null,
    url: s.url ?? "",
    imdb_url: s.externals?.imdb ? `https://www.imdb.com/title/${s.externals.imdb}/` : "",
    first_air_date: s.premiered ?? "",
    status: s.status ?? "",
    seasons: seasons.length || null,
    episodes: seasons.reduce((n, x) => n + (x.episodeOrder ?? 0), 0) || null,
    runtime: s.averageRuntime ?? null,
    creators: people((s._embedded?.crew ?? []).filter((c) => c.type === "Creator")),
    networks: channel ? [channel] : [],
  };
}
