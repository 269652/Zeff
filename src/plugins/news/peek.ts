import { fetchArticle } from "./reader";
import { getContent, setContent, UNREADABLE } from "./store";
import { snippetOf } from "./shared";

export type Peek = { ok: boolean; image: string; hasContent: boolean; summary: string };
const NONE: Peek = { ok: false, image: "", hasContent: false, summary: "" };

/**
 * An item's page read: its whole text kept, its picture taken, the opening of the text as the summary when it has
 * none. A page that can't be read is remembered (not tried again with every look at the card).
 */
export async function peekItem(id: number, deps: { fetchArticle?: typeof fetchArticle } = {}): Promise<Peek> {
  const have = getContent(id);
  if (!have || have.content === UNREADABLE) return NONE;
  try {
    const a = await (deps.fetchArticle ?? fetchArticle)(have.url);
    setContent(id, a.text, a.image);
    return { ok: true, image: a.image, hasContent: true, summary: snippetOf(a.text) };
  } catch {
    setContent(id, UNREADABLE);
    return NONE;
  }
}
