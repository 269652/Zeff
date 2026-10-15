import { docsByRefs } from "./store";
import { docIdOf, noteImageIds, sizeText, type DocView } from "./shared";

/**
 * What is attached to a todo (its notes' images, documents attached by hand): the documents behind
 * its `doc:<id>` refs, in the order they were attached. Server only (reads the store).
 */
export function todoAttachments(refs: string[]): DocView[] {
  const wanted = refs.filter((r) => docIdOf(r) !== null);
  if (!wanted.length) return [];
  const found = docsByRefs(wanted);
  return wanted.flatMap((r) => found.get(r) ?? []);
}

/**
 * A note's inline pictures (![title](doc:12)) are files of its todo: any the todo doesn't have yet
 * are attached — whether they were pasted, dropped or picked in the editor's search. Returns how many were added.
 */
export async function linkNoteImages(todoId: number, text: string): Promise<number> {
  const ids = noteImageIds(text);
  if (!ids.length) return 0;
  const { getTodo, addTodoContext } = await import("@/lib/boards/store");
  const todo = getTodo(todoId);
  if (!todo) return 0;
  const have = new Set(todo.refs);
  let n = 0;
  for (const id of ids) {
    const doc = docsByRefs([`doc:${id}`]).get(`doc:${id}`);
    if (!doc || have.has(doc.ref)) continue;
    addTodoContext(todoId, [doc.ref], "", "Document");
    n++;
  }
  return n;
}

/** "doc:12", "D-12" or "12" → 12 (null: not a document reference). */
export function parseDocQuery(q: string | number | undefined | null): number | null {
  const m = /^\s*(?:doc:|d-)?(\d+)\s*$/i.exec(String(q ?? ""));
  return m ? Number(m[1]) : null;
}

const KIND_DE: Record<DocView["kind"], string> = { text: "Text", office: "Office-Datei", pdf: "PDF", image: "Bild", audio: "Audio", other: "Datei" };

/** A state worth saying: the document is still being read (no description yet) or could not be. */
const stateDe = (d: DocView) => (d.status === "ready" ? "" : d.status === "failed" ? ", konnte nicht gelesen werden" : d.status === "unsupported" ? ", nicht lesbar" : ", wird noch gelesen");

/**
 * One attachment as a line for an AI's prompt: its reference, name, kind and size — and what is in it
 * (a picture: what it shows and the text visible in it, as the Documents plugin read it; else its abstract).
 */
export function attachmentLine(d: DocView, max = 420): string {
  const what = d.abstract.replace(/\s+/g, " ").trim();
  return `[${d.ref}] ${KIND_DE[d.kind]} „${d.name}“ (${sizeText(d.size)}${stateDe(d)})${what ? `: ${what.length > max ? `${what.slice(0, max - 1)}…` : what}` : ""}`;
}
