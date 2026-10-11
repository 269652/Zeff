"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { docRef, type DocView } from "./shared";

/** The Documents plugin's server actions (each answers an ActionState unless it says otherwise). */

const off = () => (isInstalled("documents") ? null : t("The Documents plugin is not installed (Menu → Plugins)."));

async function run(fn: () => Promise<string | void> | string | void): Promise<ActionState> {
  try {
    const no = off();
    if (no) return { ok: false, error: no };
    const message = await fn();
    revalidateAll();
    return { ok: true, message: message || undefined };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** A document and its file deleted — todos that kept it let go of it. */
export async function deleteDocumentAction(id: number): Promise<ActionState> {
  return run(async () => {
    (await import("./store")).deleteDocument(Number(id));
    return t("Document deleted.");
  });
}

/** Read it again (it failed, or a transcriber / the Claude CLI came since). */
export async function reprocessDocumentAction(id: number): Promise<ActionState> {
  return run(async () => {
    const { getDocument, setStatus } = await import("./store");
    if (!getDocument(Number(id))) throw new Error(t("This document doesn't exist (any more)."));
    setStatus(Number(id), "queued");
    // Poppler (a scanned PDF's reader) that failed to install is tried again.
    (await import("./poppler")).forgetPopplerFailure();
    (await import("./process")).startProcessing();
    return t("Reading it again …");
  });
}

/** A document attached to a todo, by hand: it shows in its context, and goes into what the AI reads about it. */
export async function attachDocumentAction(todoId: number, docId: number): Promise<ActionState> {
  return run(async () => {
    const { getDocument } = await import("./store");
    const { addTodoContext } = await import("@/lib/boards/store");
    const doc = getDocument(Number(docId));
    if (!doc) throw new Error(t("This document doesn't exist (any more)."));
    if (!addTodoContext(Number(todoId), [doc.ref], "", "Document")) throw new Error(t("This todo doesn't exist (any more)."));
    return t("“{name}” attached.", { name: doc.name });
  });
}

/** A document taken off a todo (it stays in the store). */
export async function detachDocumentAction(todoId: number, docId: number): Promise<ActionState> {
  return run(async () => {
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const row = getDb().select({ refs: schema.todos.refs }).from(schema.todos).where(eq(schema.todos.id, Number(todoId))).get();
    if (!row) throw new Error(t("This todo doesn't exist (any more)."));
    const refs = (JSON.parse(row.refs) as string[]).filter((r) => r !== docRef(Number(docId)));
    getDb().update(schema.todos).set({ refs: JSON.stringify(refs), updatedAt: new Date().toISOString() }).where(eq(schema.todos.id, Number(todoId))).run();
    return t("Detached.");
  });
}

/** The documents, newest first (the attach picker loads them when it opens) — with abstracts, once the knowledge server compiled them. */
export async function listDocumentsAction(): Promise<DocView[]> {
  if (off()) return [];
  const { pullAbstracts } = await import("./process");
  await pullAbstracts();
  return (await import("./store")).listDocuments();
}

/** The audio transcriber: the command that turns a recording into text — {file} and {dir} filled in. */
export async function saveDocumentSettingsAction(v: { transcriber: string; autoInstall: boolean }): Promise<ActionState> {
  return run(async () => {
    const { setPref } = await import("@/lib/prefs");
    setPref("plugin:documents", { transcriber: String(v.transcriber ?? "").trim().slice(0, 500), autoInstall: v.autoInstall !== false });
    return t("Saved.");
  });
}
