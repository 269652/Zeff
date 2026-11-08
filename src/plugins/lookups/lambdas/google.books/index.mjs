import { getJson, plain, year } from "./lib.mjs";

/**
 * Books at Google Books, with your Google API key (Settings → Lookups, or the secret GOOGLE_KEY) — without one Google's shared allowance
 * is used up at once.
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event, context) {
  const key = context.secrets.GOOGLE_KEY ?? "";
  const withKey = (params) => new URLSearchParams({ ...params, ...(key ? { key } : {}) });
  if (event.mode === "search") {
    const r = await getJson(`https://www.googleapis.com/books/v1/volumes?${withKey({ q: event.query, maxResults: "8" })}`, "Google Books");
    return { hits: (r.items ?? []).map((v) => ({ id: String(v.id ?? ""), title: v.volumeInfo?.title ?? "", subtitle: [v.volumeInfo?.authors?.slice(0, 2).join(", "), year(v.volumeInfo?.publishedDate)].filter(Boolean).join(" · "), image: https(v.volumeInfo?.imageLinks?.smallThumbnail) })) };
  }
  if (!/^[\w-]+$/.test(event.id)) throw new Error("Not a Google Books volume.");
  const v = (await getJson(`https://www.googleapis.com/books/v1/volumes/${event.id}?${withKey({})}`, "Google Books")).volumeInfo ?? {};
  return {
    fields: {
      title: v.title ?? "",
      subtitle: v.subtitle ?? "",
      authors: v.authors ?? [],
      publisher: v.publisher ?? "",
      date: v.publishedDate ?? "",
      year: year(v.publishedDate) ? Number(year(v.publishedDate)) : null,
      pages: v.pageCount ?? null,
      categories: v.categories ?? [],
      language: v.language ?? "",
      description: plain(v.description ?? ""),
      isbn: v.industryIdentifiers?.find((i) => i.type === "ISBN_13")?.identifier ?? "",
      cover: https(v.imageLinks?.thumbnail),
      url: https(v.canonicalVolumeLink),
    },
  };
}

const https = (u) => String(u ?? "").replace(/^http:/, "https:");
