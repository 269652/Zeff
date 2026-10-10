import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { googleLinks, keepBoard, listOwnNotes } from "@/plugins/keep/boards";
import { KeepBoardView } from "@/plugins/keep/KeepBoardView";
import { KeepNav } from "@/plugins/keep/KeepNav";
import { getKeepNote } from "@/plugins/keep/store";
import { BoardSyncButton } from "@/plugins/keep-write/BoardSyncButton";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Keep" };

/** One of your Keep boards: notes like Keep's — written here, in the Lage as context, todos from them. */
export default async function KeepBoardPage({ params, searchParams }: { params: Promise<{ board: string }>; searchParams: Promise<{ q?: string; archived?: string }> }) {
  await connection();
  if (!isInstalled("keep")) return <PluginNotInstalled id="keep" />;
  const id = Number((await params).board);
  const board = Number.isInteger(id) ? keepBoard(id) : null;
  if (!board) notFound();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const archived = sp.archived === "1";
  // Synced with Google Keep (Google Keep schreiben): its note there, linked.
  const sync = isInstalled("keep-write");
  const linkedTo = new Map(sync ? [...googleLinks()].filter(([, l]) => l.boardId === board.id).map(([gid, l]) => [l.id, gid]) : []);
  const notes = listOwnNotes(board.id, { q, archived }).map((n) => {
    const id = Number(n.id.slice(1));
    const gid = linkedTo.get(id);
    return { id, title: n.title, text: n.text, labels: n.labels, color: n.color, pinned: n.pinned, archived: n.archived, updatedAt: n.updatedAt, url: gid ? getKeepNote(gid)?.url : undefined };
  });
  let syncStatus = null;
  if (sync) {
    const { boardSyncState } = await import("@/plugins/keep-write/board-sync");
    const s = boardSyncState(board.id);
    syncStatus = { running: s.running ? { step: s.running.step, done: s.running.done, total: s.running.total } : null, last: s.last };
  }
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Keep</h1>
        <KeepNav current={board.id} />
        <div>
          <h2 className="font-medium">{board.name}</h2>
          {board.description && <p className="text-sm text-zinc-500">{board.description}</p>}
          <p className="text-xs text-zinc-400">{board.inLage ? "In der Ticket-Lage: die Notizen sind Kontext, Todos entstehen aus ihnen." : "Nicht in der Ticket-Lage."}</p>
        </div>
        <form action={`/keep/${board.id}`}>
          {archived && <input type="hidden" name="archived" value="1" />}
          <input name="q" defaultValue={q} className="input" placeholder="Notizen durchsuchen …" aria-label="Notizen durchsuchen" />
        </form>
        <Link href={archived ? `/keep/${board.id}` : `/keep/${board.id}?archived=1`} className="text-sm text-zinc-500 hover:underline">
          {archived ? "← Zurück zu den Notizen" : "Archiv"}
        </Link>
        {syncStatus && <BoardSyncButton boardId={board.id} boardName={board.name} initial={syncStatus} linked={linkedTo.size} />}
      </div>
      <KeepBoardView source={{ kind: "own", boardId: board.id }} notes={notes} archived={archived} empty={q ? "Keine Notiz passt." : archived ? "Nichts im Archiv." : "Noch keine Notizen — schreib die erste."} />
    </div>
  );
}
