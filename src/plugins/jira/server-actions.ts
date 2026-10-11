"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Jira — its server actions (each answers an ActionState unless it says otherwise). */

export async function syncJiraAction(): Promise<ActionState> {
  const { syncFromJira } = await import("@/lib/jira/sync");
  try {
    const r = await syncFromJira();
    revalidateAll();
    return {
      ok: true,
      message: [
        t("Synced {total} tickets — {mine} yours, {others} teammates' on your boards", { total: r.total, mine: r.mine, others: Math.max(0, r.total - r.mine) }),
        ` (${t("{inserted} new, {updated} updated", { inserted: r.inserted, updated: r.updated })}`,
        r.deactivated ? `, ${t("{n} dropped", { n: r.deactivated })}` : "",
        ")",
        r.titlesAdded ? `; ${t("+{n} titles", { n: r.titlesAdded })}` : "",
        ".",
      ].join(""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function importJiraAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = str(fd, "json");
  if (!raw) return { ok: false, error: t("Paste the Jira issues JSON.") };
  const { importPastedTickets } = await import("@/lib/jira/sync");
  try {
    const r = importPastedTickets(raw);
    revalidateAll();
    return { ok: true, message: t("Imported {total} tickets ({inserted} new, {updated} updated).", { total: r.total, inserted: r.inserted, updated: r.updated }) };
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
      message: t("Synced {enabled} enabled of {boards} boards ({projects} projects); matched {tickets} tickets.", { enabled: r.enabledBoards, boards: r.boards, projects: r.projects, tickets: r.mappedTickets }),
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
  if (!/^\d+$/.test(String(commentId)) || !/^[A-Z][A-Z0-9]+-\d+$/i.test(String(ticket))) return { ok: false, error: t("Unknown comment.") };
  const { setJiraCommentResolved } = await import("@/lib/resolved");
  setJiraCommentResolved(String(commentId), String(ticket), !!resolved);
  revalidatePath("/todos");
  return { ok: true };
}
