/**
 * Documents (the Documents plugin): the files kept in the account's documents folder, their rows
 * (what was read from them, their abstract once the knowledge server compiled them), and what a
 * todo's attachments resolve to. Server only.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { dataDir, getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { docRef, kindOf, MAX_DOCUMENT_BYTES, type DocKind, type DocStatus, type DocView } from "./shared";
import { forget, pendingIds } from "./gate";

const { documents } = schema;
type Row = typeof documents.$inferSelect;

/** Where this account's documents are kept. */
export const documentsDir = () => path.join(dataDir(), "documents");

/** A name that stays in its folder: no path, no odd characters. */
export function safeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[^\p{L}\p{N}._ ()-]+/gu, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return base || "document";
}

/** The beginning of a text, as an abstract stand-in (until the knowledge server's comes). */
const excerpt = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 420);

const toView = (r: Row): DocView => ({
  id: r.id,
  ref: docRef(r.id),
  name: r.name,
  mime: r.mime,
  size: r.size,
  kind: r.kind as DocKind,
  status: r.status as DocStatus,
  error: r.error,
  abstract: r.summary || excerpt(r.text),
  concepts: r.concepts
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 12),
  compiled: r.compiled && !!r.summary,
  chars: r.text.length,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export const listDocuments = (): DocView[] => getDb().select().from(documents).orderBy(desc(documents.createdAt)).all().map(toView);

export function getDocument(id: number): DocView | null {
  const r = getDb().select().from(documents).where(eq(documents.id, id)).get();
  return r ? toView(r) : null;
}

/** The stored file of a document: its path and name (null: not there). */
export function documentFile(id: number): { path: string; name: string; mime: string } | null {
  const r = getDb().select().from(documents).where(eq(documents.id, id)).get();
  if (!r) return null;
  const p = path.join(documentsDir(), r.file);
  return fs.existsSync(p) ? { path: p, name: r.name, mime: r.mime } : null;
}

/** The extracted text of a document (for the knowledge export and the prompts). */
export const documentText = (id: number): string => getDb().select({ text: documents.text }).from(documents).where(eq(documents.id, id)).get()?.text ?? "";

/** Documents by their refs ("doc:12") — a todo's attachments. */
export function docsByRefs(refs: string[]): Map<string, DocView> {
  const ids = [...new Set(refs.filter((r) => /^doc:\d+$/.test(r)).map((r) => Number(r.slice(4))))];
  if (!ids.length) return new Map();
  return new Map(getDb().select().from(documents).where(inArray(documents.id, ids)).all().map((r) => [docRef(r.id), toView(r)]));
}

/** Keep a file: stored, a row made (queued for reading) — the same content again gives the first one back. */
export function addDocument(name: string, data: Buffer, mime = ""): { doc: DocView; fresh: boolean } {
  if (!data.length) throw new Error(t("“{name}” is empty.", { name }));
  if (data.length > MAX_DOCUMENT_BYTES) throw new Error(t("“{name}” is too large (at most {n} MB).", { name, n: MAX_DOCUMENT_BYTES / 1024 / 1024 }));
  const sha256 = createHash("sha256").update(data).digest("hex");
  const db = getDb();
  const had = db.select().from(documents).where(eq(documents.sha256, sha256)).get();
  if (had) return { doc: toView(had), fresh: false };
  const clean = safeName(name);
  const file = `${sha256.slice(0, 16)}-${clean}`;
  fs.mkdirSync(/*turbopackIgnore: true*/ documentsDir(), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ path.join(documentsDir(), file), data);
  const now = new Date().toISOString();
  const row = db
    .insert(documents)
    .values({ name: clean, mime: mime.slice(0, 100), size: data.length, sha256, kind: kindOf(clean, mime), status: "queued", file, createdAt: now, updatedAt: now })
    .returning()
    .get();
  emitChange("todos");
  // A new document: the Workspace's document inbox takes it in.
  void import("./seen").then((m) => m.refresh()).catch(() => undefined);
  return { doc: toView(row), fresh: true };
}

/**
 * A document's file changed (a local folder's — folders.ts): the new content in its place, to be read and compiled
 * again. The same content as another document already kept: that one is the answer (nothing doubled).
 */
export function replaceDocument(id: number, name: string, data: Buffer): DocView {
  if (!data.length) throw new Error(t("“{name}” is empty.", { name }));
  if (data.length > MAX_DOCUMENT_BYTES) throw new Error(t("“{name}” is too large (at most {n} MB).", { name, n: MAX_DOCUMENT_BYTES / 1024 / 1024 }));
  const db = getDb();
  const cur = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!cur) return addDocument(name, data).doc;
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (sha256 === cur.sha256) return toView(cur);
  const other = db.select().from(documents).where(eq(documents.sha256, sha256)).get();
  if (other) return toView(other);
  const clean = safeName(name);
  const file = `${sha256.slice(0, 16)}-${clean}`;
  fs.mkdirSync(/*turbopackIgnore: true*/ documentsDir(), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ path.join(documentsDir(), file), data);
  if (cur.file !== file) fs.rmSync(/*turbopackIgnore: true*/ path.join(documentsDir(), cur.file), { force: true });
  const row = db
    .update(documents)
    .set({ name: clean, size: data.length, sha256, file, kind: kindOf(clean, cur.mime), status: "queued", error: "", text: "", summary: "", concepts: "", compiled: false, updatedAt: new Date().toISOString() })
    .where(eq(documents.id, id))
    .returning()
    .get();
  emitChange("todos");
  void import("./seen").then((m) => m.refresh()).catch(() => undefined);
  return toView(row);
}

