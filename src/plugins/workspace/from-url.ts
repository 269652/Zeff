import { webFetch } from "@/plugins/web-search/search";
import { markdownToDoc } from "./doc";
import { addRow, getDatabase, rawRows, updatePage } from "./store";

/**
 * A document on the web as a row: read directly from its address (a web page, a PDF), its text the row's page — so a long document
 * needn't pass through the AI, which would have to type it out. An address that is there already adds nothing. Server only.
 */

const MAX_TEXT = 150000;

const same = (a: unknown, b: string) => typeof a === "string" && a.replace(/[#/]+$/, "") === b.replace(/[#/]+$/, "");

export async function addRowFromUrl(dbId: number, url: string): Promise<{ id: number; title: string; chars: number; existed: boolean; cut: boolean }> {
  const d = getDatabase(dbId);
  if (!d) throw new Error("The database is gone.");
  const link = d.schema.properties.find((p) => p.type === "url");
  const rows = rawRows(dbId);
  const known = (u: string) => (link ? rows.find((r) => same(r.cells[link.id], u)) : undefined);
  const before = known(url);
  if (before) return { id: before.id, title: before.title, chars: 0, existed: true, cut: false };
  const page = await webFetch(url, { maxChars: MAX_TEXT });
  // (Redirected to one that is there.)
  const after = known(page.url);
  if (after) return { id: after.id, title: after.title, chars: 0, existed: true, cut: false };
  if (!page.text.trim()) throw new Error(`${page.url}: no text to read.`);
  const title = page.title || new URL(page.url).hostname;
  const id = addRow(dbId, { title, cells: link ? { [link.id]: page.url } : {} });
  updatePage(id, { content: markdownToDoc(`${link ? "" : `Quelle: ${page.url}\n\n`}${page.text}`) });
  return { id, title, chars: page.text.length, existed: false, cut: page.truncated };
}
