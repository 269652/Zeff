"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import * as boards from "./boards";

/** Keep's server actions: your boards and notes — each answers { ok, error?, message? } (and an id where one is made). */

type Result = { ok: boolean; error?: string; message?: string; id?: number };

async function act(fn: () => unknown, message?: string): Promise<Result> {
  try {
    if (!isInstalled("keep")) return { ok: false, error: t("Google Keep is not installed (Menu → Plugins).") };
    const r = fn();
    revalidatePath("/keep", "layout");
    return { ok: true, message, ...(typeof r === "number" ? { id: r } : {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const labelsOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);

export async function createKeepBoardAction(v: { name: string; description?: string; color?: string }): Promise<Result> {
  return act(() => boards.createKeepBoard({ name: String(v.name ?? ""), description: String(v.description ?? ""), color: String(v.color ?? "") }), t("Board created."));
}

export async function updateKeepBoardAction(id: number, patch: { name?: string; description?: string; color?: string; archived?: boolean; inLage?: boolean; inKnowledge?: boolean }): Promise<Result> {
  return act(() => boards.updateKeepBoard(Number(id), patch), patch.archived ? t("Board archived.") : patch.archived === false ? t("Board restored.") : t("Saved."));
}

export async function moveKeepBoardAction(id: number, dir: -1 | 1): Promise<Result> {
  return act(() => boards.moveKeepBoard(Number(id), dir < 0 ? -1 : 1));
}

export async function deleteKeepBoardAction(id: number): Promise<Result> {
  return act(() => boards.deleteKeepBoard(Number(id)), t("Board deleted."));
}

export async function createNoteAction(boardId: number, v: { title?: string; text?: string; color?: string | null; labels?: string[] }): Promise<Result> {
  return act(() => Number(boards.createOwnNote(Number(boardId), { title: v.title, text: v.text, color: v.color ?? null, labels: labelsOf(v.labels) }).id.slice(1)), t("Note created."));
}

export async function updateNoteAction(id: number, patch: { title?: string; text?: string; color?: string | null; labels?: string[]; pinned?: boolean; archived?: boolean; boardId?: number }): Promise<Result> {
  return act(
    () =>
      boards.updateOwnNote(Number(id), {
        title: patch.title,
        text: patch.text,
        color: patch.color,
        labels: labelsOf(patch.labels),
        pinned: patch.pinned,
        archived: patch.archived,
        boardId: patch.boardId === undefined ? undefined : Number(patch.boardId),
      }),
    patch.archived ? t("Archived.") : patch.archived === false ? t("Restored.") : undefined,
  );
}

export async function deleteNoteAction(id: number): Promise<Result> {
  return act(() => boards.deleteOwnNote(Number(id)), t("Note deleted."));
}

/** Which Google account's Keep the sync reads: its number in the automation Chrome (0, 1 …) or its address. */
export async function setKeepAccountAction(_prev: Result | null, fd: FormData): Promise<Result> {
  const account = String(fd.get("account") ?? "").trim();
  if (!/^\d{1,2}$/.test(account) && !/^[^\s@]+@[^\s@]+$/.test(account)) return { ok: false, error: t("An account number (0, 1 …) or an address.") };
  const { setKeepSettings } = await import("./store");
  return act(() => setKeepSettings({ account }), /^\d+$/.test(account) ? t("Keep reads account {n} from now on.", { n: account }) : t("Keep reads {account} from now on.", { account }));
}
