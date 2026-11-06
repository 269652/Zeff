import { t } from "@/lib/i18n/server";
import type { LookupSource, LookupValue } from "@/plugins/workspace/lookup-point";
import { getLookupConfig } from "./config";
import { getJson, language2, short, year } from "./http";

/** Films and series at TMDB, through its API, with the user's own key (its terms: no shared key, the credit shown, pictures linked). */

export const TMDB_CREDIT = "This product uses the TMDB API but is not endorsed or certified by TMDB.";
const API = "https://api.themoviedb.org/3";
const image = (path: unknown, size: string) => (typeof path === "string" && path ? `https://image.tmdb.org/t/p/${size}${path}` : "");
const names = (list: unknown, max = 20): string[] => (Array.isArray(list) ? list : []).map((x: { name?: string }) => String(x?.name ?? "")).filter(Boolean).slice(0, max);

/** A v3 key goes into the address, a v4 token into the header: TMDB hands out both. */
async function tmdb<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = getLookupConfig().tmdbKey;
  const v3 = /^[0-9a-f]{32}$/i.test(key);
  const query = new URLSearchParams({ ...params, ...(v3 ? { api_key: key } : {}) });
  return getJson<T>(`${API}${path}?${query}`, "TMDB", v3 ? {} : { Authorization: `Bearer ${key}` });
}

type Found = { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; overview?: string; poster_path?: string };
type Common = Found & {
  original_title?: string;
  original_name?: string;
  original_language?: string;
  tagline?: string;
  vote_average?: number;
  backdrop_path?: string;
  genres?: { name?: string }[];
  credits?: { cast?: { name?: string }[]; crew?: { name?: string; job?: string }[] };
  external_ids?: { imdb_id?: string };
  production_countries?: { name?: string }[];
  runtime?: number;
  episode_run_time?: number[];
  status?: string;
  created_by?: { name?: string }[];
  networks?: { name?: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
};

const COMMON_FIELDS = {
  title: "the title in the language asked for",
  original_title: "the original title",
  overview: "what it is about",
  tagline: "its tagline",
  year: "the year it came out (a number)",
  rating: "TMDB's rating, 0–10 (a number)",
  genres: "a list",
  cast: "the first actors, a list",
  language: "the original language, a code",
  poster: "the poster's address (w500)",
  backdrop: "a wide picture's address",
  tmdb_id: "TMDB's id: a good `unique`",
  url: "its page at TMDB",
  imdb_url: "its page at IMDb",
};

function source(kind: "movie" | "tv", id: string, label: string, what: string, own: Record<string, string>, fill: (d: Common) => Record<string, LookupValue>): LookupSource {
  return {
    id,
    label,
    what,
    credit: TMDB_CREDIT,
    fields: { ...COMMON_FIELDS, ...own },
    missing: () => (getLookupConfig().tmdbKey ? null : t("Add your TMDB API key under Settings → Lookups.")),
    search: async (q, language) => {
      const r = await tmdb<{ results?: Found[] }>(`/search/${kind}`, { query: q, language, include_adult: "false" });
      return (r.results ?? []).map((x) => ({
        id: String(x.id),
        title: x.title ?? x.name ?? "",
        subtitle: [year(x.release_date ?? x.first_air_date), short(x.overview, 90)].filter(Boolean).join(" · "),
        image: image(x.poster_path, "w92"),
      }));
    },
    details: async (hit, language) => {
      if (!/^\d+$/.test(hit)) throw new Error("Not a TMDB id.");
      const d = await tmdb<Common>(`/${kind}/${hit}`, { language, append_to_response: "credits,external_ids" });
      const imdb = d.external_ids?.imdb_id;
      return {
        title: d.title ?? d.name ?? "",
        original_title: d.original_title ?? d.original_name ?? "",
        overview: d.overview ?? "",
        tagline: d.tagline ?? "",
        year: year(d.release_date ?? d.first_air_date) ? Number(year(d.release_date ?? d.first_air_date)) : null,
        rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
        genres: names(d.genres),
        cast: names(d.credits?.cast, 8),
        language: d.original_language ?? "",
        poster: image(d.poster_path, "w500"),
        backdrop: image(d.backdrop_path, "w1280"),
        tmdb_id: d.id,
        url: `https://www.themoviedb.org/${kind}/${d.id}?language=${language2(language)}`,
        imdb_url: imdb ? `https://www.imdb.com/title/${imdb}/` : "",
        ...fill(d),
      };
    },
  };
}

export const TMDB_SOURCES: LookupSource[] = [
  source("movie", "tmdb.movies", "TMDB: films", "Films at The Movie Database.", { release_date: "YYYY-MM-DD", runtime: "minutes (a number)", director: "a list", countries: "a list" }, (d) => ({
    release_date: d.release_date ?? "",
    runtime: d.runtime || null,
    director: (d.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name ?? "").filter(Boolean),
    countries: names(d.production_countries),
  })),
  source("tv", "tmdb.tv", "TMDB: series", "TV series at The Movie Database.", { first_air_date: "YYYY-MM-DD", status: "running or ended, in words", seasons: "a number", episodes: "a number", runtime: "an episode's minutes (a number)", creators: "a list", networks: "a list" }, (d) => ({
    first_air_date: d.first_air_date ?? "",
    status: d.status ?? "",
    seasons: d.number_of_seasons ?? null,
    episodes: d.number_of_episodes ?? null,
    runtime: d.episode_run_time?.[0] ?? null,
    creators: names(d.created_by),
    networks: names(d.networks),
  })),
];
