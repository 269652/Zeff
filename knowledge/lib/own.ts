import { compileSoon } from "./compile";
import { htmlToText } from "./confluence";
import { db } from "./db";
import { removePage, storePage } from "./ingest";

/**
 * Your own knowledge: what you add yourself — a note, a fact, a link (the page behind it read) —
 * by hand here, from Zeff (its Chat tab, an agent's add_knowledge). Pages like the sources' ones
 * ("own:<id>", in the space "Eigenes Wissen"), compiled into the graph the same way, but no source
 * delivers them: a sync never removes them (ingest.ts); only you change or delete them.
 */

export const OWN_SPACE = "Eigenes Wissen";
export const OWN_PREFIX = "own:";
export const isOwn = (id: string) => id.startsWith(OWN_PREFIX);

export type OwnEntry = { id: string; title: string; text: string; url: string; updatedAt: string | null; compiled: boolean; summary: string | null; entities: number };
export type OwnInput = { title?: string; text?: string; url?: string };

const URL_ONLY = /^\s*(https?:\/\/\S+)\s*$/i;
const MAX_TEXT = 200_000;

/** A web page's title and text (HTML as text; plain text as it is). */
async function readUrl(url: string): Promise<{ title: string; text: string }> {
  let r: Response;
  try {
    r = await fetch(url, { headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.5", "user-agent": "Mozilla/5.0 (Zeff Knowledge)" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error(`The link doesn't answer: ${url}`);
  }
  if (!r.ok) throw new Error(`The link answers with ${r.status}: ${url}`);
  const type = r.headers.get("content-type") ?? "";
  const raw = (await r.text()).slice(0, MAX_TEXT * 4);
  if (/text\/plain|markdown/i.test(type)) return { title: "", text: raw.slice(0, MAX_TEXT) };
  if (!/html|xml/i.test(type)) throw new Error(`Only web pages and text can be read (${type || "unknown type"}).`);
  const title = htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "").replace(/\s+/g, " ").trim();
  // The page's main part when it says which (article / main), else its body — navigation and footers out.
  const main = /<(article|main)[\s>][\s\S]*?<\/\1>/i.exec(raw)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(raw)?.[0] ?? raw;
  const text = htmlToText(main.replace(/<(nav|header|footer|aside|form|noscript|svg)[\s>][\s\S]*?<\/\1>/gi, "")).slice(0, MAX_TEXT);
  if (!text.trim()) throw new Error(`There's no readable text on the page: ${url}`);
  return { title, text };
}

/** Title, text and link as stored: a text that is only a link is that link, read; no title — the text's first line. */
async function prepare(v: OwnInput, keepTitle = ""): Promise<{ title: string; text: string; url: string }> {
  let title = String(v.title ?? "").trim();
  let text = String(v.text ?? "").trim();
  let url = String(v.url ?? "").trim();
  if (!url && URL_ONLY.test(text)) {
    url = text;
    text = "";
  }
  if (url && !/^https?:\/\//i.test(url)) throw new Error("A link starts with http:// or https://.");
  if (url && !text) {
    const page = await readUrl(url);
    text = page.text;
    title ||= page.title;
  }
  if (!text && !title) throw new Error("Nothing to keep — a text or a link.");
  title ||= keepTitle || text.split("\n").find((l) => l.trim())!.replace(/^#+\s*/, "").trim().slice(0, 90);
  return { title, text: text.slice(0, MAX_TEXT), url };
}

/** Something to keep: stored as a page of your own and compiled. Its id. */
export async function addOwn(v: OwnInput, { compile = true } = {}): Promise<string> {
  const p = await prepare(v);
  const id = `${OWN_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  storePage({ id, space: OWN_SPACE, title: p.title, url: p.url, version: 1, updatedAt: new Date().toISOString(), author: "Ich", body: p.text || p.title });
  if (compile) compileSoon();
  return id;
}

/** One of yours changed: a new version, compiled again. */
export async function updateOwn(id: string, v: OwnInput): Promise<void> {
  if (!isOwn(id)) throw new Error("Only your own knowledge can be changed here.");
  const cur = db().prepare("select title, version from pages where id = ?").get(id) as { title: string; version: number } | undefined;
  if (!cur) throw new Error("That entry doesn't exist any more.");
  const p = await prepare(v, cur.title);
  storePage({ id, space: OWN_SPACE, title: p.title, url: p.url, version: cur.version + 1, updatedAt: new Date().toISOString(), author: "Ich", body: p.text || p.title });
  compileSoon();
}

/** One of yours gone — with what was compiled from it (its entities' links to it, its relations). */
export function removeOwn(id: string): void {
  if (!isOwn(id)) throw new Error("Only your own knowledge can be deleted here.");
  removePage(id);
}

type Row = { id: string; title: string; body: string; url: string; updated_at: string | null; version: number; compiled_version: number | null; summary: string | null; entities: number };

const toEntry = (r: Row): OwnEntry => ({ id: r.id, title: r.title, text: r.body, url: r.url, updatedAt: r.updated_at, compiled: r.compiled_version === r.version, summary: r.summary, entities: r.entities });

const SELECT = `select p.id, p.title, p.body, p.url, p.updated_at, p.version, p.compiled_version, p.summary,
  (select count(*) from entity_pages ep where ep.page_id = p.id) entities from pages p`;

/** Yours, the latest first. */
export const listOwn = (limit = 500): OwnEntry[] => (db().prepare(`${SELECT} where p.id like '${OWN_PREFIX}%' order by p.updated_at desc limit ?`).all(limit) as Row[]).map(toEntry);

export function getOwn(id: string): OwnEntry | null {
  const r = db().prepare(`${SELECT} where p.id = ?`).get(id) as Row | undefined;
  return r && isOwn(r.id) ? toEntry(r) : null;
}
