import type { LookupHit, LookupSource, LookupValue } from "../lookup-point";
import { runFlow } from "./engine";
import { listFlows } from "./store";

/**
 * Web recipes: a flow that is a lookup source (its `lookup`) — a <lookup> in a view searches it like TMDB or Wikipedia, and
 * lookup.search finds it too ("flow.<name>"). The flow is called with input.mode "search" (input.query, input.language) and gives
 * hits ([{ id, title, subtitle, image }] or { hits: […] }); with mode "details" (input.id) it gives the hit's fields. So any site
 * or API — IMDb ratings, a shop's prices, a library's catalogue — becomes a source in a few nodes: a request, what to pick out of
 * it, and the AI where a page has no structure. Server only.
 */

const asHits = (out: unknown): LookupHit[] => {
  const list = Array.isArray(out) ? out : out && typeof out === "object" && Array.isArray((out as { hits?: unknown }).hits) ? (out as { hits: unknown[] }).hits : [];
  return list.flatMap((h): LookupHit[] => {
    const o = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
    const id = o.id ?? o.url ?? o.title;
    return id !== undefined && id !== null && o.title ? [{ id: String(id), title: String(o.title), ...(o.subtitle ? { subtitle: String(o.subtitle) } : {}), ...(typeof o.image === "string" && /^https:\/\//.test(o.image) ? { image: o.image } : {}) }] : [];
  });
};

const asFields = (out: unknown): Record<string, LookupValue> =>
  Object.fromEntries(
    Object.entries(out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : {}).map(([k, v]) => [k, v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" ? v : Array.isArray(v) ? v.map(String) : typeof v === "boolean" ? (v ? "yes" : "no") : JSON.stringify(v)]),
  );

/** The flows that are lookup sources. */
export function flowLookupSources(): LookupSource[] {
  return listFlows()
    .filter((f) => f.lookup && f.enabled !== false)
    .map((f) => ({
      id: `flow.${f.name}`,
      label: f.lookup!.label,
      what: f.lookup!.what || f.description || f.lookup!.label,
      fields: f.lookup!.fields,
      ...(f.lookup!.slow ? { slow: true } : {}),
      search: async (query, language) => {
        const r = await runFlow(f, { mode: "search", query, language }, { trigger: { kind: "lookup" } });
        if (r.status === "failed") throw new Error(r.error ?? "The recipe failed.");
        return asHits(r.output);
      },
      details: async (id, language) => {
        const r = await runFlow(f, { mode: "details", id, language }, { trigger: { kind: "lookup" } });
        if (r.status === "failed") throw new Error(r.error ?? "The recipe failed.");
        return asFields(r.output);
      },
    }));
}