export function setStatus(id: number, status: DocStatus, error = ""): void {
  getDb().update(documents).set({ status, error: error.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(documents.id, id)).run();
  emitChange("todos");
  // The Workspace's document inbox follows (its row said "waiting" while this one was read long ago).
  void import("./seen").then((m) => m.refresh()).catch(() => undefined);
}

/** What was read from it: its text — it's ready. A new text is to be compiled again. */
export function setExtracted(id: number, text: string): void {
  getDb()
    .update(documents)
    .set({ text: text.slice(0, 400000), status: "ready", error: "", compiled: false, summary: "", concepts: "", updatedAt: new Date().toISOString() })
    .where(eq(documents.id, id))
    .run();
  emitChange("todos");
  void import("./seen").then((m) => m.refresh()).catch(() => undefined);
}

/** The knowledge server's abstract and concepts for it. */
export function setAbstract(id: number, summary: string, concepts: string): void {
  getDb().update(documents).set({ summary: summary.slice(0, 4000), concepts: concepts.slice(0, 1000), compiled: true }).where(eq(documents.id, id)).run();
  emitChange("todos");
}

export function deleteDocument(id: number): void {
  const db = getDb();
  const r = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!r) return;
  db.delete(documents).where(eq(documents.id, id)).run();
  forget(id);
  fs.rmSync(/*turbopackIgnore: true*/ path.join(documentsDir(), r.file), { force: true });
  // Todos that kept it: the ref is dropped (nothing to show any more).
  const like = `%"${docRef(id)}"%`;
  for (const todo of db.select({ id: schema.todos.id, refs: schema.todos.refs }).from(schema.todos).where(sql`${schema.todos.refs} like ${like}`).all()) {
    const refs = (JSON.parse(todo.refs) as string[]).filter((x) => x !== docRef(id));
    db.update(schema.todos).set({ refs: JSON.stringify(refs) }).where(eq(schema.todos.id, todo.id)).run();
  }
  emitChange("todos");
}

/** The documents waiting to be read. */
export const queuedDocuments = (): number[] =>
  getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(inArray(documents.status, ["queued", "extracting"]))
    .all()
    .map((r) => r.id);

/** What is waiting or being read: each one's id, name and state. */
export const readingDocuments = (): { id: number; name: string; status: DocStatus }[] =>
  getDb()
    .select({ id: documents.id, name: documents.name, status: documents.status })
    .from(documents)
    .where(inArray(documents.status, ["queued", "extracting"]))
    .orderBy(documents.id)
    .all() as { id: number; name: string; status: DocStatus }[];

/** Ready ones the knowledge server hasn't compiled yet (not those waiting for your confirmation — gate.ts). */
export function uncompiledDocuments(): number[] {
  const held = pendingIds();
  return getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(sql`${documents.status} = 'ready' and ${documents.compiled} = 0`)
    .all()
    .map((r) => r.id)
    .filter((id) => !held.has(id));
}

export type ReadableDoc = { id: number; ref: string; name: string; kind: DocKind; createdAt: string; version: string; abstract: string; concepts: string; text: string };

/** The documents whose text was read (ready): for the AI steps — with their full text (not those waiting for your confirmation). */
export function readableDocuments(): ReadableDoc[] {
  const held = pendingIds();
  return getDb()
    .select()
    .from(documents)
    .where(eq(documents.status, "ready"))
    .orderBy(desc(documents.createdAt))
    .all()
    .filter((r) => r.text.trim() && !held.has(r.id))
    .map((r) => ({ id: r.id, ref: docRef(r.id), name: r.name, kind: r.kind as DocKind, createdAt: r.createdAt, version: r.updatedAt, abstract: r.summary, concepts: r.concepts, text: r.text }));
}
