import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, FIRST_ACCOUNT, ZEFF_DIR } from "./db";

/**
 * Reading Confluence: its REST API (Server / Data Center with a personal token, or Cloud with
 * user + API token) — the settings as mcp-atlassian has them, from Zeff's .env (CONFLUENCE_URL,
 * CONFLUENCE_PERSONAL_TOKEN | CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN). Or a folder of exported
 * pages. Each page as plain text with its headings, ready to cut into chunks.
 */

export type RawPage = { id: string; space: string; title: string; url: string; version: number; updatedAt: string | null; author: string | null; body: string };

/**
 * The Confluence settings — the first account's knowledge server: the server's env, else Zeff's
 * .env (as mcp-atlassian has them). Another account's (KNOWLEDGE_ACCOUNT) only its own: a .env in
 * its data folder — never the first account's company Confluence.
 */
function env(name: string): string | undefined {
  if (FIRST_ACCOUNT && process.env[name]) return process.env[name];
  try {
    const line = fs
      .readFileSync(path.join(FIRST_ACCOUNT ? ZEFF_DIR : DATA_DIR, ".env"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

export function confluenceConfig(): { base: string; headers: Record<string, string> } | null {
  const base = env("CONFLUENCE_URL")?.replace(/\/+$/, "");
  if (!base) return null;
  const pat = env("CONFLUENCE_PERSONAL_TOKEN");
  const user = env("CONFLUENCE_USERNAME");
  const key = env("CONFLUENCE_API_TOKEN");
  const auth = pat ? `Bearer ${pat}` : user && key ? `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}` : null;
  if (!auth) return null;
  return { base, headers: { Authorization: auth, Accept: "application/json" } };
}

/** Where Confluence is (no secrets): for the status page. */
export const confluenceWhere = () => env("CONFLUENCE_URL")?.replace(/\/+$/, "") ?? null;

async function get<T>(url: string, headers: Record<string, string>): Promise<T> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  if (r.status === 401 || r.status === 403) throw new Error(`Confluence: not signed in (${r.status}) — check the token in Zeff's .env.`);
  if (!r.ok) throw new Error(`Confluence ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

/** How pages are turned into text — a new one reads every page again (sync), even unchanged ones. */
export const PARSER_VERSION = 3;

const escapeTags = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Confluence's storage format (XHTML) as text: headings as "## ", list items as "- ", table cells
 * apart; what code and no-format boxes hold (CDATA) as it is; links with where they go.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t: string) => `\n${escapeTags(t)}\n`)
    .replace(/<ri:url\s+ri:value="([^"]+)"[^>]*\/?>/gi, " $1 ")
    .replace(/<ri:page\s+[^>]*ri:content-title="([^"]+)"[^>]*\/?>/gi, " $1 ")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return !t || t === href ? ` ${href} ` : `${t} (${href})`;
    })
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, "")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n) + 1 > 6 ? 6 : Number(n) + 1)} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|ul|ol|table|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ContentList = {
  results: { id: string; title: string; space?: { key: string }; version?: { number: number; when?: string; by?: { displayName?: string } }; body?: { storage?: { value: string } }; _links?: { webui?: string } }[];
  size: number;
  _links?: { next?: string };
};

/** The spaces to read: those set, else every (global) space the token can see. */
async function spaceKeys(base: string, headers: Record<string, string>, wanted: string[]): Promise<string[]> {
  if (wanted.length) return wanted;
  const out: string[] = [];
  for (let start = 0; start < 5000; start += 100) {
    const r = await get<{ results: { key: string; type?: string }[]; size: number }>(`${base}/rest/api/space?limit=100&start=${start}&type=global`, headers);
    out.push(...r.results.map((s) => s.key));
    if (r.size < 100) break;
  }
  return out;
}

/**
 * The pages of the spaces, newest first — each with its version (only changed ones need reading
 * again: `known` has the versions read before; those come without a body).
 */
export async function* confluencePages(spaces: string[], maxPages: number, known: Map<string, number>): AsyncGenerator<RawPage | { id: string; unchanged: true }> {
  const cfg = confluenceConfig();
  if (!cfg) throw new Error("Confluence isn't set up: CONFLUENCE_URL and CONFLUENCE_PERSONAL_TOKEN (or CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN) in Zeff's .env.");
  for (const space of await spaceKeys(cfg.base, cfg.headers, spaces)) {
    let n = 0;
    for (let start = 0; n < maxPages; start += 50) {
      // The list with versions only; a body only where the version is new.
      const list = await get<ContentList>(`${cfg.base}/rest/api/content?spaceKey=${encodeURIComponent(space)}&type=page&status=current&limit=50&start=${start}&expand=version,space`, cfg.headers);
      for (const p of list.results) {
        if (++n > maxPages) break;
        const version = p.version?.number ?? 0;
        if (known.get(p.id) === version) {
          yield { id: p.id, unchanged: true };
          continue;
        }
        const full = await get<ContentList["results"][number]>(`${cfg.base}/rest/api/content/${p.id}?expand=body.storage,version,space`, cfg.headers);
        yield {
          id: p.id,
          space: full.space?.key ?? space,
          title: full.title,
          url: full._links?.webui ? `${cfg.base}${full._links.webui}` : `${cfg.base}/pages/viewpage.action?pageId=${p.id}`,
          version,
          updatedAt: full.version?.when ?? null,
          author: full.version?.by?.displayName ?? null,
          body: htmlToText(full.body?.storage?.value ?? ""),
        };
      }
      if (list.size < 50) break;
    }
  }
}

/**
 * A folder of exported pages: *.json ({ id, title, space, url, version, updatedAt, body | html }),
 * *.md / *.txt (the title from the first heading or the file name), *.html. Sub-folders are spaces.
 */
export function folderPages(dir: string): RawPage[] {
  const out: RawPage[] = [];
  const walk = (d: string, space: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(f, space || e.name);
        continue;
      }
      const st = fs.statSync(f);
      const version = Math.floor(st.mtimeMs / 1000);
      const id = `file:${path.relative(dir, f).replace(/\\/g, "/")}`;
      const text = fs.readFileSync(f, "utf8");
      if (/\.json$/i.test(e.name)) {
        try {
          const list = JSON.parse(text) as unknown;
          for (const p of (Array.isArray(list) ? list : [list]) as Record<string, unknown>[]) {
            if (!p?.title) continue;
            out.push({
              id: String(p.id ?? `${id}#${p.title}`),
              space: String(p.space ?? space ?? ""),
              title: String(p.title),
              url: String(p.url ?? ""),
              version: Number(p.version) || version,
              updatedAt: p.updatedAt ? String(p.updatedAt) : st.mtime.toISOString(),
              author: p.author ? String(p.author) : null,
              body: p.body ? String(p.body) : htmlToText(String(p.html ?? "")),
            });
          }
        } catch {
          // not a page export
        }
      } else if (/\.(md|txt|html?)$/i.test(e.name)) {
        const body = /\.html?$/i.test(e.name) ? htmlToText(text) : text;
        const title = /^#+\s+(.+)$/m.exec(body)?.[1]?.trim() ?? e.name.replace(/\.\w+$/, "");
        out.push({ id, space, title, url: "", version, updatedAt: st.mtime.toISOString(), author: null, body });
      }
    }
  };
  walk(dir, "");
  return out;
}
