/**
 * One route per account: `http://localhost:9333/<slug>/…` is that account's Zeff, the unprefixed URLs are the first account's
 * ("default" — `/standard/…` is an alias of it). Google's OAuth clients take no wildcard subdomains, so the accounts can't each
 * have a host of their own (that still works, as a fallback: data/accounts.json `host`). This file is the pure part — no node:
 * imports — shared by the proxy (src/proxy.ts), the server (redirects) and the browser (src/components/account-nav.tsx).
 */

export const DEFAULT_ACCOUNT_ID = "default";
/** The first account's slug unless it has one of its own: `/standard/…` is the same as the unprefixed URL. */
export const DEFAULT_SLUG = "standard";
/** The request header the proxy sets to the prefix the request came under ("/privat", or "" — unprefixed). */
export const PREFIX_HEADER = "x-zeff-prefix";
/** The attribute on <html> that carries the page's prefix to the browser's own code (fetch, history, links). */
export const PREFIX_ATTR = "data-zeff-prefix";

export type RouteAccount = { id: string; slug?: string; host?: string };

/** A slug as it may be written: lower case letters, digits and dashes, not at either end, 1–40 long. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** The slug an account is reached under: its own, else its id (the first account: "standard"). */
export const slugOf = (a: RouteAccount): string => a.slug || (a.id === DEFAULT_ACCOUNT_ID ? DEFAULT_SLUG : a.id);

/** The slugs that name an account (each account's own, and the first account's aliases "standard" and "default"). */
export function slugMap(accounts: readonly RouteAccount[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of accounts) {
    const s = slugOf(a);
    if (SLUG_RE.test(s) && !m.has(s)) m.set(s, a.id);
  }
  for (const alias of [DEFAULT_SLUG, DEFAULT_ACCOUNT_ID]) if (!m.has(alias)) m.set(alias, DEFAULT_ACCOUNT_ID);
  return m;
}

/**
 * A path under an account's prefix: `/privat/workspace?x` → {account "privat", prefix "/privat", rest "/workspace"}. `/privat`
 * alone is its start page ("/"). Null: the first segment names no account.
 */
export function splitPrefix(pathname: string, slugs: Map<string, string>): { account: string; slug: string; prefix: string; rest: string } | null {
  const m = /^\/([^/?#]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const slug = decodeSafe(m[1]).toLowerCase();
  const account = slugs.get(slug);
  if (!account) return null;
  return { account, slug, prefix: `/${slug}`, rest: m[2] || "/" };
}

const decodeSafe = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The canonical prefix of an account: "" for the first one (its URLs are unprefixed), "/<slug>" for the others. */
export const prefixOf = (a: RouteAccount): string => (a.id === DEFAULT_ACCOUNT_ID ? "" : `/${slugOf(a)}`);

/** Paths that are never an account's: Next's own files. */
const NEVER = /^\/(_next|__nextjs)(\/|$)/;

/**
 * A root-relative href under a prefix ("/todos" → "/privat/todos"). Left alone: no prefix, anything not root-relative
 * (https://…, //host, #x, ?q, mailto:, relative), what is already under the prefix, Next's own files.
 */
export function withPrefix(prefix: string, href: string): string {
  if (!prefix || typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return href;
  if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`) || href.startsWith(`${prefix}#`)) return href;
  if (NEVER.test(href)) return href;
  return href === "/" ? `${prefix}/` : `${prefix}${href}`;
}

/** A pathname without its prefix ("/privat/todos" → "/todos", "/privat" → "/"). */
export function stripPrefix(prefix: string, pathname: string): string {
  if (!prefix || !pathname) return pathname;
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

/**
 * The safety net against landing in the wrong account: an unprefixed request whose Referer is a page of this origin under
 * another account's prefix (a link, a fetch, an EventSource we didn't prefix) belongs to that account. Null: no Referer, another
 * origin's, unprefixed, or the first account's prefix (unprefixed is the first account anyway).
 */
export function refererAccount(referer: string | null | undefined, host: string | null | undefined, slugs: Map<string, string>): { account: string; prefix: string } | null {
  if (!referer || !host) return null;
  let u: URL;
  try {
    u = new URL(referer);
  } catch {
    return null;
  }
  if (u.host.toLowerCase() !== host.toLowerCase()) return null;
  const hit = splitPrefix(u.pathname, slugs);
  if (!hit || hit.account === DEFAULT_ACCOUNT_ID) return null;
  return { account: hit.account, prefix: hit.prefix };
}

/**
 * A slug the user typed, checked: the pattern, not another account's, not a top-level route of Zeff (`reserved`: src/app's
 * segments, public/'s files, Next's own). The error's text, or null — it may be used.
 */
export function slugProblem(slug: string, opts: { reserved: ReadonlySet<string>; taken: ReadonlySet<string> }): "pattern" | "reserved" | "taken" | null {
  if (!SLUG_RE.test(slug)) return "pattern";
  if (opts.reserved.has(slug)) return "reserved";
  if (opts.taken.has(slug)) return "taken";
  return null;
}

/** Segments that are Zeff's whatever src/app has (Next's own, the OAuth callback's, the static files'). */
export const ALWAYS_RESERVED = ["_next", "__nextjs", "api", "favicon.ico", "manifest.webmanifest", "icon.svg", "apple-icon.png", "robots.txt", "sitemap.xml", "sw.js"];

/**
 * A relative path to come back to after a sign-in ("/settings/connections?x=1#a"), checked: same origin only — no scheme,
 * no "//host", no backslash tricks, no control characters. Null: not one.
 */
export function safeLocalPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string" || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  try {
    const u = new URL(value, "http://x.invalid");
    if (u.origin !== "http://x.invalid") return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** The path (and query) of a same-origin Referer, or null. */
export function refererPath(referer: string | null | undefined, host: string | null | undefined): string | null {
  if (!referer || !host) return null;
  try {
    const u = new URL(referer);
    if (u.host.toLowerCase() !== host.toLowerCase()) return null;
    return safeLocalPath(`${u.pathname}${u.search}`);
  } catch {
    return null;
  }
}
