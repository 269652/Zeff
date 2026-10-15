import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { OwnBoard } from "@/plugins/kanban/OwnBoard";
import { providerBoard } from "@/plugins/kanban/providers";
import { RichBoardView } from "@/plugins/kanban/RichBoardView";
import { attentionLabels, isAttention } from "@/lib/boards/shared";
import type { BoardView, CardLage, CardTodo } from "@/plugins/kanban/shared";
import { getBoard, listBoards } from "@/plugins/kanban/store";
import { listContextPeople } from "@/lib/contexts";
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
  for (const todo of listTodos({ status: "all" }))
    if (todo.status !== "dismissed")
      for (const k of [todo.ticket, ...todo.alsoTickets].map((x) => x.toUpperCase()).filter((x) => refs.has(x)))
        todos.set(k, [...(todos.get(k) ?? []), { id: todo.id, text: todo.text, owner: todo.owner, status: todo.status === "done" ? "done" : "open", due: todo.due }]);
  const out: Record<string, CardLage> = {};
  for (const c of view.columns.flatMap((x) => x.cards)) {
    const l = byKey.get(c.ref);
    const cardTodos = todos.get(c.ref) ?? [];
    if (!l && !cardTodos.length) continue;
    const attention = l && isAttention(l.attention) ? l.attention : null;
    out[c.ref] = { attention, attentionLabel: attention ? attentionLabels(t)[attention] : null, lead: l?.lead ?? null, summary: l?.summary ?? null, happened: (l?.happened ?? []).slice(-6), todos: cardTodos };
  }
  return out;
}

/** A board: one of yours (numbered — to change), or one a plugin brings (jira-… — to look at). */
export default async function BoardPage({ params, searchParams }: { params: Promise<{ board: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  if (!isInstalled("kanban")) return <PluginNotInstalled id="kanban" />;
  const { board } = await params;
  if (/^\d+$/.test(board)) {
    // Moved into the Workspace: old links (a card's too) lead there.
    const card = (await searchParams).card;
    const moved = (await import("@/plugins/kanban/to-workspace")).movedHref(Number(board), typeof card === "string" ? card : null);
    if (moved) redirect(moved);
    let view: BoardView | null = null;
    try {
      view = getBoard(Number(board));
    } catch {
      view = null;
    }
    if (!view) notFound();
    // To move a card to, and the names to suggest for a person: those Zeff knows (contacts, Jira, the people list).
    const others = listBoards().filter((b) => b.id !== view!.id).map((b) => ({ id: b.id, name: b.name }));
    let known = listContextPeople().map((p) => p.name);
    if (isInstalled("people")) known = [...(await import("@/plugins/people/store")).listPeople().map((p) => p.name), ...known];
    return <OwnBoard board={view} lage={await cardLage(view)} todosOn={isInstalled("todos")} otherBoards={others} knownPeople={[...new Set(known)]} />;
  }
  const rich = await providerBoard(board);
  if (!rich) notFound();
  return <RichBoardView board={rich} />;
}
