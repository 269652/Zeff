/**
 * Lambdas — functions in a Node.js runtime of their own, like AWS Lambda: a lambda is a few files (index.mjs exports `handler(event,
 * context)`), a manifest (lambda.json: what it is, what it may reach, what it returns) and npm dependencies. Each call runs in a fresh
 * Node process that reads only its own folder, writes nothing, starts no processes; its `fetch` goes through Zeff (to the domains the
 * manifest names, never a private address), and so do the Zeff functions it names (`context.zeff.call`). What it returns is checked:
 * a lookup lambda gives hits and fields as its manifest says, any other the JSON schema of its manifest. The definitions; client-safe.
 */

export type LambdaKind = "lookup" | "function";

/** A JSON schema, as far as a lambda's output is checked: type, properties, required, items, enum. */
export type JsonSchema = { type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null" | ("object" | "array" | "string" | "number" | "integer" | "boolean" | "null")[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: unknown[]; additionalProperties?: boolean; description?: string };

export type LambdaManifest = {
  /** How it is called ("tmdb.movies"): a lookup's source id, a flow's lambda.invoke name. */
  name: string;
  label: string;
  /** One line for the AI: what it does / finds. */
  what: string;
  kind: LambdaKind;
  /** A lookup's fields (what `details` gives): name → what it is. */
  fields?: Record<string, string>;
  /** A lookup that is slow or costs: searched only on Enter. */
  slow?: boolean;
  /** Shown with its results (a source's terms). */
  credit?: string;
  /** The secrets it reads (context.secrets): your Studio secrets, and TMDB_KEY / GOOGLE_KEY from Settings → Lookups. */
  secrets?: string[];
  /** Secrets it can't work without: missing, the source says so instead of searching. */
  requires?: string[];
  /** Domains its fetch may reach ("api.themoviedb.org", "*.wikipedia.org", "*" any public one). */
  web?: string[];
  /** Zeff functions it may call (context.zeff.call): "web.search", "web.read", "ai.extract" … (the flow actions). */
  zeff?: string[];
  /** npm packages: name → version range. Installed without their install scripts. */
  dependencies?: Record<string, string>;
  /** A function's output, checked (none: any JSON). */
  output?: JsonSchema;
  timeoutMs?: number;
  memoryMb?: number;
};

export type Lambda = { manifest: LambdaManifest; files: Record<string, string>; builtin: boolean; /** A built-in changed by you (reset gives back Zeff's). */ changed: boolean; updatedAt: string | null };

export const LAMBDA_NAME = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;
export const FILE_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(mjs|js|json|txt|md)$/;
const MAX_FILES = 30;
const MAX_SIZE = 400_000;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(str).filter(Boolean))] : []);
const record = (v: unknown): Record<string, string> => Object.fromEntries(Object.entries(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}).filter(([k]) => !!k.trim()).map(([k, x]) => [k.trim(), str(x)]));

/** A manifest as it can be (its name checked). Throws with what is wrong. */
export function normalizeManifest(raw: unknown): LambdaManifest {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = str(o.name).toLowerCase();
  if (!LAMBDA_NAME.test(name)) throw new Error(`lambda.json: "name" is lowercase letters, digits, - and _, parts joined by dots ("my.source") — not “${str(o.name)}”.`);
  const kind: LambdaKind = o.kind === "function" ? "function" : "lookup";
  const deps = record(o.dependencies);
  for (const [k, v] of Object.entries(deps)) if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(k) || !/^[\w.^~<>=|* -]+$/.test(v || "x")) throw new Error(`lambda.json: the dependency “${k}@${v}” isn't a package name and version range.`);
  const web = list(o.web).map((d) => d.toLowerCase());
  for (const d of web) if (d !== "*" && !/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error(`lambda.json: “${d}” in "web" is no domain.`);
  const fields = record(o.fields);
  if (kind === "lookup" && !Object.keys(fields).length) throw new Error('lambda.json: a lookup names its "fields" (name → what it is).');
  const n = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  return {
    name,
    label: str(o.label) || name,
    what: str(o.what),
    kind,
    ...(kind === "lookup" ? { fields } : {}),
    ...(o.slow === true ? { slow: true } : {}),
    ...(str(o.credit) ? { credit: str(o.credit) } : {}),
    ...(list(o.secrets).length ? { secrets: list(o.secrets) } : {}),
    ...(list(o.requires).length ? { requires: list(o.requires) } : {}),
    ...(web.length ? { web } : {}),
    ...(list(o.zeff).length ? { zeff: list(o.zeff) } : {}),
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    ...(o.output && typeof o.output === "object" ? { output: o.output as JsonSchema } : {}),
    timeoutMs: n(o.timeoutMs, 1000, 120000, 20000),
    memoryMb: n(o.memoryMb, 32, 1024, 128),
  };
}

/** A lambda's files as they can be: names checked, index.mjs there, not too many, not too big. */
export function normalizeFiles(raw: unknown): Record<string, string> {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "lambda.json" || k === "package.json") continue;
    if (!FILE_NAME.test(k)) throw new Error(`“${k}” isn't a file name a lambda can have (letters, digits, - _ . ending in .mjs, .js, .json, .txt, .md).`);
    if (typeof v !== "string") continue;
    out[k] = v;
  }
  if (!out["index.mjs"]) throw new Error("A lambda needs index.mjs (it exports handler).");
  if (Object.keys(out).length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files.`);
  if (Object.values(out).reduce((n, s) => n + s.length, 0) > MAX_SIZE) throw new Error("The files are too large together (400 KB).");
  return out;
}

/** What a new lambda starts with. */
export const STARTER = (name: string, kind: LambdaKind): { manifest: LambdaManifest; files: Record<string, string> } => ({
  manifest: normalizeManifest(kind === "lookup" ? { name, label: name, what: "What it finds, in one line.", kind, fields: { title: "the title", url: "its page" }, web: ["example.com"] } : { name, label: name, what: "What it does, in one line.", kind, output: { type: "object", properties: { result: { type: "string" } }, required: ["result"] } }),
  files: {
    "index.mjs":
      kind === "lookup"
        ? `/**
 * A lookup: search(query) gives a few hits, details(id) one hit's fields (those of lambda.json).
 * @param {LookupEvent} event
 * @param {LambdaContext} context
 * @returns {Promise<LookupResult>}
 */
export async function handler(event, context) {
  if (event.mode === "search") {
    const r = await fetch(\`https://example.com/search?q=\${encodeURIComponent(event.query)}\`);
    const data = await r.json();
    return { hits: data.items.slice(0, 8).map((x) => ({ id: String(x.id), title: x.title, subtitle: x.summary ?? "" })) };
  }
  const r = await fetch(\`https://example.com/items/\${encodeURIComponent(event.id)}\`);
  const x = await r.json();
  return { fields: { title: x.title, url: x.url } };
}
`
        : `/**
 * @param {Record<string, unknown>} event   what it is called with
 * @param {LambdaContext} context           secrets, log, zeff.call
 */
export async function handler(event, context) {
  context.log("called with", event);
  return { result: "Hello " + (event.name ?? "world") };
}
`,
  },
});
