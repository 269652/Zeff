/**
 * What the Studio's IDE tells its editor about lambdas: the types of `event`, `context` and what a handler returns (completion and
 * checking in index.mjs, through JSDoc), and the schema of lambda.json (completion and checking of the manifest). Client-safe.
 */

export const LAMBDA_DTS = `
/** A lookup lambda's event: a search for what was typed, or a hit's details by its id. */
type LookupEvent =
  | { mode: "search"; /** What was typed. */ query: string; /** "de-DE" */ language: string }
  | { mode: "details"; /** A hit's id, as the search gave it. */ id: string; language: string };

/** A hit of a search: what the suggestion list shows. */
interface LookupHit {
  /** What details is called with. */
  id: string | number;
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** A small picture (https). */
  image?: string;
}

/** A field's value: a text, a number, a list of texts, or null. */
type LookupFieldValue = string | number | boolean | null | (string | number)[];

/** What a lookup returns: hits for a search, the fields (those of lambda.json; _page: text for the row's page) for details. */
type LookupResult = { hits: LookupHit[] } | { fields: Record<string, LookupFieldValue> & { _page?: string } };

/** What a lambda is given beside its event. */
interface LambdaContext {
  /** Its name ("tmdb.movies"). */
  name: string;
  /** The secrets lambda.json names in "secrets": your Studio secrets, TMDB_KEY / GOOGLE_KEY from Settings → Lookups. */
  secrets: Readonly<Record<string, string>>;
  /** A line in the run's log (console.log does the same). */
  log(...args: unknown[]): void;
  /** When it is stopped (ms since 1970). */
  deadline: number;
  /** How many ms are left. */
  remainingMs(): number;
  zeff: {
    /**
     * A Zeff function lambda.json names in "zeff" — one that changes nothing: "web.search" ({ query, count?, site?, language? } →
     * { hits: [{ title, url, snippet }] }), "web.read" ({ url, maxChars? } → { url, title, text }), "lookup.search", "lookup.details",
     * "extract.css", "extract.regex", "ai.extract", "ai.ask", "ai.classify", "db.query", "db.get", "time.now" …
     */
    call<T = any>(name: string, input?: Record<string, unknown>): Promise<T>;
  };
}

/** A lambda's handler: export async function handler(event, context) { … }. */
type LambdaHandler<E = any, R = any> = (event: E, context: LambdaContext) => R | Promise<R>;
`;

export const LAMBDA_SCHEMA = {
  type: "object",
  required: ["name", "label", "kind"],
  properties: {
    name: { type: "string", pattern: "^[a-z][a-z0-9_-]*(\\.[a-z0-9_-]+)*$", description: "How it is called: a lookup's source id (<lookup source=…>), a flow's lambda.invoke name." },
    label: { type: "string", description: "Its name as shown." },
    what: { type: "string", description: "One line for the AI: what it does / finds." },
    kind: { enum: ["lookup", "function"], description: "lookup: search(query) → { hits }, details(id) → { fields }. function: any event → output (checked against `output`)." },
    fields: { type: "object", additionalProperties: { type: "string" }, description: "A lookup's fields: name → what it is (details may return only these, and _page)." },
    slow: { type: "boolean", description: "Slow or costly: a view searches it only on Enter." },
    credit: { type: "string", description: "Shown with its results (a source's terms)." },
    secrets: { type: "array", items: { type: "string", pattern: "^[A-Z][A-Z0-9_]+$" }, description: "The secrets it reads (context.secrets)." },
    requires: { type: "array", items: { type: "string" }, description: "Secrets it can't work without: missing, it says so instead of running." },
    web: { type: "array", items: { type: "string" }, description: 'Domains its fetch may reach: "api.example.com" (and its subdomains), "*.example.com", "*" (any public address). Never a private network.' },
    zeff: { type: "array", items: { type: "string", enum: ["web.search", "web.read", "web.html", "lookup.search", "lookup.details", "extract.css", "extract.regex", "ai.extract", "ai.ask", "ai.classify", "db.query", "db.get", "time.now", "lambda.invoke"] }, description: "Zeff functions it may call (context.zeff.call) — only ones that change nothing." },
    dependencies: { type: "object", additionalProperties: { type: "string" }, description: 'npm packages: "name": "^1.2.3". Installed without their install scripts; fetch-based ones work (sockets are closed).' },
    output: { type: "object", description: "A function's output as a JSON schema (type, properties, required, items, enum)." },
    timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, description: "Stopped after this long (default 20000)." },
    memoryMb: { type: "integer", minimum: 32, maximum: 1024, description: "Its memory (default 128)." },
  },
  additionalProperties: false,
};
