"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { isPriority } from "./shared";
import * as store from "./store";

/** Kanban's server actions: boards, columns, cards — each answers { ok, error?, message? } (and an id where one is made). */

type Result = { ok: boolean; error?: string; message?: string; id?: number };

async function act(fn: () => unknown, message?: string): Promise<Result> {
  try {
    if (!isInstalled("kanban")) return { ok: false, error: "Kanban is not installed (Menu → Plugins)." };
    const r = fn();
    revalidatePath("/kanban", "layout");
    return { ok: true, message, ...(typeof r === "number" ? { id: r } : {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createBoardAction(v: { name: string; description?: string; color?: string; columns?: string }): Promise<Result> {
  return act(
    () =>
      store.createBoard({
        name: String(v.name ?? ""),
        description: String(v.description ?? ""),
        color: String(v.color ?? ""),
        columns: String(v.columns ?? "")
          .split(/[,\n]/)
          .map((c) => c.trim())
          .filter(Boolean),
      }),
    "Board created.",
  );
}

export async function updateBoardAction(id: number, patch: { name?: string; description?: string; color?: string; archived?: boolean; inLage?: boolean }): Promise<Result> {
  return act(() => store.updateBoard(Number(id), patch), patch.archived ? "Board archived." : patch.archived === false ? "Board restored." : "Saved.");
}

export async function moveBoardAction(id: number, dir: -1 | 1): Promise<Result> {
  return act(() => store.moveBoard(Number(id), dir < 0 ? -1 : 1));
}

export async function deleteBoardAction(id: number): Promise<Result> {
  return act(() => store.deleteBoard(Number(id)), "Board deleted.");
}

export async function addColumnAction(boardId: number, name: string): Promise<Result> {
  return act(() => store.addColumn(Number(boardId), String(name ?? "")));
}

export async function updateColumnAction(id: number, patch: { name?: string; wipLimit?: number | null; done?: boolean }): Promise<Result> {
  return act(() => store.updateColumn(Number(id), { name: patch.name, wipLimit: patch.wipLimit === undefined ? undefined : patch.wipLimit === null ? null : Number(patch.wipLimit), done: patch.done }));
}

export async function moveColumnAction(id: number, dir: -1 | 1): Promise<Result> {
  return act(() => store.moveColumn(Number(id), dir < 0 ? -1 : 1));
}

export async function deleteColumnAction(id: number): Promise<Result> {
  return act(() => store.deleteColumn(Number(id)));
}

export async function createCardAction(columnId: number, title: string): Promise<Result> {
  return act(() => store.createCard(Number(columnId), String(title ?? "")).id);
}

export async function updateCardAction(id: number, patch: { title?: string; description?: string; labels?: string[]; priority?: string | null; due?: string | null; assignee?: string | null }): Promise<Result> {
  return act(() =>
    store.updateCard(Number(id), {
      title: patch.title,
      description: patch.description,
      labels: Array.isArray(patch.labels) ? patch.labels.map(String) : undefined,
      priority: patch.priority === undefined ? undefined : isPriority(patch.priority) ? patch.priority : null,
      due: patch.due,
      assignee: patch.assignee === undefined ? undefined : patch.assignee === null ? null : String(patch.assignee),
    }),
  );
}

export async function moveCardAction(id: number, columnId: number, before: number | null): Promise<Result> {
  return act(() => store.moveCard(Number(id), Number(columnId), before === null ? null : Number(before)));
}

export async function archiveCardAction(id: number): Promise<Result> {
  return act(() => store.archiveCard(Number(id)), "Card archived.");
}

export async function deleteCardAction(id: number): Promise<Result> {
  return act(() => store.deleteCard(Number(id)), "Card deleted.");
}
