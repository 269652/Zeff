import { getJson } from "./lib.mjs";

/**
 * Books at Open Library. A hit's id is the work's key (OL123W).
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event) {
  if (event.mode === "search") {
    const r = await getJson(`https://openlibrary.org/search.json?${new URLSearchParams({ q: event.query, limit: "8", fields: FIELDS })}`, "Open Library");
    return { hits: (r.docs ?? []).map((d) => ({ id: String(d.key ?? "").replace("/works/", ""), title: d.title ?? "", subtitle: [d.author_name?.slice(0, 2).join(", "), d.first_publish_year].filter(Boolean).join(" · "), image: cover(d.cover_i, "S") })) };
  }
  const hit = event.id;
  if (!/^OL\d+W$/.test(hit)) throw new Error("Not an Open Library work.");
  const [found, work] = await Promise.all([getJson(`https://openlibrary.org/search.json?${new URLSearchParams({ q: `key:/works/${hit}`, limit: "1", fields: FIELDS })}`, "Open Library"), getJson(`https://openlibrary.org/works/${hit}.json`, "Open Library")]);
  const d = found.docs?.[0] ?? {};
  return {
    fields: {
      title: d.title ?? "",
      authors: d.author_name ?? [],
      year: d.first_publish_year ?? null,
      pages: d.number_of_pages_median ?? null,
      subjects: (d.subject ?? []).slice(0, 8),
      description: typeof work.description === "string" ? work.description : (work.description?.value ?? ""),
      cover: cover(d.cover_i, "L"),
      url: `https://openlibrary.org/works/${hit}`,
    },
  };
}

const FIELDS = "key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median";
const cover = (id, size) => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : "");
