import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * A web page read as text, for everything in Zeff that reads the web (the web.read flow action, lambdas, the Browser plugin, a row from
 * a URL, the Web search plugins): http(s) only, never the machine's own network or a private address — checked again on every redirect
 * —, HTML cleaned to text, PDFs read. A page's text is data: an AI steered by it must not reach Zeff's local pages or the router. Kernel
 * (docs/zeff-kernel.md: it moves the data), moved here from the Web search plugin. Server only.
 */

type Deps = { fetch?: typeof fetch; lookup?: (host: string) => Promise<string> };
const clean = (s: unknown, max: number) => String(s ?? "").replace(/s+/g, " ").trim().slice(0, max);

/** The same check for others that reach the web (the Browser plugin). */
export const publicUrl = (raw: string): Promise<URL> => checkUrl(raw, {});

/** Whether an address is the machine's own or a private network's (loopback, link-local, RFC 1918, carrier NAT, unique-local …). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? (isIP(ip) === 4 ? ip : null);
  if (v4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || /^fe[89ab]/.test(v6);
}

const resolve = async (host: string): Promise<string> => (await dnsLookup(host)).address;

/** A URL checked for a fetch: http(s) only, no local names, and the address it resolves to is a public one. The URL. */
async function checkUrl(raw: string, deps: Deps): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages can be read.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) throw new Error(`${host}: not allowed (the machine's own network).`);
  const ip = isIP(host) ? host : await (deps.lookup ?? resolve)(host);
  if (isPrivateAddress(ip)) throw new Error(`${host}: not allowed (a private address).`);
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML as readable text: no scripts, styles, navigation; blocks on their own lines; entities decoded. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|table|ul|ol|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10) || 32) : (ENTITIES[e.toLowerCase()] ?? m)))
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

/** A page read as text — at most `maxChars`; redirects followed (each hop checked), 2 MB read at most. */
export async function webFetch(raw: string, deps: Deps & { maxChars?: number } = {}): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
  const f = deps.fetch ?? fetch;
  let url = await checkUrl(raw, deps);
  for (let hop = 0; hop < 5; hop++) {
    const r = await f(url.toString(), { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; Zeff)", accept: "text/html, text/plain, application/json, */*;q=0.5" }, signal: AbortSignal.timeout(20000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = await checkUrl(new URL(r.headers.get("location")!, url).toString(), deps);
      continue;
    }
    if (!r.ok) throw new Error(`${url.hostname}: ${r.status}`);
    const type = (r.headers.get("content-type") ?? "").toLowerCase();
    if (/application\/pdf/.test(type) || (type.startsWith("application/octet-stream") && /\.pdf$/i.test(url.pathname))) {
      const { pdfText } = await import("@/plugins/documents/extract");
      const pdf = pdfText(Buffer.from(await r.arrayBuffer()));
      if (!pdf.trim()) throw new Error(`${url.hostname}: a PDF without readable text (a scan?).`);
      const max = deps.maxChars ?? 20000;
      return { url: url.toString(), title: decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/\.pdf$/i, ""), text: pdf.slice(0, max), truncated: pdf.length > max };
    }
    if (type && !/^(text\/|application\/(json|xml|xhtml|ld\+json|rss|atom))/.test(type)) throw new Error(`${url.hostname}: that isn't text (${type.split(";")[0]}).`);
    const body = (await r.text()).slice(0, 2_000_000);
    const page = /html|xml/.test(type) || /^\s*</.test(body) ? htmlToText(body) : { title: "", text: body.trim() };
    const max = deps.maxChars ?? 20000;
    return { url: url.toString(), title: page.title, text: page.text.slice(0, max), truncated: page.text.length > max };
  }
  throw new Error("Too many redirects.");
}
