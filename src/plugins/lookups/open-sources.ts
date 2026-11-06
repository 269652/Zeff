import { htmlToText, searchReady, webSearch } from "@/plugins/web-search/search";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import type { LookupSource } from "@/plugins/workspace/lookup-point";
import { getLookupConfig } from "./config";
import { getJson, language2, short, year } from "./http";

/** The other sources: Wikipedia and Open Library need nothing; Google's take the user's API key; web results come from Web search. */

// -- Wikipedia ------------------------------------------------------------------------------------------------------------------

type WikiPage = { key?: string; title?: string; description?: string; thumbnail?: { url?: string } };
type WikiSummary = { title?: string; description?: string; extract?: string; originalimage?: { source?: string }; thumbnail?: { source?: string }; content_urls?: { desktop?: { page?: string } } };

const wikipedia: LookupSource = {
  id: "wikipedia",
  label: "Wikipedia",
  what: "Articles of Wikipedia, in the user's language.",
  credit: "Text from Wikipedia, CC BY-SA.",
  fields: { title: "the article's title", description: "a line on what it is", summary: "its first paragraph", image: "the article's picture", url: "the article" },
  search: async (q, language) => {
    const lang = language2(language);
    const r = await getJson<{ pages?: WikiPage[] }>(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?${new URLSearchParams({ q, limit: "8" })}`, "Wikipedia");
    return (r.pages ?? []).map((p) => ({ id: `${lang}:${p.key}`, title: p.title ?? "", subtitle: short(p.description, 90), image: p.thumbnail?.url ? `https:${p.thumbnail.url}` : "" }));
  },
  details: async (hit) => {
    const m = /^([a-z]{2,3}):(.+)$/.exec(hit);
    if (!m) throw new Error("Not a Wikipedia article.");
    const d = await getJson<WikiSummary>(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(m[2])}`, "Wikipedia");
    return { title: d.title ?? "", description: d.description ?? "", summary: d.extract ?? "", image: d.originalimage?.source ?? d.thumbnail?.source ?? "", url: d.content_urls?.desktop?.page ?? "" };
  },
};

// -- Open Library ---------------------------------------------------------------------------------------------------------------

type OlDoc = { key?: string; title?: string; author_name?: string[]; first_publish_year?: number; cover_i?: number; subject?: string[]; number_of_pages_median?: number };
const OL_FIELDS = "key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median";
const cover = (id: number | undefined, size: string) => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : "");

const openLibrary: LookupSource = {
  id: "openlibrary",
  label: "Open Library",
  what: "Books at Open Library.",
  fields: { title: "the title", authors: "a list", year: "first published (a number)", pages: "a number", subjects: "a list", description: "what it is about", cover: "the cover's address", url: "its page" },
  search: async (q) => {
    const r = await getJson<{ docs?: OlDoc[] }>(`https://openlibrary.org/search.json?${new URLSearchParams({ q, limit: "8", fields: OL_FIELDS })}`, "Open Library");
    return (r.docs ?? []).map((d) => ({ id: String(d.key ?? "").replace("/works/", ""), title: d.title ?? "", subtitle: [d.author_name?.slice(0, 2).join(", "), d.first_publish_year].filter(Boolean).join(" · "), image: cover(d.cover_i, "S") }));
  },
  details: async (hit) => {
    if (!/^OL\d+W$/.test(hit)) throw new Error("Not an Open Library work.");
    const [found, work] = await Promise.all([getJson<{ docs?: OlDoc[] }>(`https://openlibrary.org/search.json?${new URLSearchParams({ q: `key:/works/${hit}`, limit: "1", fields: OL_FIELDS })}`, "Open Library"), getJson<{ description?: string | { value?: string } }>(`https://openlibrary.org/works/${hit}.json`, "Open Library")]);
    const d = found.docs?.[0] ?? {};
    return {
      title: d.title ?? "",
      authors: d.author_name ?? [],
      year: d.first_publish_year ?? null,
      pages: d.number_of_pages_median ?? null,
      subjects: (d.subject ?? []).slice(0, 8),
      description: typeof work.description === "string" ? work.description : (work.description?.value ?? ""),
      cover: cover(d.cover_i, "L"),
      url: `https://openlibrary.org/works/${hit}`,
    };
  },
};

// -- Google ---------------------------------------------------------------------------------------------------------------------

const googleKey = () => getLookupConfig().googleKey;
const withKey = (params: Record<string, string>) => new URLSearchParams({ ...params, ...(googleKey() ? { key: googleKey() } : {}) });
const needsGoogleKey = () => (googleKey() ? null : t("Add a Google API key under Settings → Lookups."));
const https = (u: unknown) => String(u ?? "").replace(/^http:/, "https:");

type Volume = { id?: string; volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; description?: string; pageCount?: number; categories?: string[]; language?: string; imageLinks?: { thumbnail?: string; smallThumbnail?: string }; canonicalVolumeLink?: string; industryIdentifiers?: { type?: string; identifier?: string }[] } };

