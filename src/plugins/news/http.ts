import { decodeBody } from "./feed";

/** How Zeff introduces itself to feeds, searches and publishers' feed pages. */
export const NEWS_UA = "Mozilla/5.0 (compatible; Zeff/1.0)";
/** For article pages: some publishers turn away anything that doesn't look like a browser. */
export const NEWS_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type NewsFetchOptions = {
  /** Default 15 s. */
  timeoutMs?: number;
  /** Added to (and overriding) the user-agent. */
  headers?: Record<string, string>;
  /** Default NEWS_UA. */
  ua?: string;
  method?: string;
  body?: string;
};

/** fetch with our user-agent and a time limit (follows redirects); the response as it comes, status unchecked. */
export function newsFetch(url: string, o: NewsFetchOptions = {}): Promise<Response> {
  return fetch(url, { method: o.method ?? "GET", body: o.body, headers: { "user-agent": o.ua ?? NEWS_UA, ...(o.headers ?? {}) }, signal: AbortSignal.timeout(o.timeoutMs ?? 15000), redirect: "follow" });
}

/** A page as text (decoded by its charset, at most maxBytes read): throws "HTTP <status>" when it isn't ok. */
export async function fetchText(url: string, o: NewsFetchOptions & { maxBytes?: number } = {}): Promise<{ text: string; url: string; type: string }> {
  const r = await newsFetch(url, o);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { text: await decodeBody(r, o.maxBytes), url: r.url, type: r.headers.get("content-type") ?? "" };
}
