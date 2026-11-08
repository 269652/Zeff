import type { JsonSchema, LambdaManifest } from "./types";

/**
 * What a lambda returns, checked: a lookup's hits (id, title, maybe subtitle and image) and fields (only those its manifest names; texts,
 * numbers, lists of texts), any other lambda's against the JSON schema of its manifest. The problems by where they are — the lambda's
 * result isn't used when there is one. Client-safe (the IDE checks a test run the same way).
 */

export type LookupHitOut = { id: string; title: string; subtitle?: string; image?: string };
export type Checked<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const kindOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** A lookup's search: { hits: [...] } (or the list itself). */
export function checkHits(out: unknown): Checked<LookupHitOut[]> {
  const list = Array.isArray(out) ? out : isObj(out) && Array.isArray(out.hits) ? out.hits : null;
  if (!list) return { ok: false, problems: [`a search returns { hits: [...] } — not ${kindOf(out)}${isObj(out) ? ` with ${Object.keys(out).join(", ") || "nothing"}` : ""}`] };
  const problems: string[] = [];
  const hits: LookupHitOut[] = [];
  list.slice(0, 50).forEach((h, i) => {
    if (!isObj(h)) return void problems.push(`hits[${i}]: an object { id, title, subtitle?, image? } — not ${kindOf(h)}`);
    const id = typeof h.id === "number" ? String(h.id) : h.id;
    if (typeof id !== "string" || !id) problems.push(`hits[${i}].id: a text or number (what details is called with)`);
    if (typeof h.title !== "string") problems.push(`hits[${i}].title: a text`);
    if (h.subtitle !== undefined && h.subtitle !== null && typeof h.subtitle !== "string") problems.push(`hits[${i}].subtitle: a text`);
    if (h.image !== undefined && h.image !== null && typeof h.image !== "string") problems.push(`hits[${i}].image: a text (an https address)`);
    if (typeof id === "string" && id && typeof h.title === "string")
      hits.push({ id, title: h.title, ...(typeof h.subtitle === "string" && h.subtitle ? { subtitle: h.subtitle } : {}), ...(typeof h.image === "string" && /^https:\/\//.test(h.image) ? { image: h.image } : {}) });
  });
  return problems.length ? { ok: false, problems } : { ok: true, value: hits };
}

export type FieldValue = string | number | string[] | null;

/** A lookup's details: { fields: {...} } (or the fields themselves) — only the manifest's, each a text, number, list of texts or null. */
export function checkFields(out: unknown, m: Pick<LambdaManifest, "fields">): Checked<Record<string, FieldValue>> {
  const fields = isObj(out) && isObj(out.fields) ? out.fields : isObj(out) ? out : null;
  if (!fields) return { ok: false, problems: [`details return { fields: {...} } — not ${kindOf(out)}`] };
  const known = new Set([...Object.keys(m.fields ?? {}), "_page"]);
  const problems: string[] = [];
  const value: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!known.has(k)) {
      problems.push(`fields.${k}: not in lambda.json's "fields" (${[...known].filter((x) => x !== "_page").join(", ")}) — add it there or leave it out`);
      continue;
    }
    if (v === null || v === undefined) value[k] = null;
    else if (typeof v === "string" || typeof v === "number") value[k] = v;
    else if (typeof v === "boolean") value[k] = v ? "yes" : "no";
    else if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) value[k] = v.map(String);
    else problems.push(`fields.${k}: a text, a number, a list of texts or null — not ${kindOf(v)}`);
  }
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

/** A value against a JSON schema (type, properties, required, items, enum, additionalProperties: false). */
export function checkSchema(v: unknown, s: JsonSchema, at = "output", problems: string[] = []): string[] {
  if (problems.length > 30) return problems;
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const k = kindOf(v);
    const fits = types.some((ty) => ty === k || (ty === "integer" && typeof v === "number" && Number.isInteger(v)));
    if (!fits) return (problems.push(`${at}: ${types.join(" or ")} — not ${k}`), problems);
  }
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) problems.push(`${at}: one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  if (isObj(v)) {
    for (const r of s.required ?? []) if (!(r in v)) problems.push(`${at}.${r}: required`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) checkSchema(v[k], sub, `${at}.${k}`, problems);
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in (s.properties ?? {}))) problems.push(`${at}.${k}: not in the schema`);
  }
  if (Array.isArray(v) && s.items) v.slice(0, 200).forEach((x, i) => checkSchema(x, s.items!, `${at}[${i}]`, problems));
  return problems;
}
