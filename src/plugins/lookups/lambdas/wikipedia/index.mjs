import { getJson, language2, short } from "./lib.mjs";

/**
 * Articles of Wikipedia, in the user's language. A hit's id is "<lang>:<key>".
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event) {
  if (event.mode === "search") {
    const lang = language2(event.language);
    const r = await getJson(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?${new URLSearchParams({ q: event.query, limit: "8" })}`, "Wikipedia");
    return { hits: (r.pages ?? []).map((p) => ({ id: `${lang}:${p.key}`, title: p.title ?? "", subtitle: short(p.description, 90), image: p.thumbnail?.url ? `https:${p.thumbnail.url}` : "" })) };
  }
  const m = /^([a-z]{2,3}):(.+)$/.exec(event.id);
  if (!m) throw new Error("Not a Wikipedia article.");
  const d = await getJson(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(m[2])}`, "Wikipedia");
  return { fields: { title: d.title ?? "", description: d.description ?? "", summary: d.extract ?? "", image: d.originalimage?.source ?? d.thumbnail?.source ?? "", url: d.content_urls?.desktop?.page ?? "" } };
}
