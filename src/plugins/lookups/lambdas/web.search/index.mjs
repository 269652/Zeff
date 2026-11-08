import { language2, short } from "./lib.mjs";

/**
 * Pages and PDFs of the web, through Zeff's Web search (context.zeff.call). A hit carries itself (its id is the hit as JSON); picked,
 * the document behind it is read and its whole text becomes the row's page (_page) — a page that refuses leaves the snippet.
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event, context) {
  if (event.mode === "search") {
    const { hits } = await context.zeff.call("web.search", { query: event.query, count: 8, language: language2(event.language) });
    return { hits: hits.map((h) => ({ id: JSON.stringify(h), title: h.title, subtitle: short(h.snippet, 90) })) };
  }
  const h = JSON.parse(event.id);
  const url = /^https?:\/\//.test(String(h.url)) ? String(h.url) : "";
  const doc = url ? await context.zeff.call("web.read", { url, maxChars: 150000 }).catch(() => null) : null;
  return { fields: { title: short(h.title, 300), snippet: short(h.snippet, 600), url, _page: doc?.text ?? "" } };
}
