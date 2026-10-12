/**
 * Checks a list of news feeds against the live internet and writes the ones that work as the stock catalog
 * (src/plugins/news/catalog-data.ts). Run it when feeds should be added or the list gone stale:
 *
 *   node --import tsx scripts/news-catalog.mts <candidates.txt>...      candidate lines: Category|Name|URL|lang
 *   node --import tsx scripts/news-catalog.mts --recheck                 checks the catalog as it is, drops the dead
 *   node --import tsx scripts/news-catalog.mts --add <candidates.txt>    checks only candidates not in the catalog yet and adds the working ones
 *
 * A feed is kept when it answers, parses and has at least 3 items, the newest not older than 120 days.
 */
import fs from "node:fs";
import path from "node:path";
import { parseFeed } from "../src/plugins/news/feed";

type Row = { category: string; name: string; url: string; lang: string };
const OUT = path.join(process.cwd(), "src", "plugins", "news", "catalog-data.ts");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function existing(): Promise<Row[]> {
  const { CATALOG } = await import("../src/plugins/news/catalog-data");
  return CATALOG.map((c) => ({ category: c.category, name: c.name, url: c.url, lang: c.lang }));
}

async function check(r: Row, tries = 2): Promise<{ ok: boolean; items: number; newest: string; why?: string }> {
  try {
    const res = await fetch(r.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!res.ok) return { ok: false, items: 0, newest: "", why: `HTTP ${res.status}` };
    const items = parseFeed((await res.text()).slice(0, 3_000_000));
    const newest = items[0]?.publishedAt ?? "";
    if (items.length < 3) return { ok: false, items: items.length, newest, why: `${items.length} items` };
    if (newest && Date.now() - Date.parse(newest) > 120 * 864e5) return { ok: false, items: items.length, newest, why: `newest ${newest.slice(0, 10)}` };
    return { ok: true, items: items.length, newest };
  } catch (e) {
    // A connection that failed is tried once more (a burst of requests makes some fail that work alone).
    if (tries > 1 && /fetch failed|timeout/i.test(e instanceof Error ? e.message : String(e))) {
      await new Promise((go) => setTimeout(go, 1500));
      return check(r, tries - 1);
    }
    return { ok: false, items: 0, newest: "", why: e instanceof Error ? e.message.slice(0, 60) : String(e) };
  }
}

const args = process.argv.slice(2);
const rows: Row[] = [];
if (args.includes("--recheck")) rows.push(...(await existing()));
for (const f of args.filter((a) => !a.startsWith("--"))) {
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const [category, name, url, lang] = line.split("|").map((x) => x?.trim());
    if (category && name && /^https?:\/\//.test(url ?? "")) rows.push({ category, name, url, lang: lang || "en" });
  }
}
const add = args.includes("--add");
const have = add ? await existing() : [];
const haveUrls = new Set(have.map((h) => h.url));
const unique = [...new Map(rows.map((r) => [r.url, r])).values()].filter((r) => !haveUrls.has(r.url));
console.log(`${unique.length} candidates …`);

const kept: (Row & { items: number })[] = have.map((h) => ({ ...h, items: 0 }));
const dropped: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < unique.length) {
      const r = unique[next++];
      const c = await check(r);
      if (c.ok) kept.push({ ...r, items: c.items });
      else dropped.push(`${r.name} — ${c.why}`);
    }
  }),
);
kept.sort((a, b) => a.category.localeCompare(b.category) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));

const q = (s: string) => JSON.stringify(s);
fs.writeFileSync(
  OUT,
  `/**
 * The stock catalog of news feeds — checked against the live feeds (scripts/news-catalog.mts), the dead ones left out.
 * Generated; add candidates with the script, don't edit by hand.
 */
export type CatalogFeed = { category: string; name: string; url: string; lang: string };

export const CATALOG: CatalogFeed[] = [
${kept.map((k) => `  { category: ${q(k.category)}, name: ${q(k.name)}, url: ${q(k.url)}, lang: ${q(k.lang)} },`).join("\n")}
];
`,
);
console.log(`${kept.length} kept, ${dropped.length} dropped`);
for (const d of dropped.sort()) console.log(`  ✗ ${d}`);