const googleBooks: LookupSource = {
  id: "google.books",
  label: "Google Books",
  what: "Books at Google Books.",
  fields: { title: "the title", subtitle: "its subtitle", authors: "a list", publisher: "the publisher", date: "published, as given", year: "a number", pages: "a number", categories: "a list", language: "a code", description: "what it is about", isbn: "ISBN-13: a good `unique`", cover: "the cover's address", url: "its page" },
  // (Without a key Google's shared allowance is used up at once: a key is what makes it work.)
  missing: needsGoogleKey,
  search: async (q) => {
    const r = await getJson<{ items?: Volume[] }>(`https://www.googleapis.com/books/v1/volumes?${withKey({ q, maxResults: "8" })}`, "Google Books");
    return (r.items ?? []).map((v) => ({ id: String(v.id ?? ""), title: v.volumeInfo?.title ?? "", subtitle: [v.volumeInfo?.authors?.slice(0, 2).join(", "), year(v.volumeInfo?.publishedDate)].filter(Boolean).join(" · "), image: https(v.volumeInfo?.imageLinks?.smallThumbnail) }));
  },
  details: async (hit) => {
    if (!/^[\w-]+$/.test(hit)) throw new Error("Not a Google Books volume.");
    const v = (await getJson<Volume>(`https://www.googleapis.com/books/v1/volumes/${hit}?${withKey({})}`, "Google Books")).volumeInfo ?? {};
    return {
      title: v.title ?? "",
      subtitle: v.subtitle ?? "",
      authors: v.authors ?? [],
      publisher: v.publisher ?? "",
      date: v.publishedDate ?? "",
      year: year(v.publishedDate) ? Number(year(v.publishedDate)) : null,
      pages: v.pageCount ?? null,
      categories: v.categories ?? [],
      language: v.language ?? "",
      description: htmlToText(v.description ?? "").text,
      isbn: v.industryIdentifiers?.find((i) => i.type === "ISBN_13")?.identifier ?? "",
      cover: https(v.imageLinks?.thumbnail),
      url: https(v.canonicalVolumeLink),
    };
  },
};

type Entity = { result?: { "@id"?: string; name?: string; description?: string; image?: { contentUrl?: string }; detailedDescription?: { articleBody?: string; url?: string }; url?: string; "@type"?: string[] } };
const KG = "https://kgsearch.googleapis.com/v1/entities:search";

const googleKnowledge: LookupSource = {
  id: "google.knowledge",
  label: "Google Knowledge Graph",
  what: "People, places, works, organisations: what Google knows as a thing, not web pages.",
  fields: { title: "its name", description: "a line on what it is", detail: "a paragraph", types: "a list", image: "a picture's address", url: "its page" },
  missing: needsGoogleKey,
  search: async (q, language) => {
    const r = await getJson<{ itemListElement?: Entity[] }>(`${KG}?${withKey({ query: q, limit: "8", languages: language2(language) })}`, "Google Knowledge Graph");
    return (r.itemListElement ?? []).map(({ result: e }) => ({ id: String(e?.["@id"] ?? ""), title: e?.name ?? "", subtitle: short(e?.description ?? e?.detailedDescription?.articleBody, 90), image: e?.image?.contentUrl ?? "" }));
  },
  details: async (hit, language) => {
    const id = hit.replace(/^kg:/, "");
    if (!/^\/[\w/]+$/.test(id)) throw new Error("Not a Knowledge Graph entry.");
    const r = await getJson<{ itemListElement?: Entity[] }>(`${KG}?${withKey({ ids: id, languages: language2(language) })}`, "Google Knowledge Graph");
    const e = r.itemListElement?.[0]?.result;
    return { title: e?.name ?? "", description: e?.description ?? "", detail: e?.detailedDescription?.articleBody ?? "", types: (e?.["@type"] ?? []).filter((x) => x !== "Thing"), image: e?.image?.contentUrl ?? "", url: e?.detailedDescription?.url ?? e?.url ?? "" };
  },
};

// -- The web --------------------------------------------------------------------------------------------------------------------

/** Web search's results (Google or Brave, what is set there). A hit is complete as it comes, so it carries itself. */
const web: LookupSource = {
  id: "web.search",
  label: "Web search",
  what: "Pages of the web, through the Web search plugin.",
  fields: { title: "the page's title", snippet: "a few lines from it", url: "its address" },
  missing: () => (!isInstalled("web-search") ? t("Install the Web search plugin (Menu → Plugins).") : searchReady() ? null : t("Add the key under Settings → Web search.")),
  search: async (q, language) => (await webSearch(q, { count: 8, language: language2(language) })).map((h) => ({ id: JSON.stringify(h), title: h.title, subtitle: short(h.snippet, 90) })),
  details: async (hit) => {
    const h = JSON.parse(hit) as { title?: unknown; url?: unknown; snippet?: unknown };
    return { title: short(h.title, 300), snippet: short(h.snippet, 600), url: /^https?:\/\//.test(String(h.url)) ? String(h.url) : "" };
  },
};

export const OPEN_SOURCES: LookupSource[] = [wikipedia, openLibrary, googleBooks, googleKnowledge, web];
