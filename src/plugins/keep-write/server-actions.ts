"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { createGoogleNote, trashGoogleNote, updateGoogleNote, type KeepWrite } from "./write";

/** Google Keep schreiben's server actions: a note made, changed or put in the trash — in Google Keep, then in Zeff. */

type Result = { ok: boolean; error?: string; message?: string; id?: string };

async function act(fn: () => Promise<string | void>, message?: string): Promise<Result> {
  try {
    if (!isInstalled("keep-write")) return { ok: false, error: "„Google Keep schreiben“ ist nicht installiert (Menü → Plugins)." };
    const id = await fn();
    revalidatePath("/keep", "layout");
    return { ok: true, message, ...(id ? { id } : {}) };
  } catch (err) {
    revalidatePath("/keep", "layout");
    return { ok: false, error: errorMessage(err) };
  }
}

const clean = (v: KeepWrite): KeepWrite => ({
  title: v.title === undefined ? undefined : String(v.title),
  text: v.text === undefined ? undefined : String(v.text),
  color: v.color === undefined ? undefined : v.color ? String(v.color) : null,
  labels: Array.isArray(v.labels) ? v.labels.map(String) : undefined,
  pinned: v.pinned === undefined ? undefined : !!v.pinned,
  archived: v.archived === undefined ? undefined : !!v.archived,
});

export async function createGoogleNoteAction(v: KeepWrite): Promise<Result> {
  return act(async () => (await createGoogleNote(clean(v))).id, "In Google Keep angelegt.");
}

export async function updateGoogleNoteAction(id: string, patch: KeepWrite): Promise<Result> {
  const p = clean(patch);
  return act(async () => void (await updateGoogleNote(String(id), p)), p.archived ? "In Google Keep archiviert." : p.archived === false ? "In Google Keep zurückgeholt." : "In Google Keep gespeichert.");
}

export async function trashGoogleNoteAction(id: string): Promise<Result> {
  return act(() => trashGoogleNote(String(id)), "In Keeps Papierkorb.");
}

/** A board's sync with Google Keep started (in the background). */
export async function startBoardSyncAction(boardId: number): Promise<Result> {
  try {
    if (!isInstalled("keep-write")) return { ok: false, error: "\"Google Keep schreiben\" isn't installed (Menu → Plugins)." };
    const { startBoardSync } = await import("./board-sync");
    return startBoardSync(Number(boardId)) ? { ok: true, message: "Syncing with Google Keep …" } : { ok: false, error: "A board sync is already running — try again after it." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** How a board's sync with Google Keep stands. */
export async function boardSyncStatusAction(boardId: number) {
  const { boardSyncState } = await import("./board-sync");
  const s = boardSyncState(Number(boardId));
  return { running: s.running ? { step: s.running.step, done: s.running.done, total: s.running.total } : null, last: s.last };
}
