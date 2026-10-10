"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Jira — its server actions (each answers an ActionState unless it says otherwise). */

export async function syncJiraAction(): Promise<ActionState> {
  const { syncFromJira } = await import("@/lib/jira/sync");
  try {
    const r = await syncFromJira();
    revalidateAll();
    return {
      ok: true,
      message: `Synced ${r.total} tickets — ${r.mine} yours, ${Math.max(0, r.total - r.mine)} teammates' on your boards (${r.inserted} new, ${r.updated} updated${r.deactivated ? `, ${r.deactivated} dropped` : ""})${r.titlesAdded ? `; +${r.titlesAdded} titles` : ""}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function importJiraAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = str(fd, "json");
  if (!raw) return { ok: false, error: "Paste the Jira issues JSON." };
  const { importPastedTickets } = await import("@/lib/jira/sync");
  try {
    const r = importPastedTickets(raw);
    revalidateAll();
    return { ok: true, message: `Imported ${r.total} tickets (${r.inserted} new, ${r.updated} updated).` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setTicketJobAction(fd: FormData): Promise<void> {
  const key = str(fd, "key");
  if (!key) return;
  const { setTicketJob } = await import("@/lib/jira/store");
  try {
    setTicketJob(key, str(fd, "jobNumber") ?? null);
    revalidateAll();
  } catch (err) {
    console.error("setTicketJobAction", err);
  }
}

export async function clearJiraAction(): Promise<void> {
  const { clearJiraTickets } = await import("@/lib/jira/store");
  clearJiraTickets();
  revalidateAll();
  redirect("/jira");
}

export async function syncBoardsAction(): Promise<ActionState> {
  const { syncBoardsFromJira } = await import("@/lib/jira/boards");
  try {
    const r = await syncBoardsFromJira();
    revalidateAll();
    return {
      ok: true,
      message: `Synced ${r.enabledBoards} enabled of ${r.boards} boards (${r.projects} projects); matched ${r.mappedTickets} tickets.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setBoardJobAction(fd: FormData): Promise<void> {
  const boardId = Number(str(fd, "boardId"));
  if (!Number.isFinite(boardId)) return;
  const { setBoardJob } = await import("@/lib/jira/store");
  try {
    setBoardJob(boardId, str(fd, "jobNumber") ?? null);
    revalidateAll();
  } catch (err) {
    console.error("setBoardJobAction", err);
  }
}

export async function setBoardEnabledAction(fd: FormData): Promise<void> {
  const boardId = Number(str(fd, "boardId"));
  if (!Number.isFinite(boardId)) return;
  const { setBoardEnabled } = await import("@/lib/jira/store");
  try {
    setBoardEnabled(boardId, fd.get("enabled") === "on");
    revalidateAll();
  } catch (err) {
    console.error("setBoardEnabledAction", err);
  }
}

/** A Jira comment marked done (or not): no new todos from it. */
export async function setJiraCommentResolvedAction(commentId: string, ticket: string, resolved: boolean): Promise<ActionState> {
  if (!/^\d+$/.test(String(commentId)) || !/^[A-Z][A-Z0-9]+-\d+$/i.test(String(ticket))) return { ok: false, error: "Unknown comment." };
  const { setJiraCommentResolved } = await import("@/lib/resolved");
  setJiraCommentResolved(String(commentId), String(ticket), !!resolved);
  revalidatePath("/todos");
  return { ok: true };
}
