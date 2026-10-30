import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isInstalled } from "@/plugins/state";

/**
 * Kanban is gone — its boards are Workspace databases. Old links lead there: a board (/kanban/3, a card ?card=12) to
 * the database it became (the card's row open), a Jira board (/kanban/jira-…) to its database, anything else to the
 * Workspace.
 */
export default async function KanbanRedirect({ params, searchParams }: { params: Promise<{ rest?: string[] }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  const [board] = (await params).rest ?? [];
  if (board && /^\d+$/.test(board)) {
    const card = (await searchParams).card;
    const moved = (await import("@/plugins/workspace/legacy/kanban")).movedHref(Number(board), typeof card === "string" ? card : null);
    if (moved) redirect(moved);
  }
  if (board && /^jira-/.test(board) && isInstalled("jira-lage") && isInstalled("workspace")) {
    const j = await import("@/plugins/jira-lage/to-workspace");
    if (!j.jiraBoardHref(board)) await j.syncJiraBoardDatabases();
    const href = j.jiraBoardHref(board);
    if (href) redirect(href);
  }
  redirect("/workspace");
}
