import "@/plugins/contributions";
import { boardProviders } from "./board-providers";
import type { BoardSummary, RichBoard } from "./shared";

/** The boards other plugins bring to Kanban — shown beside your own, read-only here. They contribute through `boardProviders`. */
export async function providerBoards(): Promise<BoardSummary[]> {
  const lists = await Promise.all(boardProviders.list().map(async (c) => c.impl.list()));
  return lists.flat();
}

export async function providerBoard(id: string): Promise<RichBoard | null> {
  for (const c of boardProviders.list()) if (id.startsWith(c.impl.idPrefix)) return c.impl.get(id);
  return null;
}
