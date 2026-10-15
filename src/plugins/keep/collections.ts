import type { CollectionProvider } from "@/lib/items/point";
import type { Collection, Item } from "@/lib/items/shared";
import { isInstalled } from "@/plugins/state";
import { listKeepBoards, listOwnNotes, notesByRefs, type NoteView } from "./boards";
import { allKeepNotes, keepCount, type KeepNote } from "./store";

/**
 * Your Keep boards (keep:board:<id>) and Google Keep (keep:google, once notes are synced) as
 * collections of notes. Google Keep's can be changed in Zeff only with Google Keep write.
 */

const GOOGLE = "keep:google";

const toItem = (n: NoteView | (KeepNote & { ref: string; boardId: null }), collectionId: string): Item => ({
  ref: n.ref,
  collectionId,
  kind: "note",
  title: n.title,
  text: n.text,
  labels: n.labels,
  status: null,
  due: null,
  assignee: null,
  color: n.color,
  pinned: n.pinned,
  archived: n.archived,
  parentRef: null,
  href: n.url,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
});
const ownId = (boardId: number) => `keep:board:${boardId}`;
const googleNote = (n: KeepNote) => ({ ...n, ref: `keep:${n.id}`, boardId: null });

export const keepCollections: CollectionProvider = {
  collections() {
    const own = listKeepBoards().map(
      (b): Collection => ({
        id: ownId(b.id),
        plugin: "keep",
        kind: "notes",
        name: b.name,
        description: b.description,
        color: b.color,
        href: `/keep/${b.id}`,
        readOnly: false,
        briefing: b.inLage,
        knowledge: b.inKnowledge,
        items: b.notes,
      }),
    );
    if (!keepCount()) return own;
    const google: Collection = {
      id: GOOGLE,
      plugin: "keep",
      kind: "notes",
      name: "Google Keep",
      description: "",
      color: null,
      href: "/keep",
      readOnly: !isInstalled("keep-write"),
      briefing: true,
      knowledge: true,
      items: allKeepNotes().filter((n) => !n.archived).length,
    };
    return [...own, google];
  },
  items(id) {
    if (id === GOOGLE) return keepCount() ? allKeepNotes().filter((n) => !n.archived).map((n) => toItem(googleNote(n), GOOGLE)) : null;
    const m = /^keep:board:(\d+)$/.exec(id);
    if (!m || !listKeepBoards().some((b) => b.id === Number(m[1]))) return null;
    return listOwnNotes(Number(m[1])).map((n) => toItem(n, id));
  },
  byRefs: (refs) => notesByRefs(refs).map((n) => toItem(n, n.boardId ? ownId(n.boardId) : GOOGLE)),
};
