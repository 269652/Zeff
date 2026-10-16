import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import type { Row } from "@/plugins/workspace/model";
import { getContent, getItem, keptItems, setState, vote } from "./store";

/**
 * The news you kept (saved or liked) as a source of the Workspace's pipelines — a database an agent can read and summarise. The feed
 * stays in News. A two-way view: taking the check from "Saved" or "Liked" there takes it back in News, and an item you drop in News
 * leaves the database at the next read.
 */

const REF = /^news:(\d+)$/;
const F = { image: "newsimage", source: "newssource", published: "newspublished", score: "newsscore", saved: "newssaved", liked: "newsliked", link: "newslink", tags: "newstags", story: "newsstory" };
const marker = (state: string, voteValue: number) => `${state}:${voteValue}`;

export function newsRecords() {
  return keptItems(500).map((i) => {
    const article = i.hasContent ? (getContent(i.id)?.content ?? "") : "";
    const text = [i.summary, article && article !== i.summary ? article.slice(0, 6000) : ""].filter(Boolean).join("\n\n");
    return {
      ref: `news:${i.id}`,
      title: i.title,
      fields: {} as Record<string, string>,
      url: i.url,
      text,
      updatedAt: marker(i.state, i.vote),
      dataType: "news" as const,
      typed: [
        { id: F.source, name: "Publisher", type: "text" as const, value: i.sourceName },
        { id: F.published, name: "Published", type: "date" as const, value: i.publishedAt.slice(0, 10) },
        { id: F.score, name: "Score", type: "number" as const, value: Math.round(i.score * 10) / 10 },
        { id: F.saved, name: "Saved", type: "checkbox" as const, value: i.state === "saved" || null },
        { id: F.liked, name: "Liked", type: "checkbox" as const, value: i.vote === 1 || null },
        { id: F.link, name: "Link", type: "url" as const, value: i.url },
        // The article's picture (when it has one): the gallery shows it on the card.
        { id: F.image, name: "Image", type: "url" as const, value: /^https?:\/\//.test(i.image) ? i.image : null },
        { id: F.tags, name: "Tags", type: "text" as const, value: i.terms.join(", ") },
        { id: F.story, name: "Story", type: "text" as const, value: i.story },
      ],
    };
  });
}

/** A check taken from Saved or Liked goes back to News (when News did not change the item since the row was read). */
export async function pullNews(_dbId: number, rows: Row[]): Promise<void> {
  for (const row of rows) {
    const m = REF.exec(String(row.cells.srcref ?? ""));
    if (!m) continue;
    const item = getItem(Number(m[1]));
    if (!item || String(row.cells.srcedited ?? "") !== marker(item.state, item.vote)) continue;
    const saved = row.cells[F.saved] === true;
    const liked = row.cells[F.liked] === true;
    if (saved !== (item.state === "saved")) setState(item.id, saved ? "saved" : "read");
    if (liked !== (item.vote === 1)) vote(item.id, liked ? 1 : 0);
  }
}

export const NEWS_SOURCE: WorkspaceSource = {
  id: "news",
  label: "Saved news",
  icon: "📰",
  dataType: "news",
  hint: "The news you saved or liked — with their text, for reading, summarising and linking. Taking the check from Saved or Liked takes it back in News.",
  read: newsRecords,
  count: () => keptItems(500).length,
  pull: pullNews,
};

