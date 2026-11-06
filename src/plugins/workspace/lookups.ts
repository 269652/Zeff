import "@/plugins/contributions";
import { t } from "@/lib/i18n/server";
import { workspaceLookups, type LookupHit, type LookupSource, type LookupValue } from "./lookup-point";
import { valuesToCells } from "./mcp-db";
import * as store from "./store";

/** What a view's <lookup> asks: the installed plugins' sources, a search, and the hit picked as a row. Server only. */

const MAX_HITS = 8;

export const lookupSources = (): LookupSource[] => workspaceLookups.list().flatMap((c) => c.impl);

function sourceOf(id: string): LookupSource {
  const all = lookupSources();
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(t("There is no lookup “{id}” — there are: {all}.", { id, all: all.map((x) => x.id).join(", ") || t("none") }));
  const missing = s.missing?.();
  if (missing) throw new Error(missing);
  return s;
}

export async function searchLookup(source: string, query: string, language: string): Promise<{ hits: LookupHit[]; credit: string }> {
  const s = sourceOf(source);
  const q = query.trim();
  if (q.length < 2) return { hits: [], credit: s.credit ?? "" };
  return { hits: (await s.search(q.slice(0, 200), language)).slice(0, MAX_HITS), credit: s.credit ?? "" };
}

/** A value as a property takes it: a list goes into a text as one line, a number into a text as text, and the other way round. */
function forProperty(type: string, v: LookupValue): unknown {
  if (type === "multi_select" || type === "person" || type === "relation") return v;
  const one = Array.isArray(v) ? v.join(", ") : v;
  if (type === "number") return typeof one === "number" ? one : Number(String(one).replace(",", ".")) || null;
  return typeof one === "number" ? String(one) : one;
}
const empty = (v: LookupValue | undefined) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type LookupAdd = { dbId: number; source: string; hit: string; language: string; /** [property, field], "title" being the row's title. */ map: [string, string][]; /** The property that tells a row is there already. */ unique?: string };

/** The hit picked, read in full, as a row: its fields into the properties of the map (a new option name makes the option). */
export async function addLookupRow(v: LookupAdd): Promise<{ id: number; title: string; existed: boolean; notes: string[] }> {
  const d = store.getDatabase(v.dbId);
  if (!d) throw new Error(t("The database is gone."));
  const s = sourceOf(v.source);
  // Before anything is read or made: a field the source hasn't would leave a half-empty row.
  const wrong = v.map.map(([, field]) => field).filter((f) => !(f in s.fields));
  if (wrong.length) throw new Error(t("{source} has no field “{field}” — it has: {all}.", { source: s.id, field: wrong[0], all: Object.keys(s.fields).join(", ") }));
  const data = await s.details(v.hit, v.language);
  const isTitle = (name: string) => name.toLowerCase() === "title" || name.toLowerCase() === d.schema.titleName.toLowerCase();
  const titleField = v.map.find(([prop]) => isTitle(prop))?.[1] ?? "title";
  const title = String(data[titleField] ?? data.title ?? "").trim();
  const values: Record<string, unknown> = {};
  for (const [prop, field] of v.map) {
    if (isTitle(prop) || empty(data[field])) continue;
    values[prop] = forProperty(d.schema.properties.find((p) => p.name.toLowerCase() === prop.toLowerCase())?.type ?? "text", data[field]);
  }
  const c = await valuesToCells(d.schema, values);
  // Asked for by name, and picked twice: the row that is there.
  if (v.unique) {
    const p = d.schema.properties.find((x) => x.name.toLowerCase() === v.unique!.toLowerCase());
    const rows = store.rowsOf(d.page.id)?.rows ?? [];
    const there = isTitle(v.unique) ? rows.find((r) => r.title.trim().toLowerCase() === title.toLowerCase()) : p && c.cells[p.id] != null ? rows.find((r) => same(r.cells[p.id], c.cells[p.id])) : undefined;
    if (there) return { id: there.id, title: there.title, existed: true, notes: [] };
  }
  if (c.schema !== d.schema) store.updateSchema(d.page.id, c.schema);
  return { id: store.addRow(d.page.id, { title, cells: c.cells }), title, existed: false, notes: c.notes };
}

/** The sources as the AI reads them, under the template language. */
export function lookupReference(): string {
  const all = lookupSources();
  if (!all.length) return "LOOKUP SOURCES: none installed (Menu → Plugins → Lookups).";
  return ["LOOKUP SOURCES (for <lookup source=…>; the map's fields are these):", ...all.map((s) => `- ${s.id} — ${s.what}${s.missing?.() ? ` NOT READY: ${s.missing()}` : ""} Fields: ${Object.entries(s.fields).map(([k, w]) => `${k} (${w})`).join(", ")}.`)].join("\n");
}
