"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { docRef, type DocView } from "./shared";
import { pluginAction } from "@/lib/action-result";

/** The Documents plugin's server actions (each answers an ActionState unless it says otherwise). */

const off = () => (isInstalled("documents") ? null : t("The Documents plugin is not installed (Menu → Plugins)."));
const inPlugin = pluginAction("documents", () => t("The Documents plugin is not installed (Menu → Plugins)."));

const run = (fn: () => Promise<string | void> | string | void): Promise<ActionState> =>
  inPlugin(async () => {
    const message = await fn();
    revalidateAll();
    return { message: message || undefined };
  });

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

/** Reading restarted: the run in flight is stopped, what hung is let go of, the rest is read afresh. */
export async function restartReadingAction(): Promise<ActionState> {
  return run(async () => {
    (await import("./poppler")).forgetPopplerFailure();
    (await import("./process")).restartReading();
    return t("Reading restarted.");
  });
}

/** Waiting documents are picked up (nothing was working on them). */
export async function startReadingAction(): Promise<ActionState> {
  return run(async () => {
    (await import("./process")).startProcessing();
    return t("Reading started.");
  });
}

/** One document skipped: reading it is stopped (or it isn't read); "Read again" brings it back. */
export async function skipDocumentAction(id: number): Promise<ActionState> {
  return run(async () => {
    if (!(await import("./store")).getDocument(Number(id))) throw new Error(t("This document doesn't exist (any more)."));
    (await import("./process")).skipDocument(Number(id));
    return t("Skipped.");
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

/**
 * The first picture added to a note installs the Documents plugin (it keeps the pictures; off by default) — nothing to set up
 * before. Answers ok once it is there.
 */
export async function ensureDocumentsAction(): Promise<ActionState> {
  try {
    const { isInstalled, setInstalled } = await import("@/plugins/state");
    if (isInstalled("documents")) return { ok: true };
    setInstalled("documents", true);
    revalidateAll();
    return { ok: true, message: t("The Documents plugin is installed — it keeps the pictures of your notes.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export type DocHit = { id: number; ref: string; name: string; kind: string; size: number; abstract: string };

/** The note editor's autocomplete (typing ![title]( ): documents by what you typed — pictures first, then the best match, newest first. */
export async function searchDocumentsAction(q: string): Promise<DocHit[]> {
  if (off()) return [];
  const words = String(q ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 6);
  const { listDocuments } = await import("./store");
  const docs = listDocuments().filter((d) => d.status !== "failed");
  const scored = docs.map((d, i) => {
    const hay = `${d.name} ${d.abstract} ${d.concepts.join(" ")}`.toLowerCase();
    return { d, i, hits: words.filter((w) => hay.includes(w)).length };
  });
  return scored
    .filter((x) => !words.length || x.hits > 0)
    .sort((a, b) => Number(b.d.kind === "image") - Number(a.d.kind === "image") || b.hits - a.hits || a.i - b.i)
    .slice(0, 8)
    .map(({ d }) => ({ id: d.id, ref: d.ref, name: d.name, kind: d.kind, size: d.size, abstract: d.abstract.slice(0, 120) }));
}

/** The audio transcriber: the command that turns a recording into text — {file} and {dir} filled in. */
export async function saveDocumentSettingsAction(v: { transcriber: string; autoInstall: boolean }): Promise<ActionState> {
  return run(async () => {
    const { setPref } = await import("@/lib/prefs");
    setPref("plugin:documents", { transcriber: String(v.transcriber ?? "").trim().slice(0, 500), autoInstall: v.autoInstall !== false });
    return t("Saved.");
  });
}

/** The documents app's search: the ids of the documents holding every word typed — in their whole text, not only the name. */
export async function documentsMatchingAction(q: string): Promise<number[]> {
  if (off()) return [];
  return (await import("./fulltext")).documentsMatching(String(q ?? "").slice(0, 300));
}

/** A document's whole text and its summary, for its detail. */
export async function documentTextAction(id: number): Promise<{ text: string; summary: string } | null> {
  if (off()) return null;
  return (await import("./fulltext")).documentText(Number(id));
}
