import { getJson, language2, short } from "./lib.mjs";

/**
 * Google's Knowledge Graph: people, places, works, organisations — what Google knows as a thing, not web pages. Needs your Google API
 * key (Settings → Lookups, or the secret GOOGLE_KEY).
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event, context) {
  const key = context.secrets.GOOGLE_KEY ?? "";
  const withKey = (params) => new URLSearchParams({ ...params, ...(key ? { key } : {}) });
  if (event.mode === "search") {
    const r = await getJson(`${KG}?${withKey({ query: event.query, limit: "8", languages: language2(event.language) })}`, "Google Knowledge Graph");
    return { hits: (r.itemListElement ?? []).map(({ result: e }) => ({ id: String(e?.["@id"] ?? ""), title: e?.name ?? "", subtitle: short(e?.description ?? e?.detailedDescription?.articleBody, 90), image: e?.image?.contentUrl ?? "" })) };
  }
  const id = event.id.replace(/^kg:/, "");
  if (!/^\/[\w/]+$/.test(id)) throw new Error("Not a Knowledge Graph entry.");
  const r = await getJson(`${KG}?${withKey({ ids: id, languages: language2(event.language) })}`, "Google Knowledge Graph");
  const e = r.itemListElement?.[0]?.result;
  return { fields: { title: e?.name ?? "", description: e?.description ?? "", detail: e?.detailedDescription?.articleBody ?? "", types: (e?.["@type"] ?? []).filter((x) => x !== "Thing"), image: e?.image?.contentUrl ?? "", url: e?.detailedDescription?.url ?? e?.url ?? "" } };
}

const KG = "https://kgsearch.googleapis.com/v1/entities:search";
