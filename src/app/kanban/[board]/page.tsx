import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { OwnBoard } from "@/plugins/kanban/OwnBoard";
import { providerBoard } from "@/plugins/kanban/providers";
import { RichBoardView } from "@/plugins/kanban/RichBoardView";
import { ATTENTION_LABELS, isAttention } from "@/lib/boards/shared";
import type { BoardView, CardLage, CardTodo } from "@/plugins/kanban/shared";
import { getBoard } from "@/plugins/kanban/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Kanban" };

/** What the Lage says about the board's cards (KB-…), and their todos (open and done — the checklist) — with the Todos plugin. */
async function cardLage(view: BoardView): Promise<Record<string, CardLage>> {
  if (!isInstalled("todos")) return {};
  const { lageByTicket } = await import("@/lib/boards/ticket-lage");
  const { listTodos } = await import("@/lib/boards/store");
  const { byKey } = lageByTicket();
  const refs = new Set(view.columns.flatMap((x) => x.cards.map((c) => c.ref)));
  const todos = new Map<string, CardTodo[]>();
  for (const t of listTodos({ status: "all" }))
    if (t.status !== "dismissed")
      for (const k of [t.ticket, ...t.alsoTickets].map((x) => x.toUpperCase()).filter((x) => refs.has(x)))
        todos.set(k, [...(todos.get(k) ?? []), { id: t.id, text: t.text, owner: t.owner, status: t.status === "done" ? "done" : "open", due: t.due }]);
  const out: Record<string, CardLage> = {};
  for (const c of view.columns.flatMap((x) => x.cards)) {
    const l = byKey.get(c.ref);
    const t = todos.get(c.ref) ?? [];
    if (!l && !t.length) continue;
    const attention = l && isAttention(l.attention) ? l.attention : null;
    out[c.ref] = { attention, attentionLabel: attention ? ATTENTION_LABELS[attention] : null, lead: l?.lead ?? null, summary: l?.summary ?? null, happened: (l?.happened ?? []).slice(-6), todos: t };
  }
  return out;
}

/** A board: one of yours (numbered — to change), or one a plugin brings (jira-… — to look at). */
export default async function BoardPage({ params }: { params: Promise<{ board: string }> }) {
  await connection();
  if (!isInstalled("kanban")) return <PluginNotInstalled id="kanban" />;
  const { board } = await params;
  if (/^\d+$/.test(board)) {
    let view: BoardView | null = null;
    try {
      view = getBoard(Number(board));
    } catch {
      view = null;
    }
    if (!view) notFound();
    return <OwnBoard board={view} lage={await cardLage(view)} />;
  }
  const rich = await providerBoard(board);
  if (!rich) notFound();
  return <RichBoardView board={rich} />;
}
